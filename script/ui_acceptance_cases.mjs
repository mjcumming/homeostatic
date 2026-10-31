/** Pointer/keyboard acceptance cases against the disposable real HA laboratory.
 * Backend reads establish saved results; no product event handler is invoked.
 * Broad inventory paths are credited only when this case covers their contract.
 */
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {installTransport} from "./ui_acceptance_transport.mjs";

// These workflows check a useful subset of their broader inventory contract.
// Keep the same conservative mapping when merging older raw receipts.
export const boundedLivePaths=new Set([
  "sources.maintenance","policies.lifecycle","policies.restore","profiles.list",
  "profiles.invalid","profiles.timing","profiles.duplicate","profiles.delete-replace",
  "profiles.delete-remove","methods.lifecycle","settings.edit","sending.switch",
  "save.failure","save.uncertain",
]);
export const liveCaseId=id=>boundedLivePaths.has(id)?`live.${id}`:id;

export async function runLiveCases({page,lab,call,record,artifactDir,group="all"}) {
  const card=page.locator(lab.panel_element||"homeostatic-card").last();
  const at=selector=>card.locator(selector);
  const bodyText=async()=>[await at(".shell").innerText(),...await at("dialog[open]").allInnerTexts()].join("\n");
  const action=name=>`[data-definition-action="${name}"]`;
  const field=name=>`[data-definition-field="${name}"]`;
  const snapshot=async()=> (await call("homeostatic/configuration")).settings;
  const click=async selector=>at(selector).first().click();
  const fill=async(selector,value)=>{
    await at(selector).first().fill(String(value));
    // Installation fields commit on native change (blur), matching keyboard use.
    if(selector.includes("data-setting-path"))await at(selector).first().press("Tab");
  };
  const choose=async(selector,value)=>await at(selector).first().getAttribute("type")==="radio"?at(`${selector}[value="${value}"]`).check():at(selector).first().selectOption(String(value));
  const check=async(selector,value)=>at(selector).first().setChecked(value);
  const savedName=async()=>at(field("name")).inputValue();
  const currentId=async()=>at(field("name")).getAttribute("data-definition-id");
  const clean=async()=>{
    await page.keyboard.press("Escape");
    await page.goto(lab.panel_url);
    await at('.header [data-page="policies"]').waitFor();
    await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});
  };
  const go=async destination=>{
    if(await at('dialog[open],[popover]:popover-open').count())await page.keyboard.press("Escape");
    await click(`.header [data-page="${destination}"]`);
    if(destination==="policies"&&await at(action("close")).count())await click(action("close"));
  };
  const listing=async kind=>{
    await go(kind==="policies"?"policies":"notifications");
    if(kind!=="policies")await click(`${action("notification-view")}[data-definition-kind="${kind}"]`);
  };
  const edit=async(kind,id)=>{
    await listing(kind);
    await click(`${action("edit")}[data-definition-kind="${kind}"][data-definition-id="${id}"]`);
    await at(field("name")).waitFor();
  };
  const menu=async(kind,id,operation)=>{
    await listing(kind);
    const prefix={policies:"policy",profiles:"notification",methods:"method"}[kind];
    await click(`[popovertarget="${prefix}-actions-${id}"]`);
    await click(`#${prefix}-actions-${id} ${action(operation)}`);
  };
  const save=async()=>{
    await click(action("save-scoped"));
    await at(action("save-scoped")).waitFor({state:"hidden",timeout:45000});
    await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});
  };
  const discard=async()=>click(action("discard-scoped"));
  const deleteConfirm=async()=>{
    await click(action("confirm-delete"));
    await at(action("confirm-delete")).waitFor({state:"hidden",timeout:45000});
  };
  const add=async(kind,name)=>{
    await listing(kind);await click(`${action("add")}[data-definition-kind="${kind}"]`);
    await fill(field("name"),name);return currentId();
  };
  const addPolicy=async(type,name)=>{
    await listing("policies");await click(`${action("add")}[data-definition-kind="policies"]`);
    await choose('[data-definition-template]',type);await click(action("create"));
    await fill(field("name"),name);return currentId();
  };
  const noChange=async before=>assert.deepEqual(await snapshot(),before);
  const selected=async selector=>assert.equal(await at(selector).isChecked(),true);
  const caseResults=[];
  const transport=await installTransport(page);
  console.log("live setup browser transport");
  await clean();
  const selectedCases=new Set((process.env.HOMEOSTATIC_UI_CASES||"").split(",").filter(Boolean));
  const run=async(id,body,complete=false)=>{
    if(!complete)id=liveCaseId(id);
    if(selectedCases.size&&!selectedCases.has(id))return;
    page.acceptanceCase=id;
    console.log(`live start ${id}`);
    const started=Date.now();
    const pageErrors=[],onError=error=>pageErrors.push(error.message);page.on("pageerror",onError);
    try {
      const detail=await body();
      assert.deepEqual(pageErrors,[],"Unhandled browser errors occurred during this case");
      const evidence={environment:"isolated Home Assistant",interaction:"Playwright pointer and keyboard",duration_ms:Date.now()-started,detail:detail||"Rendered actions and real saved-state assertions passed."};
      await record(id,"pass",evidence);caseResults.push({id,status:"pass",...evidence});
    } catch(error) {
      if(page.isClosed())throw error;
      console.error(`live failure ${id}: ${error.stack||error}`);
      if(transport){transport.release?.();transport.mode=null;transport.refreshFailure=false;transport.commandModes.clear();transport.interceptRequest=null;transport.transformResponse=null;}
      const stem=id.replace(/[^a-z0-9._-]/gi,"_");
      const screenshot=join(artifactDir,`${group}-${stem}.png`),dom=join(artifactDir,`${group}-${stem}.txt`);
      await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
      await writeFile(dom,await bodyText().catch(()=>"Card unavailable"),"utf8").catch(()=>{});
      const evidence={environment:"isolated Home Assistant",duration_ms:Date.now()-started,error:String(error.stack||error),screenshot,dom};
      await record(id,"fail",evidence);caseResults.push({id,status:"fail",...evidence});
      await clean().catch(()=>{});
    }finally{page.off("pageerror",onError);}
  };

  if(group==="all"||group==="policies") {
    await run("navigation.pages",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];
      await edit("policies",policy.id);await fill(field("name"),"Navigation policy draft");
      await edit("profiles","morning");await fill(field("name"),"Navigation notification draft");
      await edit("methods","lab_messages");await fill(field("name"),"Navigation method draft");
      for(const destination of ["problems","sources","policies","notifications","history","configuration"]) {
        await go(destination);
        if(destination==="configuration")assert.equal(await at('main h1').innerText(),"Settings");
        else assert.equal(await at(`.header [data-page="${destination}"]`).getAttribute("aria-current"),"page");
      }
      for(const [kind,id,name] of [["policies",policy.id,"Navigation policy draft"],["profiles","morning","Navigation notification draft"],["methods","lab_messages","Navigation method draft"]]) {
        await edit(kind,id);assert.equal(await savedName(),name);await discard();
      }
      await noChange(before);
    });
    await run("policies.lifecycle",async()=>{
      const before=await snapshot();
      const id=await addPolicy("entity","Acceptance lifecycle");await check(field("enabled"),true);await save();
      let saved=await snapshot();assert.equal(saved.monitoring_policies.find(p=>p.id===id).enabled,true);
      assert.deepEqual(saved.monitoring_policies.filter(p=>p.id!==id),before.monitoring_policies);
      await fill(field("name"),"Discard policy draft");await discard();assert.equal(await savedName(),"Acceptance lifecycle");
      await check(field("enabled"),false);await save();assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).enabled,false);
      await menu("policies",id,"duplicate");const copy=await currentId();await save();
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===copy).enabled,false);
      await menu("policies",copy,"delete");await click(action("cancel-delete"));assert.ok((await snapshot()).monitoring_policies.some(p=>p.id===copy));
      await menu("policies",copy,"delete");await deleteConfirm();assert.ok(!(await snapshot()).monitoring_policies.some(p=>p.id===copy));
      await menu("policies",id,"delete");await deleteConfirm();
      const supplied=before.monitoring_policies[0];await edit("policies",supplied.id);
      await fill(field("name"),`${supplied.name} edited`);await save();await fill(field("name"),supplied.name);await save();
      await noChange(before);
    });
    await run("policies.host-health",async()=>{
      const before=await snapshot();
      const id=await addPolicy("host_memory","Acceptance memory pressure");
      await save();
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).enabled,false);
      await edit("policies",id);
      const disabled=await snapshot();
      await fill(field("parameters:recovery"),"8");
      await click(action("save-scoped"));
      assert.match(await bodyText(),/recovery limit must be lower/i);
      await noChange(disabled);
      await fill(field("parameters:recovery"),"2");
      const choices=at(field("source-choice"));
      assert.equal(await choices.count(),1);
      await choices.first().check();
      await fill(field("parameters:threshold"),"7");
      await fill(field("parameters:duration_seconds"),"12");
      await check(field("enabled"),true);
      await page.screenshot({path:join(artifactDir,"host-health-editor-viewport.png")});
      await page.screenshot({path:join(artifactDir,"host-health-editor.png"),fullPage:true});
      await at(field("parameters:threshold")).scrollIntoViewIfNeeded();
      await page.mouse.move(300,600);await page.mouse.wheel(0,480);
      await page.evaluate(()=>new Promise(requestAnimationFrame));
      await page.screenshot({path:join(artifactDir,"host-health-limits-viewport.png")});
      transport.mode="reject";await click(action("save-scoped"));
      await at('.config-error').filter({hasText:"Acceptance transport rejected"}).waitFor();
      assert.equal(await at(field("parameters:threshold")).inputValue(),"7");
      await noChange(disabled);
      await save();
      const saved=(await snapshot()).monitoring_policies.find(p=>p.id===id);
      assert.equal(saved.parameters.threshold,7);
      assert.equal(saved.parameters.duration_seconds,720);
      assert.equal(saved.match.entity.length,1);
      assert.equal(saved.enabled,true);
      assert.equal((await snapshot()).notifications,before.notifications);
      await edit("policies",id);
      assert.equal(await at(field("parameters:threshold")).inputValue(),"7");
      assert.equal(await at(field("parameters:duration_seconds")).inputValue(),"12");
      assert.equal(await choices.first().isChecked(),true);
      await fill(field("parameters:threshold"),"9");await discard();
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).parameters.threshold,7);
      await menu("policies",id,"delete");await deleteConfirm();
      for(const type of ["host_storage","host_io","host_cpu"]) {
        const other=await addPolicy(type,`Acceptance ${type}`);
        assert.equal(await at(field("source-choice")).count(),1);
        await check(field("source-choice"),true);await check(field("enabled"),true);await save();
        const policy=(await snapshot()).monitoring_policies.find(p=>p.id===other);
        assert.equal(policy.enabled,true);assert.equal(policy.match.entity.length,1);
        await edit("policies",other);assert.equal(await at(field("source-choice")).first().isChecked(),true);
        await menu("policies",other,"delete");await deleteConfirm();
      }
      await noChange(before);
      return "Saved a disabled policy without sources; rejected invalid recovery and a failed save; selected each of four sensors, saved, reopened and removed its policy, with retry and discard on memory pressure.";
    },true);
    for(const type of ["integration","entity","entity_not_provided","battery","vacuum","repair","broken_automation","thermostat","temperature_limit","ups_power","ups_reserve","ups_battery_replacement","ups_fault"]) {
      await run(`live.policies.type.${type}`,async()=>{
        const id=await addPolicy(type,`Acceptance ${type}`);
        if(type==="temperature_limit")await fill(field("parameters:minimum"),"40");
        if(type==="battery")await fill(field("parameters:threshold"),"25");
        if(type==="entity_not_provided") {
          assert.equal(await at(field("parameters:duration_seconds")).inputValue(),"24");
          await fill(field("parameters:duration_seconds"),"2");
          await fill(field("entity-search"),lab.entities?.offline||"sensor.ui_lab_offline");
          await at(`${field("entity-choice")}:not(:disabled)`).first().uncheck();
        }
        await save();const saved=(await snapshot()).monitoring_policies.find(p=>p.id===id);
        assert.ok(saved);assert.equal(saved.enabled,false);
        await edit("policies",id);assert.equal(await savedName(),`Acceptance ${type}`);
        if(type==="battery")assert.equal(await at(field("parameters:threshold")).inputValue(),"25");
        if(type==="temperature_limit")assert.equal(await at(field("parameters:minimum")).inputValue(),"40");
        if(type==="entity_not_provided") {
          assert.equal(saved.parameters.duration_seconds,7200);
          assert.equal(await at(field("parameters:duration_seconds")).inputValue(),"2");
          assert.ok(saved.excluded_sources.length);
          assert.equal((await snapshot()).notifications,false);
        }
        await menu("policies",id,"delete");await deleteConfirm();
        return `Created, saved, reopened and deleted ${type}; initial/default detection plus explicit temperature/battery values. Boundary validation belongs to fixture coverage.`;
      });
    }
    await run("live.policies.selection",async()=>{
      const id=await addPolicy("entity","Acceptance selection");
      await fill(field("entity-search"),lab.entities?.offline||"sensor.ui_lab_offline");
      const choice=at(field("entity-choice")).first();await choice.waitFor();
      const value=await choice.getAttribute("data-definition-value");await choice.check();
      await fill(field("entity-search"),"no-acceptance-source-matches");assert.equal(await at(field("entity-choice")).count(),0);
      await fill(field("entity-search"),lab.entities?.offline||"sensor.ui_lab_offline");assert.equal(await choice.isChecked(),true);
      await save();assert.ok((await snapshot()).monitoring_policies.find(p=>p.id===id).included_sources.includes(value));
      await edit("policies",id);await fill(field("entity-search"),lab.entities?.offline||"sensor.ui_lab_offline");await at(field("entity-choice")).first().uncheck();await save();
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).included_sources,undefined);
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).excluded_sources,undefined);
      await menu("policies",id,"delete");await deleteConfirm();
    });
    await run("live.policies.notification-empty",async()=>{
      const id=await addPolicy("battery","Acceptance notification choices");
      while(await at(action("remove-row")).count())await click(action("remove-row"));
      assert.ok((await bodyText()).includes("No notifications"));await save();
      assert.deepEqual((await snapshot()).monitoring_policies.find(p=>p.id===id).notifications,[]);
      await edit("policies",id);await choose('.policy-notification-add select',"urgent");await save();
      assert.equal((await snapshot()).monitoring_policies.find(p=>p.id===id).notifications[0].profile,"urgent");
      await menu("policies",id,"delete");await deleteConfirm();
      return "Remove last notification, save empty, reopen and explicitly add. Failure/retry is separately covered by synthetic fixture.";
    });
    await run("policies.restore",async()=>{
      const initial=await snapshot(),target=initial.monitoring_policies.find(p=>p.id==="default_batteries");assert.ok(target);
      await menu("policies",target.id,"delete");await deleteConfirm();
      const deleted=await snapshot();await listing("policies");await click(action("restore"));await click(action("cancel-restore"));await noChange(deleted);
      await click(action("restore"));await check(`[data-definition-restore="${target.id}"]`,true);await click(action("confirm-restore"));await noChange(deleted);
      await edit("policies",target.id);await save();
      const saved=await snapshot(),restored=saved.monitoring_policies.find(p=>p.id===target.id);assert.ok(restored);
      assert.deepEqual(saved.monitoring_policies.filter(p=>p.id!==target.id),deleted.monitoring_policies);
      for(const row of restored.notifications)assert.ok(saved.notification_definitions.profiles[row.profile]);
    });
    await run("settings.edit",async()=>{
      const before=await snapshot();await go("configuration");
      const selector='[data-setting-path="timings.clear_hold"]',old=await at(selector).inputValue(),scale=Number(await at(selector).getAttribute("data-setting-scale"));
      await fill(selector,Number(old)+1);await save();const saved=await snapshot();
      assert.equal(saved.timings.clear_hold,(Number(old)+1)*scale);assert.deepEqual(saved.monitoring_policies,before.monitoring_policies);
      await fill(selector,"-1");assert.equal(await at(selector).evaluate(el=>el.validity.valid),false);assert.equal((await snapshot()).timings.clear_hold,saved.timings.clear_hold);
      await fill(selector,Number(old)+2);await discard();assert.equal(await at(selector).inputValue(),String(Number(old)+1));
      assert.equal(await at('[data-settings-section], [data-setting-path="timings.coalesce_count"], [data-setting-path="timings.coalesce_window"]').count(),0);
      assert.equal(saved.timings.coalesce_count,before.timings.coalesce_count);assert.equal(saved.timings.coalesce_window,before.timings.coalesce_window);
    });
    await run("sending.switch",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];await edit("policies",policy.id);await fill(field("name"),"Pending while sending changes");
      await click('[data-notifications-switch]');await at('[data-notifications-switch]:checked:not(:disabled)').waitFor({timeout:45000});await at(field("name")).waitFor({timeout:30000});
      assert.equal((await snapshot()).notifications,true);assert.deepEqual((await snapshot()).monitoring_policies,before.monitoring_policies);
      await click('[data-notifications-switch]');await at('[data-notifications-switch]:not(:checked):not(:disabled)').waitFor({timeout:45000});await at(field("name")).waitFor({timeout:30000});
      assert.equal((await snapshot()).notifications,false);assert.equal(await savedName(),"Pending while sending changes");await discard();
      return "Global sending toggled only inside isolated HA; all routes are laboratory capture services.";
    });
  }

  if(group==="all"||group==="notifications") {
    await clean();
    await run("profiles.list",async()=>{
      await listing("profiles");const profiles=(await snapshot()).notification_definitions.profiles;
      assert.equal(Object.keys(profiles).length,6);assert.equal(await at(`${action("edit")}[data-definition-kind="profiles"]`).count(),6);
      for(const id of Object.keys(profiles)) {
        await menu("profiles",id,"delete");await click(action("cancel-delete"));
        assert.ok((await snapshot()).notification_definitions.profiles[id]);
      }
      await listing("methods");assert.ok(await at(`${action("edit")}[data-definition-kind="methods"]`).count());await listing("profiles");
    });
    await run("profiles.create",async()=>{const before=await snapshot();await add("profiles","Abandoned notification");await noChange(before);await discard();await noChange(before);assert.ok(!(await bodyText()).includes("Abandoned notification"));});
    await run("profiles.invalid",async()=>{const before=await snapshot();await edit("profiles","morning");await fill(field("name"),"");await click(action("save-scoped"));assert.equal(await at(field("name")).evaluate(el=>el.validity.valueMissing),true);await noChange(before);await discard();});
    await run("profiles.save",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];await edit("policies",policy.id);await fill(field("name"),"Unrelated draft");
      await edit("profiles","morning");await fill(field("timing:at"),"09:17");await check(`${field("methods")}[data-definition-value="lab_messages"]`,true);await save();
      const saved=await snapshot();assert.equal(saved.notification_definitions.profiles.morning.timing.at,"09:17");assert.ok(saved.notification_definitions.profiles.morning.methods.includes("lab_messages"));
      const expected=structuredClone(before);expected.notification_definitions.profiles.morning=structuredClone(saved.notification_definitions.profiles.morning);assert.deepEqual(saved,expected);
      assert.deepEqual(saved.monitoring_policies,before.monitoring_policies);assert.equal(await at(action("save-scoped")).count(),0);
      const editButton=at(`${action("edit")}[data-definition-id="morning"]`);assert.equal(await editButton.evaluate(el=>el.getRootNode().activeElement===el),true);
      assert.ok(!(await bodyText()).includes("Changes saved."));await edit("policies",policy.id);assert.equal(await savedName(),"Unrelated draft");await discard();
    });
    await run("profiles.discard",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];await edit("policies",policy.id);await fill(field("name"),"Preserved discard companion");
      await edit("profiles","morning");await fill(field("name"),"Discard notification draft");await discard();assert.equal(await savedName(),before.notification_definitions.profiles.morning.name);await noChange(before);
      await edit("policies",policy.id);assert.equal(await savedName(),"Preserved discard companion");await discard();
    });
    await run("profiles.timing",async()=>{
      const timezone=(await snapshot()).notification_definitions.timezone;
      for(const mode of ["immediate","acknowledge","window","report"]) {
        await edit("profiles","weekly");await choose(field("timing:mode"),mode);
        if(mode==="acknowledge") {const before=await snapshot();await fill(field("timing:minutes"),"0");await click(action("save-scoped"));assert.equal(await at(field("timing:minutes")).evaluate(el=>el.validity.valid),false);await noChange(before);await fill(field("timing:minutes"),"45");}
        if(mode==="window"){await fill(field("timing:start"),"07:15");await fill(field("timing:end"),"21:30");}
        if(mode==="report"){await fill(field("timing:at"),"10:17");for(const value of await at(field("timing:weekdays")).evaluateAll(els=>els.map(el=>el.dataset.definitionValue)))await check(`${field("timing:weekdays")}[data-definition-value="${value}"]`,value==="6");}
        await save();const definition=(await snapshot()).notification_definitions.profiles.weekly;assert.equal(definition.timing.mode,mode);
        if(mode==="acknowledge")assert.equal(definition.timing.remind_every,2700);
        if(mode==="window")assert.deepEqual([definition.timing.start,definition.timing.end],["07:15","21:30"]);
        if(mode==="report"){assert.equal(definition.timing.at,"10:17");assert.deepEqual(definition.timing.weekdays,[6]);}
      }
      assert.equal((await snapshot()).notification_definitions.timezone,timezone);
    });
    await run("profiles.duplicate",async()=>{
      const original=(await snapshot()).notification_definitions.profiles.morning;await menu("profiles","morning","duplicate");const id=await currentId();await fill(field("name"),"Acceptance copy");await save();
      const copy=(await snapshot()).notification_definitions.profiles[id];assert.deepEqual(copy,{...original,name:"Acceptance copy"});await edit("profiles",id);assert.equal(await savedName(),"Acceptance copy");
      await menu("profiles",id,"delete");await deleteConfirm();assert.ok(!(await snapshot()).notification_definitions.profiles[id]);
    });
    await run("profiles.delete-cancel",async()=>{const before=await snapshot();await menu("profiles","morning","delete");await click(action("cancel-delete"));await noChange(before);});
    for(const resolution of ["urgent","remove-rows"])await run(resolution==="urgent"?"profiles.delete-replace":"profiles.delete-remove",async()=>{
      const profile=await add("profiles",`Acceptance deletion ${resolution}`);await save();const policy=await addPolicy("entity",`Acceptance uses ${resolution}`);
      while(await at(action("remove-row")).count())await click(action("remove-row"));await choose('.policy-notification-add select',profile);await save();
      const before=await snapshot(),row=before.monitoring_policies.find(p=>p.id===policy).notifications[0];
      await menu("profiles",profile,"delete");assert.equal(await at(action("confirm-delete")).isDisabled(),true);await choose('[data-definition-delete-resolution]',resolution);await deleteConfirm();
      const saved=await snapshot(),rows=saved.monitoring_policies.find(p=>p.id===policy).notifications;assert.ok(!saved.notification_definitions.profiles[profile]);
      if(resolution==="urgent")assert.deepEqual(rows,[{...row,profile:"urgent"}]);else assert.deepEqual(rows,[]);
      assert.deepEqual(saved.monitoring_policies.filter(p=>p.id!==policy),before.monitoring_policies.filter(p=>p.id!==policy));await menu("policies",policy,"delete");await deleteConfirm();
    });
    await run("profiles.delete-draft",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies.find(p=>p.notifications.some(n=>n.profile==="morning"));assert.ok(policy);
      await edit("policies",policy.id);await fill(field("name"),"Using policy draft");await menu("profiles","morning","delete");await choose('[data-definition-delete-resolution]',"urgent");await click(action("confirm-delete"));
      await at('.config-error').filter({hasText:"Save or discard"}).waitFor({timeout:15000});await noChange(before);await click(action("cancel-delete"));await edit("policies",policy.id);assert.equal(await savedName(),"Using policy draft");await discard();
    });
    await run("methods.lifecycle",async()=>{
      const before=await snapshot();await add("methods","Abandoned method");assert.equal(await at(action("test-method")).count(),0);await discard();await noChange(before);
      await menu("methods","lab_messages","duplicate");const id=await currentId();await fill(field("name"),"Acceptance method copy");await save();
      const copy=(await snapshot()).notification_definitions.methods[id];assert.deepEqual(copy.destinations,before.notification_definitions.methods.lab_messages.destinations);
      await edit("methods",id);await fill(field("name"),"Discard method draft");await discard();assert.equal(await savedName(),"Acceptance method copy");
      await menu("methods",id,"delete");await click(action("cancel-delete"));assert.ok((await snapshot()).notification_definitions.methods[id]);
      await menu("methods",id,"delete");await deleteConfirm();await noChange(before);
    });
    await run("live.methods.destinations",async()=>{
      const before=await snapshot();await edit("methods","lab_messages");const original=before.notification_definitions.methods.lab_messages.destinations[0];
      await click(`${action("destination-remove")}[data-destination-channel="${original}"]`);await click(action("destination-open"));
      await choose('[data-definition-delivery-type]',"notification");await fill('[data-definition-delivery-search]',"no-such-destination");assert.equal(await at(action("destination-add")).count(),0);
      await fill('[data-definition-delivery-search]',"");await click(`${action("destination-add")}[data-destination-channel="${original}"]`);
      await click(action("destination-open"));await page.keyboard.press("Escape");assert.equal(await at(action("destination-open")).first().evaluate(el=>el.getRootNode().activeElement===el),true);
      await fill(field("name"),"Acceptance destination edit");await save();assert.deepEqual((await snapshot()).notification_definitions.methods.lab_messages.destinations,[original]);
      await edit("methods","lab_messages");assert.ok(await at(`${action("destination-remove")}[data-destination-channel="${original}"]`).count());
      return "Generic destination remove/search/add, native Escape, save/reopen. Other providers remain fixture-covered unless explicitly selected in this run.";
    });
    await run("live.methods.available-types",async()=>{
      const id=await add("methods","Acceptance all lab destinations");await click(action("destination-open"));
      const types=await at('[data-definition-delivery-type] option').evaluateAll(els=>els.map(el=>el.value).filter(Boolean));await click(action("destination-close"));
      const expected=[];
      for(const type of types) {
        await click(action("destination-open"));await choose('[data-definition-delivery-type]',type);
        if(type==="sms") {
          await fill('[data-definition-sms-number]',"invalid");await click(action("destination-add-sms"));assert.ok((await bodyText()).includes("5–15 digits"));
          await fill('[data-definition-sms-number]',"+15551234567");const prefix=await at(action("destination-add-sms")).first().getAttribute("data-destination-channel");await click(action("destination-add-sms"));expected.push(prefix+encodeURIComponent("+15551234567"));
        } else {
          const provider=at(action("destination-speaker"));if(await provider.count()) {await provider.first().click();await click(action("destination-back"));await provider.first().click();}
          const destination=at(action("destination-add")).first();expected.push(await destination.getAttribute("data-destination-channel"));await destination.click();
        }
      }
      await save();assert.deepEqual((await snapshot()).notification_definitions.methods[id].destinations,expected);
      await edit("methods",id);assert.equal(await at(action("destination-remove")).count(),expected.length);
      await menu("methods",id,"delete");await deleteConfirm();return `Selected and saved every delivery type exposed by this HA lab: ${types.join(", ")}.`;
    });
    await run("live.methods.presence",async()=>{
      const before=await snapshot(),method=before.notification_definitions.methods.lab_presence,person=lab.entities.owner;
      await edit("methods","lab_presence");assert.equal(await at(field("mode")).inputValue(),"home_away");
      assert.equal(await at(`${field("people")}[data-person="${person}"]`).isChecked(),true);
      await check(field("skip"),true);await save();assert.equal((await snapshot()).notification_definitions.methods.lab_presence.skip,true);
      await edit("methods","lab_presence");await check(field("skip"),false);
      for(const fallback of method.fallback) {
        await click(`${action("destination-open")}[data-destination-field="fallback"]`);await choose('[data-definition-delivery-type]',"notification");
        await click(`${action("destination-add")}[data-destination-channel="${fallback}"]`);
      }
      await save();
      assert.deepEqual((await snapshot()).notification_definitions.methods.lab_presence,method);
      await edit("methods","lab_presence");await choose(field("mode"),"home_people");await check(`${field("people")}[data-person="${person}"]`,true);
      const destinationField=`person_destinations:${person}`;await click(`${action("destination-open")}[data-destination-field="${destinationField}"]`);
      await choose('[data-definition-delivery-type]',"app");const target=await at(action("destination-add")).first().getAttribute("data-destination-channel");await click(action("destination-add"));await check(field("skip"),true);await save();
      const saved=(await snapshot()).notification_definitions.methods.lab_presence;assert.deepEqual(saved.people,[person]);assert.deepEqual(saved.person_destinations[person],[target]);assert.equal(saved.skip,true);
      await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:person,state:"not_home"});await edit("methods","lab_presence");await click(action("test-method"));await at('.method-test [role="status"]').filter({hasText:"test was skipped"}).waitFor({timeout:20000});
      await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:person,state:"home"});assert.equal((await snapshot()).notifications,false);
      return "Actual person identity, home/away fallback, per-person destinations and skip test exercised; no physical notification sent.";
    });
    await run("live.methods.tests",async()=>{
      await edit("methods","lab_messages");await fill(field("name"),"Dirty method");assert.equal(await at(action("test-method")).count(),0);await discard();
      const before=await call("homeostatic_ui_lab/control",{action:"status"});await call("homeostatic_ui_lab/control",{action:"delivery_mode",mode:"capture"});
      await click(action("test-method"));await at('[role="status"]').filter({hasText:/Test requested/}).waitFor({timeout:20000});
      const after=await call("homeostatic_ui_lab/control",{action:"status"});assert.notDeepEqual(after,before);
      await call("homeostatic_ui_lab/control",{action:"delivery_mode",mode:"fail"});await click(action("test-method"));await at('[role="status"]').filter({hasText:/No test requests succeeded|failed/i}).waitFor({timeout:20000});
      await call("homeostatic_ui_lab/control",{action:"delivery_mode",mode:"capture"});assert.equal((await snapshot()).notifications,false);
      return "Explicit clean saved-method tests reached capture-only HA services; requested and failed UI outcomes checked; no physical delivery is claimed.";
    });
    await run("save.failure",async()=>{
      const before=await snapshot();await edit("profiles","urgent");await fill(field("name"),"Acceptance rejected draft");transport.mode="reject";await click(action("save-scoped"));
      await at('.config-error').filter({hasText:"Acceptance transport rejected"}).waitFor();assert.equal(await savedName(),"Acceptance rejected draft");await noChange(before);
      await save();assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Acceptance rejected draft");
      return "Browser transport rejected one request before backend write; exact draft survived and deliberate retry persisted to real HA.";
    });
    await run("live.save.pending",async()=>{
      await edit("profiles","urgent");await fill(field("name"),"Acceptance held draft");const count=transport.saveRequests;transport.mode="hold";await click(action("save-scoped"));
      await at(action("save-scoped")).filter({hasText:/Saving/}).waitFor();assert.equal(await at(action("save-scoped")).isDisabled(),true);assert.equal(transport.saveRequests,count+1);
      transport.release();await at(action("save-scoped")).waitFor({state:"hidden",timeout:30000});assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Acceptance held draft");
      return "One browser save held at transport boundary; visible pending state and disabled repeat submission verified, then real backend save completed.";
    });
    await run("save.uncertain",async()=>{
      await edit("profiles","urgent");await fill(field("name"),"Acceptance applied response lost");transport.mode="uncertain";await click(action("save-scoped"));
      await at('.config-error').filter({hasText:"Acceptance transport lost"}).waitFor();assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Acceptance applied response lost");assert.equal(await savedName(),"Acceptance applied response lost");
      const requests=transport.saveRequests;await save();assert.equal(transport.saveRequests,requests);
      return "Real HA applied save; browser proxy substituted an error for its successful response. Explicit retry inspected backend state and issued no duplicate write.";
    });
    await run("save.refresh-failure",async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];await edit("policies",policy.id);await fill(field("name"),"Draft during reread failure");
      await edit("profiles","urgent");await fill(field("name"),"Acceptance saved reread failed");transport.mode="refresh-fail";await click(action("save-scoped"));
      await at('.config-error').filter({hasText:/were saved.*could not be reloaded/}).waitFor({timeout:20000});assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Acceptance saved reread failed");
      await edit("policies",policy.id);assert.equal(await savedName(),"Draft during reread failure");await discard();await clean();
      return "Real save confirmed, next browser configuration reread rejected; saved-versus-refresh-failed feedback and unrelated draft retained.";
    });
    await run("save.conflict",async()=>{
      await edit("profiles","urgent");await fill(field("name"),"Acceptance conflicting draft");
      const configuration=await call("homeostatic/configuration"),settings=structuredClone(configuration.settings);settings.notification_definitions.profiles.urgent.name="Acceptance concurrent saved edit";
      await call("homeostatic/save_settings",{revision:configuration.revision,settings});await click(action("save-scoped"));
      await at('.config-error').filter({hasText:/changed|refresh|preserved/i}).waitFor({timeout:20000});
      assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Acceptance concurrent saved edit");assert.equal(await savedName(),"Acceptance conflicting draft");await clean();
      return "Independent authenticated connection saved a concurrent edit; UI retained its conflicting draft and did not overwrite newer backend settings.";
    });
  }

  if(group==="all"||group==="issues") {
    await run("live.issues.browse",async()=>{
      const before=await snapshot();await go("problems");
      for(const button of await at('[data-issue-group]').all())if(await button.getAttribute("aria-expanded")==="false")await button.click();
      assert.ok(await at('[data-episode]').count(),"Seeded problems are reachable");
      for(const sort of ["oldest","newest","name","importance"])await choose('[data-issue-sort]',sort);
      await fill('[data-issue-search]',"not-a-real-acceptance-issue");assert.ok((await bodyText()).includes("No matching issues"));await click('[data-action="clear-issue-search"]');
      const episodes=await at('[data-episode]').evaluateAll(els=>els.map(el=>el.dataset.episode));
      for(const episode of episodes){await click(`[data-episode="${episode}"]`);assert.ok(await at('dialog[open] h2').innerText());const details=at('dialog[open] summary');if(await details.count()){await details.first().click();await details.first().click();}await click('dialog[open] [data-action="close"]');}
      await noChange(before);return `Opened ${episodes.length} actual issue dialogs; search, sort and disclosure clicks. Seed does not establish pagination/large hierarchy variants.`;
    });
    await run("live.issues.controls",async()=>{
      await go("problems");for(const button of await at('[data-issue-group]').all())if(await button.getAttribute("aria-expanded")==="false")await button.click();
      const episode=await at('[data-episode]').first().getAttribute("data-episode");assert.ok(episode);
      await click(`[data-episode="${episode}"]`);await click('[data-acknowledge]');await at('dialog[open] button[type="submit"]').click();
      await at('dialog[open]').filter({hasText:"Awareness recorded"}).waitFor({timeout:20000});await page.keyboard.press("Escape");
      await click(`[data-episode="${episode}"]`);await at('dialog[open]').filter({hasText:"Acknowledged"}).waitFor({timeout:20000});
      await click('[data-shelf]');const end=new Date(Date.now()+3600000);const local=new Date(end.getTime()-end.getTimezoneOffset()*60000).toISOString().slice(0,16);
      await fill('dialog[open] [name="untilLocal"]',local);await click('dialog[open] button[type="submit"]');
      await at('dialog[open]').filter({hasText:/Notifications paused|Saved/}).waitFor({timeout:20000});await page.keyboard.press("Escape");
      await click(`[data-episode="${episode}"]`);await at('dialog[open]').filter({hasText:"Until"}).waitFor({timeout:20000});await click('dialog[open] [data-cancel-control]');await click('dialog[open] button[type="submit"]');
      await at('dialog[open]').filter({hasText:"selected control has ended"}).waitFor({timeout:20000});await page.keyboard.press("Escape");
      return `Acknowledged and paused/resumed actual issue ${episode}; unsupported uncertain-response injection remains fixture-only.`;
    });
    await run("live.sources.browse",async()=>{
      const before=await snapshot();await go("sources");await at('[data-sources-search]').waitFor();
      for(const mode of ["all","monitored","unmonitored","all"])await choose('[data-sources-monitoring]',mode);
      await click('[data-sources-filters]');await check('[data-sources-disabled]',true);await page.keyboard.press("Escape");
      await click('[data-sources-filters]');await check('[data-sources-disabled]',false);await check('[data-sources-excluded]',true);await page.keyboard.press("Escape");
      await click('[data-sources-filters]');await check('[data-sources-excluded]',false);await page.keyboard.press("Escape");
      for(const mode of ["location","integration"])await choose('[data-sources-group]',mode);
      await fill('[data-sources-search]',lab.entities?.offline||"sensor.ui_lab_offline");assert.ok(await at('[data-sources-select]').count());
      await at('[data-sources-select]').last().click();assert.ok(await at('#sources-detail-title').innerText());
      const history=at('[data-sources-view]');if(await history.count()){await history.click();assert.ok((await bodyText()).includes("History"));await at('[data-sources-view]').click();}
      if(!await at('[data-sources-search]').isVisible())await click('[data-action="back-sources"]');
      await fill('[data-sources-search]',"");await noChange(before);
      return "Real Monitoring search, filters, grouping, selected source and contextual history checked without configuration writes.";
    });
    await run("live.sources.availability",async()=>{
      const before=await snapshot();await go("sources");await fill('[data-sources-search]',lab.entities.offline);await at('[data-sources-select]').last().click();
      await click('[data-availability-action="stop"]');await click('[data-availability-action="cancel"]');await noChange(before);
      await click('[data-availability-action="stop"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="confirm"]').waitFor({state:"hidden",timeout:45000});
      const after=await snapshot();assert.ok(after.monitoring_policies.some(p=>(p.excluded_sources||[]).length));
      assert.deepEqual(after.notification_definitions,before.notification_definitions);assert.equal(after.notifications,before.notifications);
      await at('[data-availability-action="resume"]').waitFor({timeout:30000});await click('[data-availability-action="resume"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="confirm"]').waitFor({state:"hidden",timeout:45000});await noChange(before);
      return "Entity availability remove/cancel/confirm/resume persisted only policy exclusions and restored original settings.";
    });
    await run("sources.maintenance",async()=>{
      const before=await snapshot();
      const service=async(name,service_data={})=>(await call("call_service",{domain:"homeostatic",service:name,service_data,return_response:true})).response;
      const controls=async()=>(await service("operator_controls")).controls;
      const existing=await controls();
      await go("sources");await fill('[data-sources-search]',lab.entities.offline);await at('[data-sources-select]').last().click();
      assert.equal(await at('[data-maintenance]').count(),0,"Entity details offer no new-maintenance action");
      const node_id=(await at('[data-sources-select][aria-current]').getAttribute("data-sources-select")).slice("source:".length);
      const first=(await service("start_maintenance",{node_id,until:new Date(Date.now()+1800000).toISOString(),reason:"Existing API-created window"})).control;
      const overlap=(await service("start_maintenance",{node_id,until:new Date(Date.now()+60000).toISOString(),reason:"Separate overlapping window"})).control;
      await clean();await go("sources");await fill('[data-sources-search]',lab.entities.offline);await at(`[data-sources-select="source:${node_id}"]`).click();
      await at(`[data-cancel-control="${first.control_id}"]`).waitFor();
      assert.equal(await at('[data-maintenance]').count(),0,"Existing maintenance does not restore its creation action");
      assert.ok((await at('.config-detail').innerText()).includes("Until"),"Existing maintenance retains visible expiry");
      assert.ok((await at('.config-detail').innerText()).includes(first.reason),"Existing maintenance retains its saved reason");
      await click(`[data-cancel-control="${first.control_id}"]`);await page.keyboard.press("Escape");
      assert.deepEqual(await controls(),[...existing,first,overlap],"Closing confirmation leaves both windows saved");
      await click(`[data-cancel-control="${first.control_id}"]`);await click('dialog[open] [type="submit"]');await at('dialog[open]').filter({hasText:"selected control has ended"}).waitFor({timeout:20000});await page.keyboard.press("Escape");
      assert.deepEqual(await controls(),[...existing,overlap],"Ending the selected window preserves its overlap");
      await at(`[data-cancel-control="${first.control_id}"]`).waitFor({state:"hidden"});await at(`[data-cancel-control="${overlap.control_id}"]`).waitFor();
      await call("homeostatic_ui_lab/control",{action:"advance",seconds:120});
      await at(`[data-cancel-control="${overlap.control_id}"]`).waitFor({state:"hidden",timeout:20000});
      assert.deepEqual(await controls(),existing,"Expiry removes the remaining maintenance window");await noChange(before);
      return "Entity Monitoring has no creation action. Seeded two windows through the retained API in isolated HA, checked visible expiry/reason, closed one confirmation without mutation, ended exactly one window through rendered controls and observed the other expire. Monitoring and notification settings stayed unchanged.";
    });
    await run("live.history.browse",async()=>{
      const before=await snapshot();await go("history");await at('[data-history-toggle]').first().waitFor();
      const row=at('[data-history-toggle]').first();await row.click();assert.equal(await row.getAttribute("aria-expanded"),"true");assert.ok(await at('.history-content:visible').innerText());await row.click();assert.equal(await row.getAttribute("aria-expanded"),"false");
      await fill('[data-history-search]',"no-past-acceptance-issue");assert.equal(await at('[data-history-toggle]').count(),0);await fill('[data-history-search]',"");
      const choices=await at('[data-history-filter] option').evaluateAll(els=>els.map(el=>el.value));for(const choice of choices)await choose('[data-history-filter]',choice);await choose('[data-history-filter]',"");await noChange(before);
      return "Seeded retained history inline expand/collapse, search and outcome filters; no pagination or absorbed-issue claim.";
    });
    await run("live.navigation.history",async()=>{
      await go("policies");const policyUrl=page.url();await go("history");const historyUrl=page.url();assert.notEqual(policyUrl,historyUrl);
      await page.goBack();await at('.header [data-page="policies"][aria-current="page"]').waitFor();await page.goForward();await at('.header [data-page="history"][aria-current="page"]').waitFor();
      await page.reload();await at('.header [data-page="history"][aria-current="page"]').waitFor({timeout:30000});
    });
  }
  const context={page,lab,call,record,artifactDir,group,card,at,bodyText,action,field,snapshot,click,fill,choose,check,clean,go,listing,edit,menu,save,discard,deleteConfirm,add,addPolicy,noChange,selected,transport,savedName,currentId,run:(id,body)=>run(id,body,true)};
  for(const [name,fn] of [["policies","runPolicyGaps"],["notifications","runNotificationGaps"],["issues","runIssueGaps"],["layout","runLayoutGaps"]])if(group==="all"||group===name){
    const module=await import(`./ui_acceptance_gaps_${name}.mjs`);
    console.log(`live setup ${name} fixture reset`);
    await page.goto("about:blank");Object.assign(lab,await call("homeostatic_ui_lab/control",{action:"reset"}));await clean();
    await module[fn](context);
  }
  await writeFile(join(artifactDir,`${group}-live-cases.json`),JSON.stringify(caseResults,null,2)+"\n","utf8");
  return caseResults;
}
