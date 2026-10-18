/** Complete notification contracts through rendered controls and real HA storage.
 * Public API writes below prepare isolated fixtures; all acceptance actions use
 * browser pointer/keyboard controls. Transport faults affect this browser only.
 */
import assert from "node:assert/strict";

export async function runNotificationGaps(ctx) {
  const {page,lab,call,run,at,bodyText,action,field,snapshot,click,fill,choose,check,clean,go,listing,edit,menu,save,discard,deleteConfirm,add,noChange,transport}=ctx;
  const status=()=>call("homeostatic_ui_lab/control",{action:"status"});
  const name=()=>at(field("name")).inputValue();
  const identity=()=>at(field("name")).getAttribute("data-definition-id");
  const optionIds=selector=>at(`${selector} option`).evaluateAll(items=>items.map(item=>item.value).filter(Boolean));
  const selectedChannels=()=>at(action("destination-remove")).evaluateAll(items=>items.map(item=>item.dataset.destinationChannel));
  const reset=async()=>{
    transport.mode=null;transport.holdMode=null;transport.refreshFailure=false;
    transport.interceptRequest=null;transport.transformResponse=null;
    await page.goto("about:blank");Object.assign(lab,await call("homeostatic_ui_lab/control",{action:"reset"}));await clean();
  };
  const fresh=(id,body)=>run(id,async()=>{await reset();return body();});
  const fixture=async mutate=>{
    const configuration=await call("homeostatic/configuration"),settings=structuredClone(configuration.settings);
    mutate(settings);await call("homeostatic/save_settings",{revision:configuration.revision,settings});await clean();return snapshot();
  };
  const scopeOnly=(before,after,kind,id)=>{
    const expected=structuredClone(before);
    expected.notification_definitions[kind][id]=structuredClone(after.notification_definitions[kind][id]);
    assert.deepEqual(after,expected);
  };
  const focusEdit=async(kind,id)=>{
    const target=at(`${action("edit")}[data-definition-kind="${kind}"][data-definition-id="${id}"]`);
    await target.waitFor();assert.equal(await target.evaluate(el=>el.getRootNode().activeElement===el),true,"Saved Edit control receives focus");
    assert.equal(await at(action("save-scoped")).count(),0);
    assert.doesNotMatch(await bodyText(),/Changes saved\./);
  };
  const picker=async(type,destinationField="destinations")=>{
    await click(`${action("destination-open")}[data-destination-field="${destinationField}"]`);
    await choose('[data-definition-delivery-type]',type);
  };
  const chooseChannel=async(type,channel,destinationField="destinations")=>{
    await picker(type,destinationField);
    const target=at(`${action("destination-add")}[data-destination-channel="${channel}"]`);
    if(!await target.count())await click(`${action("destination-speaker")}[data-destination-speaker="${lab.registry_ids.speaker}"]`);
    await target.click();
  };
  const unchangedCapture=async count=>assert.equal((await status()).capture_count,count,"Editing and saving never sends a test");
  const testStatus=async pattern=>{
    await click(action("test-method"));
    await at('.method-test [role="status"],.method-test [role="alert"]').filter({hasText:pattern}).waitFor({timeout:20000});
    await at(`${action("test-method")}:not(:disabled)`).waitFor();
  };
  const profileDraft=async(id,value)=>{await edit("profiles",id);await fill(field("name"),value);};
  const policyDraft=async(id,value)=>{await edit("policies",id);await fill(field("name"),value);};
  const error=async pattern=>at('.config-error').filter({hasText:pattern}).waitFor({timeout:20000});

  await fresh("profiles.list",async()=>{
    const before=await snapshot(),ids=Object.keys(before.notification_definitions.profiles);assert.equal(ids.length,6);
    await listing("methods");await listing("profiles");
    assert.equal(await at(`${action("edit")}[data-definition-kind="profiles"]`).count(),6);
    for(const id of ids){
      await edit("profiles",id);assert.equal(await name(),before.notification_definitions.profiles[id].name);
      await listing("profiles");await click(`[popovertarget="notification-actions-${id}"]`);
      const popup=at(`#notification-actions-${id}`);await popup.waitFor({state:"visible"});
      assert.equal(await popup.locator(action("duplicate")).isVisible(),true);
      assert.equal(await popup.locator(action("delete")).isVisible(),true);
      const bounds=await popup.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=page.viewportSize().width+1,"Menu fits viewport");
      await page.keyboard.press("Escape");
      await menu("profiles",id,"delete");await click(action("cancel-delete"));
    }
    await noChange(before);return "All six default Edit, Duplicate and Delete menus reached by pointer; compact menus fit the viewport, both tabs and cancel preserve all settings.";
  });

  await fresh("profiles.ordering",async()=>{
    const before=await fixture(settings=>{
      const profiles=settings.notification_definitions.profiles;
      profiles.order_daily_early={name:"Earlier daily",timing:{mode:"report",at:"07:00",weekdays:[0,1,2,3,4,5,6]},methods:[]};
      profiles.order_two_a={name:"Same report",timing:{mode:"report",at:"08:00",weekdays:[0,1]},methods:[]};
      profiles.order_two_b={name:"Same report",timing:{mode:"report",at:"08:00",weekdays:[0,1]},methods:[]};
    });
    const expected=["acknowledge","immediate","urgent","order_daily_early","morning","evening","order_two_a","order_two_b","weekly"];
    const listOrder=()=>at(`${action("edit")}[data-definition-kind="profiles"]`).evaluateAll(items=>items.map(item=>item.dataset.definitionId));
    await listing("profiles");assert.deepEqual(await listOrder(),expected);
    await profileDraft("weekly","AAA pending does not reorder");await choose(field("timing:mode"),"immediate");
    await listing("profiles");assert.deepEqual(await listOrder(),expected);
    await edit("policies",before.monitoring_policies[0].id);assert.deepEqual(await optionIds('.policy-notification-add select'),expected);
    const selector=at('[data-row-field="profile"]').first();
    if(await selector.count())assert.deepEqual(await selector.locator('option').evaluateAll(items=>items.map(item=>item.value).filter(Boolean)),expected);
    await menu("profiles","morning","delete");
    const replacements=(await optionIds('[data-definition-delete-resolution]')).filter(value=>value!=="remove-rows");
    assert.deepEqual(replacements,expected.filter(id=>id!=="morning"));await click(action("cancel-delete"));
    await noChange(before);await edit("profiles","weekly");assert.equal(await name(),"AAA pending does not reorder");
    return "Saved timing, frequency, local time, name and stable-ID ties agree across list, policy selectors and deletion replacement despite a pending timing/name edit.";
  });

  await fresh("profiles.create",async()=>{
    const before=await snapshot();const id=await add("profiles","Abandoned notification");
    assert.ok(!before.notification_definitions.profiles[id]);await noChange(before);
    await listing("profiles");assert.equal(await at(`.definition-list ${action("edit")}[data-definition-id="${id}"]`).count(),0);
    await edit("policies",before.monitoring_policies[0].id);assert.ok(!(await optionIds('.policy-notification-add select')).includes(id));
    await listing("profiles");await click(`${action("edit")}[data-definition-id="${id}"]`);await discard();
    await noChange(before);assert.equal(Object.keys((await snapshot()).notification_definitions.profiles).length,6);
    return "Unsaved notification is absent from saved list and selectors; discard creates no blank backend object.";
  });

  await fresh("profiles.invalid",async()=>{
    const before=await snapshot();await edit("profiles","morning");await fill(field("timing:at"),"09:17");await fill(field("name"),"");
    const count=transport.saveRequests;await click(action("save-scoped"));
    assert.equal(transport.saveRequests,count);assert.equal(await at(field("name")).evaluate(el=>el.validity.valueMissing),true);
    assert.equal(await at(field("name")).evaluate(el=>el.getRootNode().activeElement===el),true);
    assert.equal(await name(),"");assert.equal(await at(field("timing:at")).inputValue(),"09:17");await noChange(before);
    return "Required-name validation focuses the input, retains the other draft fields and emits zero save requests.";
  });

  await fresh("profiles.collection-delay",async()=>{
    const before=await snapshot(),captures=(await status()).capture_count,delay=field("timing:collection_delay_seconds");
    for(const [id,value] of [["immediate",60],["acknowledge",5],["urgent",60]]) {
      await edit("profiles",id);assert.equal(await at(delay).inputValue(),String(value));
      assert.equal(await at(delay).getAttribute("min"),"0");assert.equal(await at(delay).getAttribute("step"),"1");
    }
    await edit("profiles","immediate");
    assert.match(await bodyText(),/Wait this long to combine requests using this notification\. Later requests don’t extend the wait\. 0 sends without waiting\./);
    for(const invalid of ["","-1","1.5"]) {
      await fill(delay,invalid);const count=transport.saveRequests;await click(action("save-scoped"));
      assert.equal(transport.saveRequests,count);assert.equal(await at(delay).evaluate(el=>el.checkValidity()),false);
      assert.equal(await at(delay).evaluate(el=>el.getRootNode().activeElement===el),true);
    }
    await at(delay).fill("");await at(delay).pressSequentially("later");await at(delay).press("Tab");
    const count=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,count);assert.equal(await at(delay).evaluate(el=>el.checkValidity()),false);
    await noChange(before);
    await at(delay).focus();await page.keyboard.press("ControlOrMeta+A");await page.keyboard.type("23");await page.keyboard.press("Tab");
    await save();await focusEdit("profiles","immediate");
    const after=await snapshot();scopeOnly(before,after,"profiles","immediate");assert.equal(after.notification_definitions.profiles.immediate.timing.collection_delay_seconds,23);
    await edit("profiles","immediate");assert.equal(await at(delay).inputValue(),"23");
    const bounds=await at(delay).boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=page.viewportSize().width+1,"The seconds field fits the viewport");
    await fill(delay,"31");transport.mode="reject";await click(action("save-scoped"));await error(/Synthetic save failure|failed|reject/i);
    assert.equal(await at(delay).inputValue(),"31");assert.equal((await snapshot()).notification_definitions.profiles.immediate.timing.collection_delay_seconds,23);
    transport.mode=null;await discard();assert.equal(await at(delay).inputValue(),"23");
    await choose(field("timing:mode"),"report");assert.equal(await at(delay).count(),0);await save();
    assert.equal("collection_delay_seconds" in (await snapshot()).notification_definitions.profiles.immediate.timing,false);
    await edit("profiles","immediate");assert.equal(await at(delay).count(),0);await choose(field("timing:mode"),"acknowledge");assert.equal(await at(delay).inputValue(),"0");await discard();
    const custom=await add("profiles","Custom collection");assert.equal(await at(delay).inputValue(),"0");await fill(delay,"7");await save();await edit("profiles",custom);assert.equal(await at(delay).inputValue(),"7");
    await page.screenshot({path:`${ctx.artifactDir}/notifications-collection-editor.png`,fullPage:false});
    await fill(delay,"0");await save();assert.equal((await snapshot()).notification_definitions.profiles[custom].timing.collection_delay_seconds,0);
    await unchangedCapture(captures);
    return "Notifications owns this single inline seconds field: supplied/custom defaults, invalid/keyboard entry, exact scoped save/reopen, rejected save/discard, zero and report-mode removal passed; field fits viewport and no notification was requested.";
  });

  await fresh("profiles.save",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies[0];await policyDraft(policy.id,"Companion policy draft");
    await edit("methods","lab_messages");await fill(field("name"),"Companion method draft");
    await edit("profiles","morning");await fill(field("timing:at"),"09:17");await check(`${field("methods")}[data-definition-value="lab_messages"]`,true);
    const count=transport.saveRequests;await save();assert.equal(transport.saveRequests,count+1);await focusEdit("profiles","morning");
    const after=await snapshot();scopeOnly(before,after,"profiles","morning");
    assert.equal(after.notification_definitions.profiles.morning.timing.at,"09:17");assert.deepEqual(after.notification_definitions.profiles.morning.methods,["lab_messages"]);
    await edit("profiles","morning");assert.equal(await at(field("timing:at")).inputValue(),"09:17");assert.equal(await at(`${field("methods")}[data-definition-value="lab_messages"]`).isChecked(),true);
    await edit("policies",policy.id);assert.equal(await name(),"Companion policy draft");await edit("methods","lab_messages");assert.equal(await name(),"Companion method draft");
    return "Exactly one save changes only the named profile, restores list focus, reopens timing/methods, and preserves both unrelated editor drafts.";
  });

  await fresh("profiles.discard",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies[0];await policyDraft(policy.id,"Policy retained on discard");
    await edit("methods","lab_messages");await fill(field("name"),"Method retained on discard");
    await profileDraft("morning","Discard this notification");await fill(field("timing:at"),"11:13");await discard();
    assert.equal(await identity(),"morning");assert.equal(await name(),before.notification_definitions.profiles.morning.name);
    assert.equal(await at(field("timing:at")).inputValue(),before.notification_definitions.profiles.morning.timing.at);
    await edit("policies",policy.id);assert.equal(await name(),"Policy retained on discard");await edit("methods","lab_messages");assert.equal(await name(),"Method retained on discard");await noChange(before);
  });

  await fresh("profiles.duplicate",async()=>{
    await edit("profiles","morning");await check(`${field("methods")}[data-definition-value="lab_messages"]`,true);await save();
    const before=await snapshot(),original=before.notification_definitions.profiles.morning;await menu("profiles","morning","duplicate");
    const id=await identity();assert.notEqual(id,"morning");await fill(field("name"),"Independent morning copy");await save();await focusEdit("profiles",id);
    const after=await snapshot(),expected=structuredClone(before);expected.notification_definitions.profiles[id]={...original,name:"Independent morning copy"};assert.deepEqual(after,expected);
    await edit("profiles",id);assert.equal(await at(field("timing:at")).inputValue(),original.timing.at);assert.equal(await at(`${field("methods")}[data-definition-value="lab_messages"]`).isChecked(),true);
    await fill(field("timing:at"),"12:34");await save();assert.deepEqual((await snapshot()).notification_definitions.profiles.morning,original);
    return "Duplicate persists independent identity with preserved timing/methods, returns to list and subsequent copy edits leave original unchanged.";
  });

  await fresh("profiles.delete-cancel",async()=>{
    const before=await snapshot(),count=transport.saveRequests;await menu("profiles","morning","delete");await choose('[data-definition-delete-resolution]',"urgent");
    await click(action("cancel-delete"));assert.equal(transport.saveRequests,count);await noChange(before);
  });

  for(const resolution of ["urgent","remove-rows"])await fresh(resolution==="urgent"?"profiles.delete-replace":"profiles.delete-remove",async()=>{
    const before=await fixture(settings=>{
      settings.notification_definitions.profiles.gap_delete={name:"Delete shared notification",timing:{mode:"immediate",collection_delay_seconds:0},methods:[]};
      settings.monitoring_policies.find(p=>p.id==="lab_ups_reserve").notifications=[{id:"gap_mains",profile:"gap_delete",when:"mains"},{id:"gap_backup",profile:"gap_delete",when:"backup"}];
      settings.monitoring_policies.find(p=>p.id==="default_batteries").notifications=[{id:"gap_only",profile:"gap_delete"}];
      settings.monitoring_policies.find(p=>p.id==="default_entities").notifications.push({id:"gap_extra",profile:"gap_delete"});
    });
    await menu("profiles","gap_delete","delete");assert.equal(await at(action("confirm-delete")).isDisabled(),true);await choose('[data-definition-delete-resolution]',resolution);
    const count=transport.saveRequests;await deleteConfirm();assert.equal(transport.saveRequests,count+1);
    const expected=structuredClone(before);delete expected.notification_definitions.profiles.gap_delete;
    for(const policy of expected.monitoring_policies)policy.notifications=policy.notifications.flatMap(row=>row.profile!=="gap_delete"?[row]:resolution==="remove-rows"?[]:[{...row,profile:resolution}]);
    assert.deepEqual(await snapshot(),expected);
    if(resolution==="remove-rows"){
      await edit("policies","default_batteries");assert.match(await bodyText(),/No notifications/);assert.equal(await at(action("remove-row")).count(),0);
    }
    return "Single atomic save covers several uses, stable row IDs and UPS mains/backup conditions; exact full-settings comparison preserves every unrelated field.";
  });

  await fresh("profiles.delete-draft",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies.find(p=>p.notifications.some(row=>row.profile==="morning"));
    await policyDraft(policy.id,"Using policy remains dirty");await menu("profiles","morning","delete");await choose('[data-definition-delete-resolution]',"urgent");
    const count=transport.saveRequests;await click(action("confirm-delete"));await error(/Save or discard/);assert.equal(transport.saveRequests,count);await noChange(before);
    await click(action("cancel-delete"));await edit("policies",policy.id);assert.equal(await name(),"Using policy remains dirty");
  });

  await fresh("profiles.timing",async()=>{
    const initial=await snapshot(),timezone=initial.notification_definitions.timezone;
    for(const mode of ["immediate","acknowledge","window","report"]){
      await edit("profiles","weekly");await choose(field("timing:mode"),mode);const before=await snapshot();
      let timing={mode};
      if(mode==="acknowledge"){
        await fill(field("timing:minutes"),"0");const count=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,count);
        assert.equal(await at(field("timing:minutes")).evaluate(el=>el.validity.valid),false);await noChange(before);await fill(field("timing:minutes"),"45");timing.remind_every=2700;
      }
      if(mode==="window"){
        assert.ok((await bodyText()).includes(timezone));await fill(field("timing:start"),"");const count=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,count);await noChange(before);
        await fill(field("timing:start"),"07:15");await fill(field("timing:end"),"07:15");await click(action("save-scoped"));await error(/distinct|different|window|invalid/i);await noChange(before);
        await fill(field("timing:end"),"21:30");timing={mode,start:"07:15",end:"21:30"};
      }
      if(mode==="report"){
        assert.ok((await bodyText()).includes(timezone));await fill(field("timing:at"),"");const count=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,count);await noChange(before);
        await fill(field("timing:at"),"10:17");for(let day=0;day<7;day++)await check(`${field("timing:weekdays")}[data-definition-value="${day}"]`,false);
        await click(action("save-scoped"));await error(/weekday|days|invalid/i);await noChange(before);
        for(const day of [1,6])await check(`${field("timing:weekdays")}[data-definition-value="${day}"]`,true);timing={mode,at:"10:17",weekdays:[1,6]};
      }
      await save();const after=await snapshot();scopeOnly(before,after,"profiles","weekly");assert.deepEqual(after.notification_definitions.profiles.weekly.timing,timing);assert.equal(after.notification_definitions.timezone,timezone);
      await edit("profiles","weekly");assert.equal(await at(field("timing:mode")).inputValue(),mode);
      if(mode==="immediate")assert.equal(await at(`${field("timing:start")},${field("timing:minutes")},${field("timing:at")}`).count(),0);
      if(mode==="acknowledge")assert.equal(await at(field("timing:minutes")).inputValue(),"45");
      if(mode==="window"){assert.equal(await at(field("timing:start")).inputValue(),"07:15");assert.equal(await at(field("timing:end")).inputValue(),"21:30");}
      if(mode==="report"){assert.equal(await at(field("timing:at")).inputValue(),"10:17");for(let day=0;day<7;day++)assert.equal(await at(`${field("timing:weekdays")}[data-definition-value="${day}"]`).isChecked(),[1,6].includes(day));}
    }
    return "All four modes saved/reopened exact fields; invalid reminder, empty clock, equal window bounds and zero weekdays rejected; displayed and saved timezone retained.";
  });

  await fresh("methods.lifecycle",async()=>{
    const initial=await snapshot(),capture=(await status()).capture_count;await add("methods","Abandoned delivery");assert.equal(await at(action("test-method")).count(),0);await discard();await noChange(initial);
    const before=await fixture(settings=>{
      settings.notification_definitions.profiles.morning.methods=["lab_messages"];
      settings.monitoring_policies.find(p=>p.id==="default_entities").notifications.push({id:"gap_inline",timing:{mode:"immediate"},methods:["lab_messages"]});
    });
    const policy=before.monitoring_policies.find(p=>p.id==="default_batteries");await policyDraft(policy.id,"Policy draft across method save");await profileDraft("morning","Profile draft across method save");
    await edit("methods","lab_messages");await fill(field("name"),"Shared method renamed");await save();
    const renamed=await snapshot();scopeOnly(before,renamed,"methods","lab_messages");assert.equal(renamed.notification_definitions.methods.lab_messages.name,"Shared method renamed");
    await edit("policies",policy.id);assert.equal(await name(),"Policy draft across method save");await edit("profiles","morning");assert.equal(await name(),"Profile draft across method save");
    await menu("methods","lab_messages","delete");await choose('[data-definition-delete-resolution]',"lab_phone");const count=transport.saveRequests;await click(action("confirm-delete"));await error(/Save or discard notification drafts/);assert.equal(transport.saveRequests,count);await noChange(renamed);await click(action("cancel-delete"));
    await edit("profiles","morning");await discard();await edit("policies",policy.id);await discard();
    await menu("methods","lab_messages","duplicate");const copy=await identity();await fill(field("name"),"Independent delivery copy");await save();await focusEdit("methods",copy);
    assert.deepEqual((await snapshot()).notification_definitions.methods[copy],{...renamed.notification_definitions.methods.lab_messages,name:"Independent delivery copy"});
    await edit("methods",copy);await fill(field("name"),"Discard this method draft");await discard();assert.equal(await name(),"Independent delivery copy");
    const withCopy=await snapshot();await menu("methods",copy,"delete");await click(action("cancel-delete"));await noChange(withCopy);
    await menu("methods",copy,"delete");await deleteConfirm();await noChange(renamed);
    await menu("methods","lab_messages","delete");await choose('[data-definition-delete-resolution]',"lab_phone");const writes=transport.saveRequests;await deleteConfirm();assert.equal(transport.saveRequests,writes+1);
    const replaced=structuredClone(renamed);delete replaced.notification_definitions.methods.lab_messages;
    for(const profile of Object.values(replaced.notification_definitions.profiles))profile.methods=profile.methods.map(id=>id==="lab_messages"?"lab_phone":id);
    for(const p of replaced.monitoring_policies)for(const row of p.notifications)if(row.methods)row.methods=row.methods.map(id=>id==="lab_messages"?"lab_phone":id);
    assert.deepEqual(await snapshot(),replaced);
    await menu("methods","lab_phone","delete");await choose('[data-definition-delete-resolution]',"remove-rows");await deleteConfirm();
    const removed=structuredClone(replaced);delete removed.notification_definitions.methods.lab_phone;
    for(const profile of Object.values(removed.notification_definitions.profiles))profile.methods=profile.methods.filter(id=>id!=="lab_phone");
    for(const p of removed.monitoring_policies)p.notifications=p.notifications.filter(row=>!row.methods?.includes("lab_phone"));
    assert.deepEqual(await snapshot(),removed);assert.deepEqual(removed.notification_definitions.profiles.morning.methods,[]);await unchangedCapture(capture);
    return "Add/discard, shared rename with two independent drafts, blocked deletion, duplicate/reopen/discard, cancellation, replacement and explicit removal preserve profile uses and inline row identity; no delivery requests.";
  });

  await fresh("methods.completion",async()=>{
    const before=await snapshot(),capture=(await status()).capture_count;await profileDraft("morning","Unrelated notification draft");
    const id=await add("methods","Kitchen Echo"),channel=`tts:${lab.registry_ids.local_speech}:${lab.registry_ids.speaker}`;await chooseChannel("voice",channel);await save();await focusEdit("methods",id);
    const expected=structuredClone(before);expected.notification_definitions.methods[id]={name:"Kitchen Echo",mode:"fixed",destinations:[channel]};assert.deepEqual(await snapshot(),expected);
    await edit("methods",id);assert.equal(await name(),"Kitchen Echo");assert.deepEqual(await selectedChannels(),[channel]);await edit("profiles","morning");assert.equal(await name(),"Unrelated notification draft");await unchangedCapture(capture);
  });

  await fresh("methods.destinations",async()=>{
    const capture=(await status()).capture_count;
    await fixture(settings=>{settings.notification_definitions.methods.gap_missing={name:"Repair missing destination",mode:"fixed",destinations:["notify:missing-ui-target"]};});
    await edit("methods","gap_missing");await at(action("destination-open")).waitFor();assert.match(await bodyText(),/Saved destination unavailable/);await click(`${action("destination-remove")}[data-destination-channel="notify:missing-ui-target"]`);
    const expected=[];
    for(const type of ["app","voice","email","sms","notification"]){
      await picker(type);assert.equal(await at('[data-definition-delivery-type]').inputValue(),type);
      await fill('[data-definition-delivery-search]',"no-ui-destination-matches");assert.equal(await at(`${action("destination-add")},${action("destination-speaker")},${action("destination-add-sms")}`).count(),0);
      await fill('[data-definition-delivery-search]',"");
      if(type==="sms"){
        await fill('[data-definition-sms-number]',"invalid");await click(action("destination-add-sms"));assert.match(await bodyText(),/5–15 digits/);await fill('[data-definition-sms-number]',"+15551234567");
        const prefix=await at(action("destination-add-sms")).first().getAttribute("data-destination-channel");await click(action("destination-add-sms"));expected.push(prefix+encodeURIComponent("+15551234567"));
      }else{
        if(type==="voice")await click(`${action("destination-speaker")}[data-destination-speaker="${lab.registry_ids.speaker}"]`);
        const target=at(action("destination-add")).first();expected.push(await target.getAttribute("data-destination-channel"));await target.click();
      }
      assert.deepEqual(await selectedChannels(),expected);
    }
    await picker("notification");await click(action("destination-close"));assert.deepEqual(await selectedChannels(),expected);
    await click(`${action("destination-remove")}[data-destination-channel="${expected[0]}"]`);assert.deepEqual(await selectedChannels(),expected.slice(1));await chooseChannel("app",expected[0]);
    const reordered=[...expected.slice(1),expected[0]];await save();assert.deepEqual((await snapshot()).notification_definitions.methods.gap_missing.destinations,reordered);
    await edit("methods","gap_missing");assert.deepEqual(await selectedChannels(),reordered);assert.doesNotMatch(await bodyText(),/Saved destination unavailable/);await unchangedCapture(capture);
    return "Repaired a genuinely missing saved target; each of app/voice/email/SMS/generic types searched, selected, removed/re-added and persisted. Invalid SMS input and explicit picker close preserved the draft.";
  });

  await fresh("methods.picker-layout",async()=>{
    const before=await snapshot(),capture=(await status()).capture_count;await edit("methods","lab_messages");await at(action("destination-open")).waitFor();const original=await selectedChannels();await picker("voice");
    const body=at('.delivery-picker-body'),dialog=at('dialog.delivery-picker'),close=at(action("destination-close"));
    const geometry=await dialog.evaluate(el=>{const body=el.querySelector('.delivery-picker-body'),results=el.querySelector('.delivery-picker-results'),r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,bodyOverflow:getComputedStyle(body).overflowY,bodyScroll:body.scrollHeight,bodyHeight:body.clientHeight,resultsOverflow:getComputedStyle(results).overflowY};});
    const viewport=page.viewportSize();assert.ok(geometry.left>=0&&geometry.right<=viewport.width+1&&geometry.top>=0&&geometry.bottom<=viewport.height+1);assert.match(geometry.bodyOverflow,/auto|scroll/);assert.ok(geometry.bodyScroll>geometry.bodyHeight,"Catalog produces real scrolling");assert.doesNotMatch(geometry.resultsOverflow,/auto|scroll/);
    const rows=at('.delivery-picker-choice');assert.ok(await rows.count()>=18,"Many compact speakers remain individual choices");
    const rowMetrics=await rows.evaluateAll(items=>items.map(el=>({height:el.getBoundingClientRect().height,align:getComputedStyle(el).textAlign})));assert.ok(rowMetrics.every(row=>row.height<=100&&row.align==="left"),"Speaker rows are compact and left aligned");
    await page.screenshot({path:`${ctx.artifactDir}/notifications-picker.png`,fullPage:false});
    await rows.last().scrollIntoViewIfNeeded();assert.ok(await body.evaluate(el=>el.scrollTop>0));const closeBounds=await close.boundingBox();assert.ok(closeBounds&&closeBounds.y>=0&&closeBounds.y+closeBounds.height<=viewport.height);
    await fill('[data-definition-delivery-search]',"Lab kitchen speaker");await click(`${action("destination-speaker")}[data-destination-speaker="${lab.registry_ids.speaker}"]`);
    assert.equal(await at(action("destination-add")).count(),2);await click(action("destination-back"));assert.equal(await at('[data-definition-delivery-search]').inputValue(),"Lab kitchen speaker");
    await page.keyboard.press("Escape");assert.deepEqual(await selectedChannels(),original);assert.equal(await at(action("destination-open")).first().evaluate(el=>el.getRootNode().activeElement===el),true);
    await picker("voice");await click(action("destination-close"));assert.deepEqual(await selectedChannels(),original);assert.equal(await at(action("destination-open")).first().evaluate(el=>el.getRootNode().activeElement===el),true);
    const channel=`tts:${lab.registry_ids.alternate_speech}:${lab.registry_ids.speaker}`;await chooseChannel("voice",channel);assert.deepEqual(await selectedChannels(),[...original,channel]);await noChange(before);await unchangedCapture(capture);
    return `At ${viewport.width}×${viewport.height}: actual overflowing catalog, one scrolling body, compact rows, visible Close, two-provider Back with retained search, Escape/focus return and exact selected draft.`;
  });

  await fresh("methods.presence",async()=>{
    const start=(await status()).capture_count,before=await snapshot();await edit("methods","lab_messages");assert.equal(await at('.method-presence').getAttribute("open"),null);await click('.method-presence summary');assert.notEqual(await at('.method-presence').getAttribute("open"),null);await click('.method-presence summary');
    await edit("methods","lab_presence");const person=lab.entities.owner;assert.equal(await at(`${field("people")}[data-person="${person}"]`).isChecked(),true);
    await fill(field("name"),"Saved presence routing");await save();scopeOnly(before,await snapshot(),"methods","lab_presence");await unchangedCapture(start);
    for(const [state,target] of [["home",lab.entities.phone],["not_home",lab.entities.email],["unknown",lab.entities.messages]]){
      await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:person,state});await edit("methods","lab_presence");const count=(await status()).capture_count;await testStatus(/Test requested/);
      const after=await status();assert.equal(after.capture_count,count+1);assert.ok(JSON.stringify(after.requests.at(-1).data).includes(target),`Saved ${state} selects ${target}`);
    }
    await edit("methods","lab_presence");await check(field("skip"),true);await save();const skipped=await snapshot();assert.deepEqual(skipped.notification_definitions.methods.lab_presence.fallback,[]);const count=(await status()).capture_count;
    await edit("methods","lab_presence");await testStatus(/test was skipped/);assert.equal((await status()).capture_count,count);
    await choose(field("mode"),"home_people");await check(`${field("people")}[data-person="${person}"]`,true);await chooseChannel("app",`notify:${lab.registry_ids.phone}`,`person_destinations:${person}`);await check(field("skip"),true);await save();
    const saved=(await snapshot()).notification_definitions.methods.lab_presence;assert.deepEqual(saved.people,[person]);assert.deepEqual(saved.person_destinations[person],[`notify:${lab.registry_ids.phone}`]);
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:person,state:"not_home"});await edit("methods","lab_presence");await testStatus(/test was skipped/);assert.equal((await status()).capture_count,count);
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:person,state:"home"});await edit("methods","lab_presence");await testStatus(/Test requested/);assert.equal((await status()).capture_count,count+1);assert.ok(JSON.stringify((await status()).requests.at(-1).data).includes(lab.entities.phone));
    assert.equal((await snapshot()).notifications,false);return "Saved home/away/unknown presence chooses phone/email/fallback respectively; skip and per-person home routing resolve actual person states. Exactly four explicit mocked requests; edits and skipped tests send nothing.";
  });

  await fresh("methods.test",async()=>{
    const before=(await status()).capture_count;await add("methods","Unsaved cannot test");assert.equal(await at(action("test-method")).count(),0);await discard();
    await edit("methods","lab_messages");await fill(field("name"),"Dirty cannot test");assert.equal(await at(action("test-method")).count(),0);await unchangedCapture(before);await discard();
    await testStatus(/Test requested.*request, not receipt/);const requested=await status();assert.equal(requested.capture_count,before+1);assert.equal(requested.requests.at(-1).outcome,"requested");
    await edit("methods","lab_phone");assert.equal(await at('.method-test [role="status"]').count(),0);await edit("methods","lab_messages");await fill(field("name"),"Changed test signature");assert.equal(await at('.method-test [role="status"]').count(),0);await discard();
    await call("homeostatic_ui_lab/control",{action:"delivery_mode",mode:"fail"});await testStatus(/No test requests succeeded.*Failed requests/);const failed=await status();assert.equal(failed.capture_count,before+2);assert.equal(failed.requests.at(-1).outcome,"failed");await call("homeostatic_ui_lab/control",{action:"delivery_mode",mode:"capture"});
    await edit("methods","lab_presence");await check(field("skip"),true);await save();await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:lab.entities.owner,state:"unknown"});await edit("methods","lab_presence");await testStatus(/test was skipped/);assert.equal((await status()).capture_count,before+2);
    assert.equal((await snapshot()).notifications,false);return "New and dirty drafts cannot test; one clean requested test and one deliberate provider failure reach captured services. Skip is separate, and outcomes do not leak across methods or changed contents.";
  });

  await fresh("save.failure",async()=>{
    const before=await snapshot();await profileDraft("urgent","Exact rejected profile draft");await fill(field("timing:start"),"06:37");await check(`${field("methods")}[data-definition-value="lab_messages"]`,true);
    const count=transport.saveRequests;transport.mode="reject";await click(action("save-scoped"));await error(/Acceptance transport rejected/);assert.equal(transport.saveRequests,count+1);await noChange(before);
    assert.equal(await name(),"Exact rejected profile draft");assert.equal(await at(field("timing:start")).inputValue(),"06:37");assert.equal(await at(`${field("methods")}[data-definition-value="lab_messages"]`).isChecked(),true);
    await save();assert.equal(transport.saveRequests,count+2);const after=await snapshot();scopeOnly(before,after,"profiles","urgent");assert.deepEqual(after.notification_definitions.profiles.urgent,{name:"Exact rejected profile draft",timing:{mode:"window",start:"06:37",end:"22:00"},methods:["lab_messages"]});
  });

  await fresh("save.conflict",async()=>{
    await profileDraft("urgent","Conflicting local draft");await fill(field("timing:start"),"06:37");
    const configuration=await call("homeostatic/configuration"),settings=structuredClone(configuration.settings);settings.notification_definitions.profiles.urgent.name="Concurrent saved profile";await call("homeostatic/save_settings",{revision:configuration.revision,settings});
    await click(action("save-scoped"));await error(/changed|refresh|preserved/i);assert.deepEqual(await snapshot(),settings);assert.equal(await name(),"Conflicting local draft");assert.equal(await at(field("timing:start")).inputValue(),"06:37");
    const count=transport.saveRequests;await click(action("save-scoped"));await error(/changed|preserved/i);assert.equal(transport.saveRequests,count);assert.deepEqual(await snapshot(),settings);
    return "Concurrent backend edit survives both stale submit and deliberate retry; retry reads current settings and retains exact conflicting form without another write.";
  });

  await fresh("save.refresh-failure",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies[0];await policyDraft(policy.id,"Policy survives reread failure");await edit("methods","lab_phone");await fill(field("name"),"Method survives reread failure");
    await profileDraft("urgent","Saved but refresh failed");const count=transport.saveRequests;transport.mode="refresh-fail";await click(action("save-scoped"));await error(/were saved.*could not be reloaded/);
    assert.equal(transport.saveRequests,count+1);assert.equal(await name(),"Saved but refresh failed");const saved=await snapshot();scopeOnly(before,saved,"profiles","urgent");assert.equal(saved.notification_definitions.profiles.urgent.name,"Saved but refresh failed");
    await edit("policies",policy.id);assert.equal(await name(),"Policy survives reread failure");await edit("methods","lab_phone");assert.equal(await name(),"Method survives reread failure");
    return "Real save is persisted while browser reread is rejected; truthful saved/refresh-failed alert remains in editor and both companion drafts survive.";
  });

  await fresh("save.uncertain",async()=>{
    const before=await snapshot();await profileDraft("urgent","Applied response lost");await fill(field("timing:start"),"06:37");const count=transport.saveRequests;transport.mode="uncertain";await click(action("save-scoped"));await error(/Acceptance transport lost/);
    assert.equal(transport.saveRequests,count+1);const saved=await snapshot();scopeOnly(before,saved,"profiles","urgent");assert.equal(saved.notification_definitions.profiles.urgent.name,"Applied response lost");assert.equal(await name(),"Applied response lost");assert.equal(await at(field("timing:start")).inputValue(),"06:37");
    const reads=transport.configurationRequests;await save();assert.ok(transport.configurationRequests>reads,"Retry inspects backend first");assert.equal(transport.saveRequests,count+1);assert.deepEqual(await snapshot(),saved);await focusEdit("profiles","urgent");
    return "Real HA applied the save before its successful response was replaced with an unclassified transport error; explicit retry rereads and completes without duplicating the write.";
  });

  const pendingFailures=[];
  for(const settlement of [null,"reject","uncertain","refresh-fail"]){
    const outcome=settlement||"confirmed";let passed=false;
    await fresh(`live.save.pending-${outcome}`,async()=>{
      const before=await snapshot(),policy=before.monitoring_policies[0];await policyDraft(policy.id,`Companion ${outcome}`);
      const draft=`Pending ${settlement||"confirmed"}`;await profileDraft("urgent",draft);await fill(field("timing:start"),"06:37");
      const count=transport.saveRequests;transport.mode="hold";await click(action("save-scoped"));await at(action("save-scoped")).filter({hasText:/Saving/}).waitFor();const handle=await at(field("name")).elementHandle();
      assert.equal(await at(action("save-scoped")).isDisabled(),true);const bounds=await at(action("save-scoped")).boundingBox();await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);assert.equal(transport.saveRequests,count+1);
      await call("homeostatic_ui_lab/control",{action:"outage"});assert.equal(await name(),draft);assert.equal(await handle.evaluate(el=>el.isConnected),true);
      const held=[],connection=[...transport.connections].at(-1),retainedInput=await at(field("name")).elementHandle();let unavailable=false;
      transport.transformResponse=(packet,request)=>{
        if(request?.type==="homeostatic/subscribe"&&packet.type==="event"){
          if(packet.event?.available===false)unavailable=true;
          else if(packet.event?.available===true){held.push(packet);return null;}
        }
        return packet;
      };
      await call("homeostatic_ui_lab/control",{action:"reload"});
      await at('.workspace-status').filter({hasText:/Applying changes/}).waitFor({timeout:15000});
      assert.equal(unavailable,true,"Real HA reload published unavailable monitoring");assert.ok(held.length,"Fresh monitoring events are delayed at the browser transport");
      assert.equal(await name(),draft);assert.equal(await at(field("timing:start")).inputValue(),"06:37");assert.equal(await at('main').evaluate(el=>el.inert),true);assert.equal(await retainedInput.evaluate(el=>el.isConnected),true);
      assert.equal(transport.saveRequests,count+1);
      transport.release(settlement);
      if(settlement===null){
        await at('.workspace-status').filter({hasText:/Finishing update/}).waitFor({timeout:30000});assert.equal(await at('main').evaluate(el=>el.inert),true);assert.equal(await name(),draft);
        assert.doesNotMatch(await bodyText(),/Changes saved\./);assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,draft);
      }
      else{
        await error(settlement==="reject"?/Acceptance transport rejected/:settlement==="uncertain"?/Acceptance transport lost/:/were saved.*could not be reloaded/);
        assert.match(await bodyText(),/Monitoring unavailable/);
        if(settlement==="reject")await noChange(before);else assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,draft);
      }
      transport.transformResponse=null;for(const packet of held)connection.route.send(JSON.stringify(packet));
      await at(field("name")).waitFor({timeout:30000});assert.equal(await name(),draft);assert.equal(await at(field("timing:start")).inputValue(),"06:37");
      await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});
      await edit("policies",policy.id);assert.equal(await name(),`Companion ${outcome}`);passed=true;
      return `Real source outage and integration reload retain exact pending editor DOM. Delayed fresh subscription events prove locked pending/finishing or explicit failed/unavailable state; ${outcome} settlement preserves the companion draft and permits no duplicate write.`;
    });
    if(!passed)pendingFailures.push(outcome);
  }
  let reattached=false;
  await fresh("live.save.pending-reattachment",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies[0],companion="Companion survives HA navigation";
    await policyDraft(policy.id,companion);await profileDraft("urgent","Pending across HA navigation");const count=transport.saveRequests;
    transport.mode="hold";await click(action("save-scoped"));await at(action("save-scoped")).filter({hasText:/Saving/}).waitFor();
    // The host owns the panel lifecycle. Follow observed rendered HA controls;
    // never remove/reinsert a DOM node or invoke a component lifecycle handler.
    const overview=page.locator('ha-sidebar #sidebar-panel-home'),menuBounds=await page.locator('ha-sidebar #sidebar-panel-home').boundingBox();
    if(!menuBounds||menuBounds.x<0)await click('.ha-menu');
    const panel=await ctx.card.elementHandle();await overview.click();await ctx.card.waitFor({state:"hidden"});assert.equal(await panel.evaluate(el=>el.isConnected),false);
    await page.goBack();await at('.shell').waitFor({timeout:30000});const samePanel=await panel.evaluate(el=>el.isConnected);
    transport.release();await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});assert.equal(transport.saveRequests,count+1);
    assert.equal((await snapshot()).notification_definitions.profiles.urgent.name,"Pending across HA navigation");
    await edit("policies",policy.id);assert.equal(await name(),companion,`HA Overview/Back ${samePanel?"reattached":"replaced"} the panel; the unrelated draft must remain available`);
    await edit("profiles","urgent");assert.equal(await name(),"Pending across HA navigation");reattached=true;
    return "Real HA Overview and browser Back retain the companion draft while the single pending request completes.";
  });
  if(!reattached)pendingFailures.push("host-panel-reattachment");
  await run("save.pending",async()=>{
    assert.deepEqual(pendingFailures,[],`Pending-save subcases failed: ${pendingFailures.join(", ")}; see their separate artifacts`);
    return "Confirmed, rejected, uncertain and refresh-failed pending saves, source outage, unavailable monitoring, reload, duplicate-click guarding, native HA navigation and companion draft preservation all passed.";
  });
}
