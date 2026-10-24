import {MONITORING_TYPES} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

export async function runWorkspaceControlPaths(context) {
  const {card,root,check,find,settle,click,change,save,savedList,runPath,getSaved,setTestMode}=context;
  const saved=()=>getSaved();
  const go=async page=>{await click(`[data-page="${page}"]`);if(page==="policies"&&root.querySelector('.unified-policy-editor'))await click('[data-definition-action="close"]');};
  const name=value=>change('[data-definition-field="name"]',value);
  const methods=async()=>{await go("notifications");await click('[data-definition-action="notification-view"][data-definition-kind="methods"]');};
  const method=async id=>{await methods();await click(`[data-definition-action="edit"][data-definition-id="${id}"]`);await settle();};
  const menu=async(kind,id,action)=>{if(kind==="policies")await go("policies");else await methods();const prefix=kind==="policies"?"policy":"method";await click(`[popovertarget="${prefix}-actions-${id}"]`);await click(`#${prefix}-actions-${id} [data-definition-action="${action}"]`);};
  const addDestination=async(type,channel,field="destinations")=>{
    await click(`[data-definition-action="destination-open"][data-destination-field="${field}"]`);
    await change('[data-definition-delivery-type]',type);
    await click(`[data-definition-action="destination-add"][data-destination-channel="${channel}"]`);
  };
  await runPath("methods.lifecycle",async()=>{
    await methods();await click('[data-definition-action="add"][data-definition-kind="methods"]');await name("Abandoned method");
    check(!root.querySelector('[data-definition-action="test-method"]'),"New method cannot send a test");
    await click('[data-definition-action="discard-scoped"]');check(!Object.values(saved().notification_definitions.methods).some(item=>item.name==="Abandoned method"),"Discard creates no saved method");
    await menu("methods","phone","duplicate");await name("Phone copy");const id=card.definitionSelection.id;await save();
    check(saved().notification_definitions.methods[id].destinations.includes("phone:owner"),"Duplicate saves independently");
    savedList("methods",id,"Phone copy");await method(id);
    await name("Discard this method name");await click('[data-definition-action="discard-scoped"]');check(find('[data-definition-field="name"]').value==="Phone copy","Discard restores method");
    await menu("methods",id,"delete");await click('[data-definition-action="cancel-delete"]');check(saved().notification_definitions.methods[id],"Cancel retains method");
    await menu("methods",id,"delete");await click('[data-definition-action="confirm-delete"]');await settle();check(!saved().notification_definitions.methods[id],"Confirm removes unused method");
  });
  await runPath("methods.completion",async()=>{
    await methods();await click('[data-definition-action="add"][data-definition-kind="methods"]');await name("Kitchen Echo");
    const id=card.definitionSelection.id,before=structuredClone(saved());
    await click('[data-definition-action="destination-open"]');await change('[data-definition-delivery-type]',"voice");
    await change('[data-definition-delivery-search]',"Kitchen");await click('[data-definition-action="destination-speaker"]');
    await click('[data-definition-action="destination-add"][data-destination-channel="tts:local:kitchen"]');await save();
    savedList("methods",id,"Kitchen Echo");
    check(JSON.stringify(saved().notification_definitions.methods[id].destinations)==='["tts:local:kitchen"]',"Creation saves the selected speaker destination");
    const expected=structuredClone(before);expected.notification_definitions.methods[id]=structuredClone(saved().notification_definitions.methods[id]);
    check(JSON.stringify(saved())===JSON.stringify(expected),"Creation changes only the new method and leaves sending off");
    await click('[data-definition-action="edit"][data-definition-kind="methods"][data-definition-id="'+id+'"]');await settle();
    check(find('[data-definition-field="name"]').value==="Kitchen Echo"&&Boolean(root.querySelector('[data-definition-action="destination-remove"][data-destination-channel="tts:local:kitchen"]')),"Reopening shows the saved method and selected speaker");
    check(!root.querySelector(".definition-save-result")&&Boolean(root.querySelector('[data-definition-action="test-method"]')),"Reopening exposes the saved method test without success feedback");
  });
  await runPath("methods.destinations",async()=>{
    await method("phone");
    await click('[data-definition-action="destination-remove"][data-destination-channel="phone:owner"]');
    await addDestination("app","phone:owner");
    await click('[data-definition-action="destination-open"]');await change('[data-definition-delivery-type]',"voice");
    await change('[data-definition-delivery-search]',"missing room");check(root.textContent.includes("No available destinations match"),"Search distinguishes empty results");
    await change('[data-definition-delivery-search]',"Kitchen");await click('[data-definition-action="destination-speaker"]');await click('[data-definition-action="destination-add"][data-destination-channel="tts:local:kitchen"]');
    await addDestination("email","notify:email");await addDestination("notification","notify:other");
    await click('[data-definition-action="destination-open"]');await change('[data-definition-delivery-type]',"sms");
    await change('[data-definition-sms-number]',"invalid");await click('[data-definition-action="destination-add-sms"]');check(root.textContent.includes("5–15 digits"),"Invalid SMS number is explained");
    await change('[data-definition-sms-number]',"+15551234567");await click('[data-definition-action="destination-add-sms"]');
    await click('[data-definition-action="destination-open"]');await click('[data-definition-action="destination-close"]');
    check(root.activeElement?.dataset.definitionAction==="destination-open","Picker close returns focus");
    await save();const choices=saved().notification_definitions.methods.phone.destinations;
    check(choices.length===5&&choices.includes("sms:family:%2B15551234567")&&choices.includes("tts:local:kitchen"),"Every supported destination type saves selected values");
    savedList("methods","phone",saved().notification_definitions.methods.phone.name);
  });
  await runPath("methods.presence",async()=>{
    await method("phone");await click('.method-presence summary');await change('[data-definition-field="mode"]',"home_away");
    await change('[data-definition-field="people"][data-person="person.owner"]',true);
    await addDestination("app","phone:owner","home");await addDestination("email","notify:email","away");await addDestination("notification","notify:other","fallback");await save();
    check(JSON.stringify(saved().notification_definitions.methods.phone.people)==="[\"person.owner\"]","Presence Save uses the catalog entity identity, never owner-internal");
    check(saved().notification_definitions.methods.phone.home[0]==="phone:owner"&&saved().notification_definitions.methods.phone.away[0]==="notify:email"&&saved().notification_definitions.methods.phone.fallback[0]==="notify:other","Home/away and fallback save separately");
    savedList("methods","phone",saved().notification_definitions.methods.phone.name);await method("phone");
    await change('[data-definition-field="mode"]',"home_people");await change('[data-definition-field="people"][data-person="person.owner"]',true);await addDestination("app","phone:owner","person_destinations:person.owner");await change('[data-definition-field="skip"]',true);await save();
    check(JSON.stringify(saved().notification_definitions.methods.phone.people)==="[\"person.owner\"]","Per-person Save retains the full entity identity");
    check(saved().notification_definitions.methods.phone.skip&&saved().notification_definitions.methods.phone.person_destinations["person.owner"][0]==="phone:owner","Per-person destinations and skip save");
    savedList("methods","phone",saved().notification_definitions.methods.phone.name);
  });
  await runPath("methods.test",async()=>{
    await method("phone");await name("Dirty method");check(!root.querySelector('[data-definition-action="test-method"]'),"Dirty method cannot send a test");await click('[data-definition-action="discard-scoped"]');
    for(const [mode,message] of [["requested","Test requested for Owner phone"],["failed","No test requests succeeded"],["skip","test was skipped"],["unavailable","configured destination is unavailable"]]) {
      setTestMode(mode);await click('[data-definition-action="test-method"]');await settle();check(root.textContent.includes(message),`${mode} result is truthful`);
    }
    setTestMode("requested");check(saved().notifications===false,"Tests do not enable ordinary sending");
  });
  await runPath("policies.lifecycle",async()=>{
    await go("policies");await click('[data-definition-action="add"][data-definition-kind="policies"]');await click('[data-definition-action="close"]');
    await click('[data-definition-action="add"][data-definition-kind="policies"]');await change('[data-definition-template]',"device");await click('[data-definition-action="create"]');await name("Acceptance policy");await change('[data-definition-field="enabled"]',true);await save();const id=card.definitionSelection.id;
    check(saved().monitoring_policies.find(row=>row.id===id)?.enabled,"New policy saves enabled state");
    await name("Discard policy name");await click('[data-definition-action="discard-scoped"]');check(find('[data-definition-field="name"]').value==="Acceptance policy","Policy discard restores saved name");
    await menu("policies",id,"duplicate");const copy=card.definitionSelection.id;await save();check(saved().monitoring_policies.find(row=>row.id===copy)?.enabled===false,"Duplicate starts disabled");
    await menu("policies",copy,"delete");await click('[data-definition-action="cancel-delete"]');check(saved().monitoring_policies.some(row=>row.id===copy),"Cancel retains policy");
    await menu("policies",copy,"delete");await click('[data-definition-action="confirm-delete"]');await settle();check(!saved().monitoring_policies.some(row=>row.id===copy),"Confirm removes only named policy");
  });
  await runPath("policies.detection",async()=>{
    for(const [type,label] of Object.entries(MONITORING_TYPES)) {
      await go("policies");await click('[data-definition-action="add"][data-definition-kind="policies"]');await change('[data-definition-template]',type);await click('[data-definition-action="create"]');await name(`Review ${label}`);
      if(type==="temperature_limit")await change('[data-definition-field="parameters:minimum"]',"40");
      const fields=[...root.querySelectorAll('[data-definition-field^="parameters:"]')];
      for(const element of fields)check(element.checkValidity(),`${label}: initial detection field is valid`);
      const id=card.definitionSelection.id,expected=structuredClone(card.editors.settingsDraft.monitoring_policies.find(row=>row.id===id));await save();
      check(JSON.stringify(saved().monitoring_policies.find(row=>row.id===id))===JSON.stringify(expected),`${label}: detection choices save exactly`);
    }
  });
  await runPath("policies.restore",async()=>{
    await go("policies");await click('[data-definition-action="restore"]');await click('[data-definition-action="cancel-restore"]');
    await click('[data-definition-action="restore"]');await change('[data-definition-restore="default_batteries"]',true);await click('[data-definition-action="confirm-restore"]');
    check(!saved().monitoring_policies.some(row=>row.id==="default_batteries"),"Restoration stages but does not save");
    await click('[data-definition-action="edit"][data-definition-id="default_batteries"]');await save();check(saved().monitoring_policies.find(row=>row.id==="default_batteries").notifications.length===0,"Missing default profile does not become an invalid reference");
  });
  await runPath("navigation.pages",async()=>{
    await go("policies");await click('[data-definition-action="edit"][data-definition-id="policy-1"]');await name("Navigation draft");
    for(const page of ["problems","sources","notifications","configuration","policies"]) {await go(page);check(card.page===page,`${page}: destination is selected`);check(card.editors.settingsDraft.monitoring_policies[0].name==="Navigation draft","Page change retains draft");}
  });
  await runPath("sending.switch",async()=>{
    await change('[data-notifications-switch]',true);await settle();check(saved().notifications===true&&saved().monitoring_policies[0].name==="Low battery","Global On saves independently");
    await change('[data-notifications-switch]',false);await settle();check(!saved().notifications&&card.editors.settingsDraft.monitoring_policies[0].name==="Navigation draft","Global Off preserves draft");
    await click('[data-definition-action="edit"][data-definition-id="policy-1"]');await click('[data-definition-action="discard-scoped"]');
  });
  await runPath("settings.edit",async()=>{
    await go("configuration");const field=find('[data-setting-path="timings.clear_hold"]');const before=saved().timings.clear_hold;
    await change('[data-setting-path="timings.clear_hold"]',String(Number(field.value)+1));await save();check(saved().timings.clear_hold!==before,"Timing saves");
    await change('[data-setting-path="timings.clear_hold"]',"-1");check(!find('[data-setting-path="timings.clear_hold"]').checkValidity()&&Boolean(find('[data-setting-path="timings.clear_hold"]').validationMessage),"Invalid timing identifies the field with a native validation message");
    await change('[data-setting-path="timings.clear_hold"]',"4");await click('[data-definition-action="discard-scoped"]');
    check(!root.querySelector('[data-settings-section], [data-setting-path="timings.coalesce_count"], [data-setting-path="timings.coalesce_window"]'),"Settings has one timing page without inactive grouping controls");
    const legacy={count:saved().timings.coalesce_count,window:saved().timings.coalesce_window};
    await click('[data-ui-key="settings-advanced-timing"] summary');await change('[data-setting-path="timings.settle"]',"4");await save();
    check(saved().timings.settle===240,"Advanced timing saves through its visible button");
    check(saved().timings.coalesce_count===legacy.count&&saved().timings.coalesce_window===legacy.window,"Timing save preserves inactive saved values");
  });
}
