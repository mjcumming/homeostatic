/** Complete policy contracts against a disposable real Home Assistant instance. */
import assert from "node:assert/strict";

export async function runPolicyGaps(ctx) {
  const {page,lab,call,run,at,bodyText,action,field,snapshot,click,fill,choose,check,clean,go,listing,edit,menu,save,discard,deleteConfirm,addPolicy,noChange,transport}=ctx;
  const policy=(settings,id)=>settings.monitoring_policies.find(p=>p.id===id);
  const currentId=()=>at(field("name")).getAttribute("data-definition-id");
  const name=()=>at(field("name")).inputValue();
  const selection=id=>`${field("selection")}[data-definition-value="${id}"]`;
  const focus=async selector=>assert.equal(await at(selector).first().evaluate(el=>el.getRootNode().activeElement===el),true,`${selector} should retain focus`);
  const reset=async()=>{await page.goto("about:blank");Object.assign(lab,await call("homeostatic_ui_lab/control",{action:"reset"}));await clean();};
  const setup=async mutate=>{await page.goto("about:blank");const config=await call("homeostatic/configuration");const settings=structuredClone(config.settings);mutate(settings);await call("homeostatic/save_settings",{revision:config.revision,settings});await noChange(settings);await clean();return settings;};
  const test=async(id,body)=>run(id,async()=>{await reset();return body();});
  const expectPolicy=async(before,id,expected)=>{const next=structuredClone(before),index=next.monitoring_policies.findIndex(p=>p.id===id);if(expected!==null){expected=structuredClone(expected);for(const values of Object.values(expected.match))values.sort();}if(expected===null)next.monitoring_policies.splice(index,1);else if(index<0)next.monitoring_policies.push(expected);else next.monitoring_policies[index]=expected;await noChange(next);return next;};
  const savePolicy=async(before,id,expected)=>{const requests=transport.saveRequests;await save();assert.equal(transport.saveRequests,requests+1);return expectPolicy(before,id,expected);};
  const removeRows=async()=>{while(await at(action("remove-row")).count())await click(action("remove-row"));};
  const rows=()=>at('.policy-notification-row [data-row-field="profile"]').evaluateAll(els=>els.map(el=>({id:el.dataset.rowId,profile:el.value})));
  const waitError=()=>at(".config-error").filter({hasText:"Acceptance transport rejected"}).waitFor();
  const companion=async()=>{await edit("profiles","morning");await fill(field("name"),"Unrelated notification draft");};
  const checkCompanion=async()=>{await edit("profiles","morning");assert.equal(await name(),"Unrelated notification draft");};
  const waitCatalog=()=>at(`${field("selection")}`).first().waitFor();
  const invalid=async(before,selector,value)=>{const requests=transport.saveRequests;await fill(selector,value);await click(action("save-scoped"));assert.equal(transport.saveRequests,requests,"Invalid form must not submit");assert.equal(await at(selector).inputValue(),String(value));assert.ok(!await at(selector).evaluate(el=>el.validity.valid)||await at('[aria-invalid="true"]').count()>0);await noChange(before);};
  const observeRequest=type=>{
    let resolve,settled=false;const outcome=new Promise(done=>{resolve=done;});
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);page.off("close",closed);if(transport.interceptRequest===handler)transport.interceptRequest=null;resolve(result);};
    const handler=request=>{if(request.type===type)finish({request});return false;};
    const closed=()=>finish({error:Error(`Page closed while waiting for ${type}`)});
    const timer=setTimeout(()=>finish({error:Error(`No ${type} request within 30 seconds`)}),30000);timer.unref?.();
    transport.interceptRequest=handler;page.once("close",closed);if(page.isClosed())closed();
    // The stored outcome never rejects before the caller finishes its action.
    return async()=>{const result=await outcome;if(result.error)throw result.error;return result.request;};
  };

  await test("policies.lifecycle",async()=>{
    const initial=await snapshot();await companion();
    const custom=await addPolicy("entity","Lifecycle custom");await check(field("enabled"),true);await save();
    let saved=await snapshot();const created=policy(saved,custom);
    assert.equal(created.name,"Lifecycle custom");assert.equal(created.enabled,true);assert.equal(created.check,"availability");assert.deepEqual(created.match,{kind:["entity"]});
    await expectPolicy(initial,custom,created);
    for(const id of [custom,"default_batteries"]){
      const original=policy(saved,id);await edit("policies",id);await fill(field("name"),`${original.name} edited`);await check(field("enabled"),!original.enabled);
      saved=await savePolicy(saved,id,{...original,name:`${original.name} edited`,enabled:!original.enabled});
      await edit("policies",id);assert.equal(await name(),`${original.name} edited`);assert.equal(await at(field("enabled")).isChecked(),!original.enabled);
      await fill(field("name"),"Discard this exact policy draft");await check(field("enabled"),original.enabled);await discard();assert.equal(await name(),`${original.name} edited`);assert.equal(await at(field("enabled")).isChecked(),!original.enabled);await noChange(saved);
      await menu("policies",id,"duplicate");const copy=await currentId();assert.notEqual(copy,id);await fill(field("name"),`${original.name} independent copy`);await check(field("enabled"),true);await noChange(saved);
      saved=await savePolicy(saved,copy,{...policy(saved,id),id:copy,name:`${original.name} independent copy`,enabled:true});
      await edit("policies",copy);assert.equal(await name(),`${original.name} independent copy`);
      for(const target of [copy,id]){await menu("policies",target,"delete");await click(action("cancel-delete"));await noChange(saved);await menu("policies",target,"delete");await deleteConfirm();saved=await expectPolicy(saved,target,null);}
    }
    await checkCompanion();await noChange(saved);
    return "Custom and supplied policies: exact add/edit/enable/disable/duplicate/discard/delete/cancel effects; full installation snapshots and independent notification draft checked.";
  });

  await test("policies.scope",async()=>{
    const id="lab_temperature",before=await snapshot(),source=`registry:${lab.registry_ids.temperature}`;
    await page.goto("about:blank");transport.commandModes.set("homeostatic/catalog","hold");const requested=observeRequest("homeostatic/catalog");await clean();await edit("policies",id);await requested();
    assert.match(await bodyText(),/Loading available sources/);assert.match(await bodyText(),/Saved selection/);assert.match(await bodyText(),new RegExp(source));
    await click(action("pick"));assert.doesNotMatch(await bodyText(),/No temperature sensors available|No temperature sensors match/);await noChange(before);
    transport.release("reject");await at('[data-action="retry-catalog"]').waitFor();assert.match(await bodyText(),/Could not load available sources/);await noChange(before);
    await click('[data-action="retry-catalog"]');await at(selection(source)).waitFor();assert.equal(await at(selection(source)).isChecked(),true);await click(action("finish-pick"));
    let saved=before;
    for(const [mode,selectorKey,value] of [["all",null,null],["selected","entity",source],["all_except","excluded_sources",`entity:${source}`]]){
      await choose(field("watch"),mode);const expected={...policy(saved,id),match:{kind:["entity"]}};delete expected.excluded_sources;
      if(selectorKey){await click(action("pick"));await fill('[data-definition-picker-search]',lab.entities.temperature);await at(selection(value)).check();await check('[data-definition-picker-selected]',true);assert.equal(await at(field("selection")).count(),1);await fill('[data-definition-picker-search]',"no-such-lab-source");assert.equal(await at(field("selection")).count(),0);assert.match(await bodyText(),/match your search/);await fill('[data-definition-picker-search]',"");assert.equal(await at(selection(value)).isChecked(),true);await click(action("finish-pick"));if(mode==="all_except")expected.excluded_sources=[value];else expected.match[selectorKey]=[value];}
      saved=await savePolicy(saved,id,expected);await edit("policies",id);assert.equal(await at(`${field("watch")}:checked`).inputValue(),mode);
    }
    await choose(field("watch"),"selected");const requests=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,requests);assert.match(await bodyText(),/Choose at least one/);await noChange(saved);await discard();
    return "Real catalog held, rejected and retried; saved identity retained; All, selected and canonical exclusions saved exactly; no-match and selected-only filters preserve selections; empty scope blocked.";
  });

  await test("policies.picker-context",async()=>{
    await companion();const before=await snapshot(),id="lab_temperature";await edit("policies",id);await click(action("pick"));await waitCatalog();
    await fill('[data-definition-picker-search]',"Lab identical temperature");assert.equal(await at(field("selection")).count(),2);
    const duplicates=await at('.policy-picker-choice').allInnerTexts();for(const text of duplicates){assert.match(text,/Office/);assert.match(text,/Ground floor/);}assert.notEqual(duplicates[0],duplicates[1]);
    const chosen=`registry:${lab.registry_ids.temperature_0}`;await check(selection(chosen),true);await check('[data-definition-picker-selected]',true);assert.equal(await at(field("selection")).count(),1);await fill('[data-definition-picker-search]',"unmatched source");assert.equal(await at(field("selection")).count(),0);await fill('[data-definition-picker-search]',"Office");assert.equal(await at(selection(chosen)).isChecked(),true);await click(action("finish-pick"));await focus(action("pick"));
    let saved=await savePolicy(before,id,{...policy(before,id),match:{entity:[`registry:${lab.registry_ids.temperature}`,chosen]}});
    for(const [mode,collection,relevant,empty,expectedCount] of [["area",lab.areas,"Office","Future room",23],["label",lab.labels,"Lab temperature","Future equipment",45]]){
      await edit("policies",id);await choose(field("watch"),mode);await click(action("pick"));await waitCatalog();
      const relevantChoice=at('.policy-picker-choice').filter({has:page.locator(selection(collection[relevant]))});
      assert.match(await relevantChoice.innerText(),new RegExp(`${expectedCount} temperature sensors`));assert.equal(await at(selection(collection[empty])).count(),0);
      await check('[data-definition-picker-all]',true);assert.match(await at('.policy-picker-choice').filter({has:page.locator(selection(collection[empty]))}).innerText(),/No temperature sensors/);
      await check(selection(collection[empty]),true);await check('[data-definition-picker-all]',false);assert.equal(await at(selection(collection[empty])).isChecked(),true);
      await check(selection(collection[relevant]),true);await check('[data-definition-picker-selected]',true);assert.equal(await at(field("selection")).count(),2);
      await fill('[data-definition-picker-search]',empty);assert.equal(await at(field("selection")).count(),1);await fill('[data-definition-picker-search]',"");await click(action("finish-pick"));
      const expected={...policy(saved,id),match:{kind:["entity"],[mode]:[collection[empty],collection[relevant]]}};saved=await savePolicy(saved,id,expected);await edit("policies",id);assert.match(await at('.policy-selected-sources').innerText(),new RegExp(empty));
    }
    await checkCompanion();await noChange(saved);
    return "Duplicate sensor names retain distinct IDs and location/floor; exact eligible area/label counts, empty-group Show all, selected-only/search retention and full scoped saves verified.";
  });

  await test("policies.detection",async()=>{
    let saved=await snapshot();
    for(const type of ["integration","device","entity","battery","vacuum","repair","broken_automation","thermostat","temperature_limit","ups_power","ups_reserve","ups_battery_replacement","ups_fault"]){
      const id=await addPolicy(type,`Detection ${type}`);const expected={id,name:`Detection ${type}`,check:["integration","device","entity"].includes(type)?"availability":type,match:{kind:[["integration","device","entity"].includes(type)?type:type.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(type)?"entity":type]},parameters:{},enabled:false};
      if(type==="battery"){for(const bad of ["-1","101","25.5"])await invalid(saved,field("parameters:threshold"),bad);await fill(field("parameters:threshold"),"25");expected.parameters={threshold:25};}
      if(type==="thermostat"){
        for(const key of ["margin","progress","worsening","progress_seconds"])await invalid(saved,field(`parameters:${key}`),"-1").then(()=>fill(field(`parameters:${key}`),key==="progress_seconds"?"120":"9"));
        await choose(field("parameters:unit"),"°C");for(const key of ["margin","progress","worsening"])assert.equal(Number(await at(field(`parameters:${key}`)).inputValue()),5);
        await choose(field("parameters:unit"),"K");expected.parameters={unit:"K",margin:5,progress:5,worsening:5,progress_seconds:120};
      }
      if(type==="temperature_limit"){await fill(field("parameters:minimum"),"32");await fill(field("parameters:maximum"),"212");await choose(field("parameters:unit"),"°C");assert.equal(await at(field("parameters:minimum")).inputValue(),"0");assert.equal(await at(field("parameters:maximum")).inputValue(),"100");await choose(field("parameters:unit"),"K");expected.parameters={unit:"K",minimum:273.15,maximum:373.15,duration_seconds:0};}
      if(type==="ups_reserve"){
        await at(field("parameters:charge_low")).waitFor();for(const [key,value] of [["charge_low",25],["charge_clear",35],["runtime_low_minutes",4.5],["runtime_clear_minutes",7.5]]){await invalid(saved,field(`parameters:${key}`),"-1");await fill(field(`parameters:${key}`),value);expected.parameters[key]=value;}expected.parameters.replace_battery_check=false;
      }
      expected.notifications=(await rows()).map(row=>type==="ups_reserve"?{...row,when:null}:row);
      if(type==="ups_reserve")for(const row of expected.notifications)row.when=await at(`[data-row-id="${row.id}"][data-row-field="when"]`).inputValue();
      saved=await savePolicy(saved,id,expected);await edit("policies",id);assert.equal(await name(),expected.name);assert.equal(await at(field("enabled")).isChecked(),false);
      for(const [key,value] of Object.entries(expected.parameters).filter(([key])=>key!=="replace_battery_check"))assert.equal(Number.isFinite(value)?Number(await at(field(`parameters:${key}`)).inputValue()):await at(field(`parameters:${key}`)).inputValue(),value);
      if(type==="ups_reserve")for(const [values,message] of [[{charge_low:101,charge_clear:102},/valid nonnegative UPS threshold/],[{charge_clear:20},/recovery threshold must exceed/],[{charge_clear:""},/both raise and clear/],[{runtime_low_minutes:525601,runtime_clear_minutes:525602},/valid nonnegative UPS threshold/]]){
        for(const [key,value] of Object.entries(values))await fill(field(`parameters:${key}`),value);const requests=transport.saveRequests;await click(action("save-scoped"));await at('.config-error').filter({hasText:message}).waitFor();assert.equal(transport.saveRequests,requests+1);await noChange(saved);for(const [key,value] of Object.entries(values))assert.equal(await at(field(`parameters:${key}`)).inputValue(),String(value));await discard();
      }
      await menu("policies",id,"delete");await deleteConfirm();saved=await expectPolicy(saved,id,null);
    }
    return "All 13 policy types created/reopened/deleted with exact check, scope, parameters and notifications; every detection numeric field boundary blocked before submission; absolute and difference temperature units converted.";
  });

  await test("policies.temperature-detection",async()=>{
    let saved=await snapshot();const id="lab_temperature";await edit("policies",id);
    for(const limits of [{minimum:41},{maximum:90},{minimum:50,maximum:85}]){
      await fill(field("parameters:minimum"),limits.minimum??"");await fill(field("parameters:maximum"),limits.maximum??"");await choose(field("duration-unit:duration_seconds"),"hours");await fill(field("parameters:duration_seconds"),"1.25");
      const expected={...policy(saved,id),parameters:{unit:"°F",minimum:null,maximum:null,...limits,duration_seconds:4500}};saved=await savePolicy(saved,id,expected);await edit("policies",id);await choose(field("duration-unit:duration_seconds"),"minutes");assert.equal(Number(await at(field("parameters:duration_seconds")).inputValue()),75);assert.equal(await at(action("save-scoped")).count(),0);await noChange(saved);
    }
    await fill(field("parameters:minimum"),"");await invalid(saved,field("parameters:maximum"),"");assert.match(await bodyText(),/at least one limit/);
    await fill(field("parameters:maximum"),"45");await invalid(saved,field("parameters:minimum"),"60");assert.match(await bodyText(),/less than or equal/);
    await fill(field("parameters:minimum"),"40");await choose(field("duration-unit:duration_seconds"),"seconds");
    for(const value of ["-1","0.5","31536001"])await invalid(saved,field("parameters:duration_seconds"),value);
    await fill(field("parameters:duration_seconds"),"1");await check(field("enabled"),false);saved=await savePolicy(saved,id,{...policy(saved,id),enabled:false,parameters:{unit:"°F",minimum:40,maximum:45,duration_seconds:1}});
    await check(field("enabled"),true);saved=await savePolicy(saved,id,{...policy(saved,id),enabled:true});assert.equal(saved.notifications,false);assert.equal(await at('[data-notifications-switch]').isChecked(),false);
    return "Lower-only, upper-only and paired limits persist; 1.25 hours equals exactly 4500 seconds; display-only unit change stays clean; absent/reversed bounds and invalid durations blocked; monitoring toggle leaves sending off.";
  });

  await test("policies.temperature-save",async()=>{
    await companion();let saved=await snapshot();const id="lab_temperature";await edit("policies",id);await fill(field("parameters:minimum"),"44");await fill(field("parameters:maximum"),"99");await choose(field("duration-unit:duration_seconds"),"seconds");await fill(field("parameters:duration_seconds"),"77");
    saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{unit:"°F",minimum:44,maximum:99,duration_seconds:77}});await edit("policies",id);assert.equal(await at(field("parameters:minimum")).inputValue(),"44");assert.equal(await at(field("parameters:duration_seconds")).inputValue(),"77");
    await fill(field("parameters:minimum"),"45");await fill(field("parameters:maximum"),"100");transport.mode="reject";let requests=transport.saveRequests;await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,requests+1);assert.equal(await at(field("parameters:minimum")).inputValue(),"45");assert.equal(await at(field("parameters:maximum")).inputValue(),"100");await noChange(saved);
    await discard();assert.equal(await at(field("parameters:minimum")).inputValue(),"44");assert.equal(await at(field("parameters:maximum")).inputValue(),"99");await noChange(saved);await checkCompanion();
    await edit("policies",id);await fill(field("parameters:minimum"),"46");transport.mode="reject";await click(action("save-scoped"));await waitError();await noChange(saved);saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{...policy(saved,id).parameters,minimum:46}});
    await checkCompanion();await clean();await edit("policies",id);assert.equal(await at(field("parameters:minimum")).inputValue(),"46");await noChange(saved);
    return "Exact temperature fields reopen after save and full reload; rejected save retains all edited values, discard restores saved values, explicit retry submits once; independent notification draft was preserved unsaved through save/failure/discard.";
  });

  await test("policies.temperature-picker",async()=>{
    const before=await snapshot(),id="lab_temperature";await edit("policies",id);await click(action("pick"));await waitCatalog();await fill('[data-definition-picker-search]',"Lab temperature reading");
    const choices=at(field("selection"));assert.ok(await choices.count()>=40);const target=choices.nth(35),value=await target.getAttribute("data-definition-value");await target.scrollIntoViewIfNeeded();
    const scroll=await at('.policy-picker-options').evaluate(el=>({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight}));assert.ok(scroll.total>scroll.height);assert.ok(scroll.top>0);await target.check();
    assert.equal(await at('[data-definition-picker-search]').inputValue(),"Lab temperature reading");await focus(selection(value));assert.ok(Math.abs((await at('.policy-picker-options').evaluate(el=>el.scrollTop))-scroll.top)<2,"Selection retains list position");
    const context=await at('.policy-picker-choice').filter({has:page.locator(selection(value))}).innerText();assert.match(context,/Office|Upstairs/);
    for(const selector of ['.policy-picker','[data-definition-picker-search]',action("finish-pick"),'.policy-picker-choice']){
      const boxes=await at(selector).evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,overflow:el.scrollWidth>el.clientWidth+1};}));for(const box of boxes){assert.ok(box.left>=-1&&box.right<=page.viewportSize().width+1,`${selector} fits viewport`);assert.ok(!box.overflow,`${selector} needs no horizontal scroll`);}
    }
    await click(action("finish-pick"));await focus(action("pick"));await savePolicy(before,id,{...policy(before,id),match:{entity:[...policy(before,id).match.entity,value]}});
    return `Real scrollable temperature list retains checkbox focus, search and position; area context and all picker controls fit ${page.viewportSize().width}×${page.viewportSize().height}. Theme/layout matrix is recorded by the runner.`;
  });

  await test("policies.restore",async()=>{
    const initial=await setup(settings=>{settings.monitoring_policies=settings.monitoring_policies.filter(p=>!["default_batteries","default_vacuums"].includes(p.id));delete settings.notification_definitions.profiles.morning;for(const p of settings.monitoring_policies)p.notifications=p.notifications.filter(row=>row.profile!=="morning");});
    await listing("policies");await click(action("restore"));assert.equal(await at('[data-definition-restore]').count(),2);await check('[data-definition-restore="default_batteries"]',true);await click(action("cancel-restore"));await noChange(initial);assert.equal(await at(`${action("edit")}[data-definition-id="default_batteries"]`).count(),0);
    await click(action("restore"));await check('[data-definition-restore="default_batteries"]',true);await click(action("confirm-restore"));await noChange(initial);assert.equal(await at(`${action("edit")}[data-definition-id="default_batteries"]`).count(),1);assert.equal(await at(`${action("edit")}[data-definition-id="default_vacuums"]`).count(),0);
    await edit("policies","default_batteries");const draftRows=await rows();assert.ok(draftRows.every(row=>row.profile!=="morning"));await save();const saved=await snapshot(),restored=policy(saved,"default_batteries");assert.ok(restored);assert.deepEqual(restored.notifications,draftRows);await expectPolicy(initial,restored.id,restored);assert.ok(!saved.notification_definitions.profiles.morning);
    return "From two missing defaults and a missing referenced notification: cancel writes nothing; confirm stages only selected default; one scoped save restores it without dangling profile or resurrecting the other default/profile.";
  });

  await test("policies.notification",async()=>{
    await companion();let saved=await snapshot();const id="lab_temperature";await edit("policies",id);assert.equal(await at('.policy-notification-add select').inputValue(),"");const oldRows=policy(saved,id).notifications;
    await choose('.policy-notification-add select',"urgent");const added=(await rows()).at(-1);assert.equal(await at('.policy-notification-add select').inputValue(),"");await focus(`[data-row-field="profile"][data-row-id="${added.id}"]`);await choose(`[data-row-field="profile"][data-row-id="${added.id}"]`,"weekly");
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[...oldRows,{id:added.id,profile:"weekly"}]});await edit("policies",id);assert.deepEqual(await rows(),policy(saved,id).notifications);
    await removeRows();await focus('.policy-notification-add select');assert.match(await bodyText(),/No notifications/);transport.mode="reject";let requests=transport.saveRequests;await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,requests+1);assert.deepEqual(await rows(),[]);await noChange(saved);
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[]});await edit("policies",id);assert.deepEqual(await rows(),[]);assert.match(await bodyText(),/No notifications/);await checkCompanion();await noChange(saved);
    return "Explicit add and replacement retain stable row identity and keyboard focus; removing last row, rejected save, one retry and reopen preserve empty notification assignment and all unrelated saved/draft settings.";
  });

  await test("policies.legacy",async()=>{
    const legacy={id:"legacy-lab-row",timing:{mode:"immediate"},methods:["lab_messages"]};let saved=await setup(settings=>{policy(settings,"lab_temperature").notifications=[legacy];});const id="lab_temperature";
    await edit("policies",id);assert.match(await at('.policy-notification-row').innerText(),/Custom notification/);assert.equal(await at('.policy-notification-row [data-row-field="profile"]').inputValue(),"");await fill(field("name"),"Legacy preserved on rename");saved=await savePolicy(saved,id,{...policy(saved,id),name:"Legacy preserved on rename"});assert.deepEqual(policy(saved,id).notifications,[legacy]);
    await edit("policies",id);await choose('.policy-notification-row [data-row-field="profile"]',"urgent");saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[{id:legacy.id,profile:"urgent"}]});await edit("policies",id);assert.deepEqual(await rows(),[{id:legacy.id,profile:"urgent"}]);
    return "Legacy inline timing/method row remains byte-for-byte equivalent through rename; only explicit named replacement removes inline fields and preserves assignment ID.";
  });

  await test("policies.ups",async()=>{
    let saved=await snapshot();const id="lab_ups_reserve";await edit("policies",id);await removeRows();await choose('.policy-notification-add select',"morning");await choose('.policy-notification-add select',"urgent");const values=await rows();assert.equal(values.length,2);
    assert.equal(await at(`[data-row-id="${values[0].id}"][data-row-field="when"]`).inputValue(),"mains");assert.equal(await at(`[data-row-id="${values[1].id}"][data-row-field="when"]`).inputValue(),"backup");
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:values.map((row,i)=>({...row,when:i?"backup":"mains"}))});await edit("policies",id);
    await choose(`[data-row-id="${values[0].id}"][data-row-field="when"]`,"backup");await choose(`[data-row-id="${values[1].id}"][data-row-field="when"]`,"mains");await choose(`[data-row-id="${values[0].id}"][data-row-field="profile"]`,"evening");
    const expected=[{id:values[0].id,profile:"evening",when:"backup"},{id:values[1].id,profile:"urgent",when:"mains"}];saved=await savePolicy(saved,id,{...policy(saved,id),notifications:expected});await edit("policies",id);assert.deepEqual(await rows(),expected.map(({when,...row})=>row));for(const row of expected)assert.equal(await at(`[data-row-id="${row.id}"][data-row-field="when"]`).inputValue(),row.when);
    return "Two reserve conditions get independent mains/backup defaults; swapping both conditions and changing one notification preserves IDs, other condition and complete saved configuration.";
  });

  await test("settings.edit",async()=>{
    const before=await snapshot();await companion();await edit("policies","lab_temperature");await fill(field("name"),"Unrelated policy draft");await edit("methods","lab_messages");await fill(field("name"),"Unrelated method draft");await go("configuration");
    await click('details[data-ui-key="settings-advanced-timing"] summary');const expected=structuredClone(before);
    const changeVisible=async()=>{for(const key of await at('[data-setting-path^="timings."]').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.dataset.settingPath))){const selector=`[data-setting-path="${key}"]`,scale=Number(await at(selector).getAttribute("data-setting-scale")||1),value=Number(await at(selector).inputValue())+1;await fill(selector,value);expected.timings[key.slice(8)]=value*scale;}};
    await changeVisible();await click('[data-settings-section="grouping"]');await changeVisible();let requests=transport.saveRequests;await save();assert.equal(transport.saveRequests,requests+1);await noChange(expected);
    const count='[data-setting-path="timings.coalesce_count"]',window='[data-setting-path="timings.coalesce_window"]';await fill(window,Number(await at(window).inputValue())+1);await invalid(expected,count,"1");await discard();assert.equal(Number(await at(count).inputValue()),expected.timings.coalesce_count);await noChange(expected);
    await click('[data-settings-section="timing"]');const timing='[data-setting-path="timings.clear_hold"]';await fill(timing,Number(await at(timing).inputValue())+1);await invalid(expected,timing,"-1");await discard();assert.equal(Number(await at(timing).inputValue())*Number(await at(timing).getAttribute("data-setting-scale")),expected.timings.clear_hold);await noChange(expected);
    await checkCompanion();await edit("policies","lab_temperature");assert.equal(await name(),"Unrelated policy draft");await edit("methods","lab_messages");assert.equal(await name(),"Unrelated method draft");
    return "Every rendered installation timing and grouping field saved in one request with exact scale; invalid group count blocks request and retains input; discard restores saved fields; policy, method and notification drafts remain unsaved.";
  });

  await test("sending.switch",async()=>{
    const before=await snapshot();assert.equal(before.notifications,false);await companion();await edit("policies","lab_temperature");await fill(field("name"),"Policy draft while sending changes");
    for(const enabled of [true,false]){
      const requested=observeRequest("homeostatic/save_settings");transport.mode="hold";const requests=transport.saveRequests;await click('[data-notifications-switch]');await requested();assert.equal(await at('[data-notifications-switch]').isChecked(),!enabled);assert.equal(await at('[data-notifications-switch]').isDisabled(),true);await noChange({...before,notifications:!enabled});
      transport.release();await at(`[data-notifications-switch]${enabled?":checked":":not(:checked)"}:not(:disabled)`).waitFor({timeout:45000});assert.equal(transport.saveRequests,requests+1);await noChange({...before,notifications:enabled});await at(field("name")).waitFor();assert.equal(await name(),"Policy draft while sending changes");
    }
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:lab.entities.bulk_0,state:"unavailable"});await go("problems");for(const button of await at('[data-issue-group]').all())if(await button.getAttribute("aria-expanded")==="false")await button.click();await at('[data-episode]').filter({hasText:"Lab standalone reading 00"}).waitFor({timeout:30000});await noChange(before);
    await edit("policies","lab_temperature");assert.equal(await name(),"Policy draft while sending changes");await checkCompanion();
    return "Held On/Off transactions keep confirmed switch state and prevent resubmission; only global setting persists; a newly failed real sensor becomes an issue while sending is off; unrelated drafts survive.";
  });
}
