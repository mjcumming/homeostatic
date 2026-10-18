import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {notificationSettings} from "./notification-profiles-fixture.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {emptyReceipt,recordResult,receiptSummary} from "./control-path-inventory.mjs";
import {newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {runWorkspaceControlPaths} from "./workspace-control-paths.mjs";
import {runBrowsingControlPaths} from "./browsing-control-paths.mjs";

const card=document.querySelector("homeostatic-card"),feedback=document.querySelector("#feedback");
const calls=[],receipt=emptyReceipt({fixture:"reusable-editors.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},data:"synthetic",destinations:"mocked"});
let saved=notificationSettings(),revision=1,saveMode="success",refreshFailure=false,releaseSave=null,testMode="requested";
saved.timings={settle:120,unknown_hold:900,retry_hold:120,clear_hold:120,rejoin_grace:60,startup_grace:120,startup_quiet_max:600,coalesce_count:3,coalesce_window:60,batch:30};
saved.monitoring_policies.push({...newMonitoringPolicy(saved.monitoring_policies,"entity"),id:"legacy",name:"Existing custom policy",notifications:[{id:"custom-row",timing:{mode:"immediate"},methods:["phone"]}]});
const deliveryTargets=[{channel:"phone:owner",name:"Owner phone",type:"App",available:true},{channel:"notify:email",name:"Household email",type:"Email",available:true},{channel:"notify:other",name:"Hall display",type:"notification",available:true},{channel:"tts:local:kitchen",name:"Kitchen speaker",destination_name:"Kitchen speaker",destination_id:"kitchen",provider_name:"Local voice",type:"Voice",available:true},{channel:"tts:cloud:kitchen",name:"Kitchen speaker",destination_name:"Kitchen speaker",destination_id:"kitchen",provider_name:"Cloud voice",type:"Voice",available:true},{channel:"sms:family:",name:"Family SMS",type:"SMS",requires_target:true,available:true}];
const configuration=()=>({revision:String(revision),settings:structuredClone(saved),delivery_targets:structuredClone(deliveryTargets),notification_people:[{id:"owner-internal",entity_id:"person.owner",name:"Owner",user_id:"owner-user",administrator:true}],monitoring_policy_templates:[{...newMonitoringPolicy([],"battery",{morning:{}}),id:"default_batteries"}],areas:[{id:"kitchen",name:"Kitchen"}],labels:[{id:"phones",name:"Phones"}]});
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},async callWS(request){
  calls.push(structuredClone(request));
  if(request.type==="homeostatic/configuration") {
    if(refreshFailure){refreshFailure=false;throw Error("Synthetic settings refresh failed");}
    return configuration();
  }
  if(request.type==="homeostatic/save_settings") {
    const people=new Set(configuration().notification_people.map(person=>person.entity_id));
    for(const method of Object.values(request.settings.notification_definitions.methods)) {
      if(method.mode!=="fixed"&&(!method.people?.length||method.people.some(person=>!people.has(person))))throw Object.assign(Error("Choose Home Assistant person entities"),{code:"invalid_settings"});
    }
    if(saveMode==="hold"||saveMode.startsWith("hold-")){
      const outcome=saveMode.slice(5)||"success",current=card.current;saveMode="success";
      if(outcome==="outage"){card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();}
      await new Promise(resolve=>{releaseSave=resolve;});
      if(outcome==="outage"){card.current=current;card.render();}else saveMode=outcome;
    }
    if(saveMode==="reject"){saveMode="success";throw Object.assign(Error("Synthetic storage rejected this save"),{code:"save_failed"});}
    if(saveMode==="rollback-failed"){saveMode="success";throw Object.assign(Error("Synthetic save and rollback failed; monitoring remains unavailable"),{code:"rollback_failed"});}
    if(saveMode==="conflict"){saveMode="success";revision++;saved.notification_definitions.profiles.urgent.name="Changed by another administrator";throw Object.assign(Error("Saved settings changed. Refresh before saving."),{code:"stale_configuration"});}
    if(request.revision!==String(revision))throw Object.assign(Error("Stale settings"),{code:"stale_configuration"});
    saved=structuredClone(request.settings);revision++;document.querySelector("#saved-state").textContent=JSON.stringify(saved,null,2);
    if(saveMode==="lost"){saveMode="success";throw Error("Synthetic response lost after save");}
    if(saveMode==="refresh-fail"){saveMode="success";refreshFailure=true;}
    return {saved:true};
  }
  if(request.type==="homeostatic/preview_delivery_method")return {method_id:request.method_id,preview_token:"synthetic-preview",targets:testMode==="skip"?[]:[{...deliveryTargets[0],available:testMode!=="unavailable"}],skipped:testMode==="skip"};
  if(request.type==="homeostatic/test_delivery_method") {
    if(request.preview_token!=="synthetic-preview")throw Error("Test requires the matching mock preview");
    return {requested:testMode==="requested"?["phone:owner"]:[],failed:testMode==="failed"?[{channel:"phone:owner",error:"Synthetic destination rejected request"}]:[],skipped:testMode==="skip"};
  }
  throw Error("Unexpected request in isolated fixture: "+request.type);
}};
card.current={status:"current",data:monitoringExample()};
card.configuration=configuration();card.settingsDraft=structuredClone(saved);card.page="notifications";card.notificationSection="profiles";card.render();
if(new URLSearchParams(location.search).has("settings-history")) {
  card.page="configuration";card.settingsSection="timing";card.render();
  card.navigation.enabled=true;
  history.replaceState({},"","/homeostatic/settings/timing");
  card.navigation.capture();
}
document.querySelector("#narrow").onchange=event=>{card.style.width=event.target.checked?"390px":"";};
document.querySelector("#failure").onchange=event=>{saveMode=event.target.value;};
document.querySelector("#release").onclick=()=>{releaseSave?.();releaseSave=null;};
const root=card.shadowRoot;
const check=(value,message)=>{if(!value)throw Error(message);};
const find=selector=>{const element=root.querySelector(selector);check(element,"Missing "+selector);return element;};
const tick=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let n=0;n<120;n++){await tick();if(!card.scopedBusy&&!card.deliveryBusy&&!card.deliveryMethodBusy){await tick();return;}}throw Error("The editor did not finish its pending operation");};
const click=async selector=>{const element=find(selector);check(!element.disabled&&!element.closest("[inert]"),"Control is disabled: "+selector);element.scrollIntoView({block:"nearest"});const box=element.getBoundingClientRect(),hit=root.elementFromPoint(box.x+box.width/2,box.y+box.height/2);check(box.width>0&&box.height>0&&(element===hit||element.contains(hit)),"Control is hidden or covered: "+selector);element.click();await tick();};
const change=async(selector,value)=>{const element=find(selector);check(!element.matches(':disabled')&&!element.closest('[inert]'),"Input is disabled: "+selector);element.focus();if(element.type==="checkbox")element.checked=value;else element.value=value;element.dispatchEvent(new Event("input",{bubbles:true,composed:true}));element.dispatchEvent(new Event("change",{bubbles:true,composed:true}));await tick();};
const save=async()=>{await click('[data-definition-action="save-scoped"]');await settle();};
const profiles=async()=>{await click('[data-page="notifications"]');await click('[data-definition-action="notification-view"][data-definition-kind="profiles"]');};
const edit=async id=>{await profiles();await click(`[data-definition-action="edit"][data-definition-kind="profiles"][data-definition-id="${id}"]`);};
const more=async(id,action)=>{await profiles();await click(`[popovertarget="notification-actions-${id}"]`);check(find(`#notification-actions-${id}`).matches(":popover-open"),"More actions opens");await click(`#notification-actions-${id} [data-definition-action="${action}"]`);};
const name=()=>find('[data-definition-field="name"]');
const changeName=value=>change('[data-definition-field="name"]',value);
const persistCount=()=>calls.filter(request=>request.type==="homeostatic/save_settings").length;
const savedList=(kind,id,label)=>{
  check(card.page==="notifications"&&card.notificationSection===kind&&!card.definitionSelection,"Successful save returns to the matching Notifications list");
  const edit=find('[data-definition-action="edit"][data-definition-kind="'+kind+'"][data-definition-id="'+id+'"]');
  check(edit.closest(".definition-list-item").textContent.includes(label)&&!root.querySelector(".definition-save-result")&&!root.textContent.includes("Changes saved."),"The updated row shows the saved name without a success message");
  check(root.activeElement===edit,"Keyboard focus returns to the saved row's Edit control");
};
const publish=()=>{
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);
  parent.postMessage({type:"homeostatic-acceptance",fixture:"reusable-editors.html",receipt},location.origin);
};
async function runPath(id,action){
  try{const before=persistCount();await action();recordResult(receipt,id,"pass",`Rendered controls and saved-state assertions passed; ${persistCount()-before} save request(s), mock revision ${revision}, ${innerWidth}px viewport.`);}
  catch(error){recordResult(receipt,id,"fail",error.message);throw error;}
  finally{publish();}
}

document.querySelector("#run").onclick=async()=>{
  document.querySelector("#run").disabled=true;
  try {
    await runPath("profiles.list",async()=>{
      const tabs=[...root.querySelectorAll('nav[aria-label="Notifications views"]>button')].map(button=>button.getBoundingClientRect());
      check(tabs.length===2&&Math.abs(tabs[0].top-tabs[1].top)<1&&Math.abs(tabs[0].width-tabs[1].width)<1,"Equal-column notification tabs");
      check(root.querySelectorAll('[data-definition-action="edit"][data-definition-kind="profiles"]').length===6,"Six named defaults");
    });
    await runPath("profiles.ordering",async()=>{
      const expected=["acknowledge","immediate","urgent","morning","evening","weekly"],before=JSON.stringify(saved);
      const listed=[...root.querySelectorAll('[data-definition-action="edit"][data-definition-kind="profiles"]')].map(button=>button.dataset.definitionId);
      check(JSON.stringify(listed)===JSON.stringify(expected),"Saved notifications follow delivery timing");
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');
      const picker=find('[data-row-field="profile"]');
      check(JSON.stringify([...picker.options].map(option=>option.value))===JSON.stringify(["",...expected]),"Policy picker uses the list order");
      check(picker.value==="morning","Sorting preserves the assigned notification");
      await more("morning","delete");
      const replacement=find('[data-definition-delete-resolution]');
      check(JSON.stringify([...replacement.options].map(option=>option.value))===JSON.stringify(["","remove-rows","acknowledge","immediate","urgent","evening","weekly"]),"Replacement choices use timing order and exclude the deleted notification");
      await change('[data-definition-delete-resolution]',"immediate");await click('[data-definition-action="cancel-delete"]');
      check(JSON.stringify(saved)===before,"Browsing and cancelling sorted choices leaves saved settings unchanged");
      await profiles();
    });
    await runPath("profiles.create",async()=>{
      await click('[data-definition-action="add"][data-definition-kind="profiles"]');
      await changeName("Unsaved new notification");
      check(Object.keys(saved.notification_definitions.profiles).length===6,"New object is not saved");
      await click('[data-definition-action="discard-scoped"]');
      check(!root.textContent.includes("Unsaved new notification"),"Discard abandons new object");
    });
    await runPath("profiles.invalid",async()=>{
      await edit("morning");await changeName("");const before=persistCount();await save();
      check(persistCount()===before&&name().validity.valueMissing,"Required name blocks Save before a request");
      await changeName("Morning summary");
    });
    await runPath("profiles.save",async()=>{
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');
      await changeName("Pending battery policy");await edit("morning");
      await change('[data-definition-field="timing:at"]',"09:00");await change('[data-definition-field="methods"][data-definition-value="phone"]',true);await save();
      check(saved.notification_definitions.profiles.morning.timing.at==="09:00","Save notification persists timing");
      check(saved.monitoring_policies[0].name==="Low battery"&&card.settingsDraft.monitoring_policies[0].name==="Pending battery policy","Unrelated policy draft remains unsaved");
      savedList("profiles","morning","Morning summary");
      check(!root.querySelector('[data-definition-action="save-scoped"]'),"Completed save removes the editor footer");
    });
    await runPath("profiles.discard",async()=>{
      await edit("morning");await changeName("Discard this name");await click('[data-definition-action="discard-scoped"]');
      check(name().value==="Morning summary"&&card.settingsDraft.monitoring_policies[0].name==="Pending battery policy","Discard restores only this profile");
    });
    await runPath("profiles.timing",async()=>{
      await edit("weekly");
      await change('[data-definition-field="timing:mode"]',"immediate");await save();check(saved.notification_definitions.profiles.weekly.timing.mode==="immediate","Immediate saves");
      savedList("profiles","weekly","Weekly summary");await edit("weekly");
      await change('[data-definition-field="timing:mode"]',"acknowledge");await change('[data-definition-field="timing:minutes"]',"45");await save();check(saved.notification_definitions.profiles.weekly.timing.remind_every===2700,"Acknowledgment saves minutes as seconds");
      savedList("profiles","weekly","Weekly summary");await edit("weekly");
      await change('[data-definition-field="timing:mode"]',"window");await change('[data-definition-field="timing:start"]',"07:00");await change('[data-definition-field="timing:end"]',"21:00");await save();check(saved.notification_definitions.profiles.weekly.timing.start==="07:00"&&saved.notification_definitions.profiles.weekly.timing.end==="21:00","Daily hours save");
      savedList("profiles","weekly","Weekly summary");await edit("weekly");
      await change('[data-definition-field="timing:mode"]',"report");await change('[data-definition-field="timing:at"]',"10:00");
      for(const element of [...root.querySelectorAll('[data-definition-field="timing:weekdays"]')])await change(`[data-definition-field="timing:weekdays"][data-definition-value="${element.dataset.definitionValue}"]`,element.dataset.definitionValue==="6");
      await save();check(saved.notification_definitions.profiles.weekly.timing.at==="10:00"&&JSON.stringify(saved.notification_definitions.profiles.weekly.timing.weekdays)==="[6]","Summary saves selected weekday and time");
      savedList("profiles","weekly","Weekly summary");
    });
    await runPath("profiles.collection-delay",async()=>{
      const selector='[data-definition-field="timing:collection_delay_seconds"]';
      await edit("immediate");
      check(find(selector).value==="60","Supplied Immediate starts with 60 seconds");
      check(root.textContent.includes("Later requests don’t extend the wait")&&root.textContent.includes("0 sends without waiting"),"The fixed-window boundary and zero are explained inline");
      for(const invalid of ["","-1","1.5","later"]) {
        await change(selector,invalid);const before=persistCount();await save();
        check(persistCount()===before&&!find(selector).checkValidity(),"Invalid seconds stay unsaved: "+invalid);
      }
      await change(selector,"23");await save();await edit("immediate");
      check(find(selector).value==="23"&&saved.notification_definitions.profiles.immediate.timing.collection_delay_seconds===23,"Saved seconds reopen exactly");
      await change(selector,"31");await click('[data-definition-action="discard-scoped"]');
      check(find(selector).value==="23","Discard restores the saved delay");
      await change('[data-definition-field="timing:mode"]',"report");
      check(!root.querySelector(selector),"Fixed-time reports hide the field");
      await save();await edit("immediate");
      check(!("collection_delay_seconds" in saved.notification_definitions.profiles.immediate.timing),"Fixed-time reports save no hidden delay");
      await change('[data-definition-field="timing:mode"]',"immediate");
      check(find(selector).value==="0","Returning from report mode starts without collection wait");
      await click('[data-definition-action="discard-scoped"]');
      await profiles();
    });
    await runPath("profiles.delete-cancel",async()=>{
      const before=JSON.stringify(saved);await more("weekly","delete");await click('[data-definition-action="cancel-delete"]');check(JSON.stringify(saved)===before,"Cancel preserves saved configuration");
    });
    await runPath("profiles.delete-draft",async()=>{
      await more("morning","delete");await change('[data-definition-delete-resolution]',"evening");await click('[data-definition-action="confirm-delete"]');await settle();
      check(root.textContent.includes("Save or discard policy drafts")&&saved.notification_definitions.profiles.morning,"Relevant draft blocks deletion");
      await click('[data-definition-action="cancel-delete"]');
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');await click('[data-definition-action="discard-scoped"]');
    });
    await runPath("profiles.duplicate",async()=>{
      await more("morning","duplicate");await changeName("Morning copy");const id=card.definitionSelection.id;await save();
      check(saved.notification_definitions.profiles[id].timing.at==="09:00","Duplicate has independently saved timing");
      savedList("profiles",id,"Morning copy");await edit(id);
      check(name().value==="Morning copy"&&find('[data-definition-field="timing:at"]').value==="09:00","Reopening the copy shows its saved values");
    });
    await runPath("profiles.delete-replace",async()=>{
      const rowId=saved.monitoring_policies[0].notifications[0].id;
      await more("morning","delete");check(find('[data-definition-action="confirm-delete"]').disabled,"Assigned deletion requires a choice");
      await change('[data-definition-delete-resolution]',"evening");await click('[data-definition-action="confirm-delete"]');await settle();
      check(!saved.notification_definitions.profiles.morning&&saved.monitoring_policies[0].notifications[0].profile==="evening"&&saved.monitoring_policies[0].notifications[0].id===rowId,"Replacement is atomic and preserves assignment identity");
    });
    await runPath("profiles.delete-remove",async()=>{
      await more("evening","delete");await change('[data-definition-delete-resolution]',"remove-rows");await click('[data-definition-action="confirm-delete"]');await settle();
      check(!saved.notification_definitions.profiles.evening&&saved.monitoring_policies[0].notifications.length===0,"Explicit removal leaves Dashboard only");
    });
    await runPath("policies.notification",async()=>{
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');
      await change('[data-row-field="profile"]',"urgent");await save();
      check(saved.monitoring_policies[0].notifications[0].profile==="urgent","Policy choice saves through its button");
      const add='.policy-notification-add select',policyId=card.definitionSelection.id;
      const otherPolicies=JSON.stringify(saved.monitoring_policies.slice(1)),definitions=JSON.stringify(saved.notification_definitions);
      check(find(add).value===""&&card.settingsDraft.monitoring_policies[0].notifications.length===1,"Add starts without an implicit assignment");
      await change(add,"acknowledge");
      check(root.querySelectorAll('.policy-notification-row').length===2,"Additional row appears only after a choice");
      check(root.activeElement?.dataset.rowId===card.settingsDraft.monitoring_policies[0].notifications[1].id,"Focus follows the added notification");
      await click('[data-definition-action="remove-row"]');await click('[data-definition-action="discard-scoped"]');
      check(saved.monitoring_policies[0].notifications.length===1,"Discard leaves saved assignments unchanged");
      await click('[data-definition-action="remove-row"]');
      check(!root.querySelector('.policy-notification-row')&&root.textContent.includes("No notifications"),"Removing the final notification shows the empty state");
      check(root.activeElement===find(add),"Focus returns to Add notification");
      saveMode="reject";await save();
      check(card.settingsDraft.monitoring_policies[0].notifications.length===0&&saved.monitoring_policies[0].notifications.length===1,"Failed removal save preserves the empty draft and saved assignment");
      await save();
      check(saved.monitoring_policies[0].notifications.length===0,"Zero notifications saves");
      await click('[data-workspace-return]');await click(`[data-definition-action="edit"][data-definition-id="${policyId}"]`);
      check(!root.querySelector('.policy-notification-row')&&root.textContent.includes("No notifications"),"Reopening retains zero notifications");
      check(JSON.stringify(saved.monitoring_policies.slice(1))===otherPolicies&&JSON.stringify(saved.notification_definitions)===definitions&&!saved.notifications,"Other policies, definitions and global sending are preserved");
      await change(add,"urgent");await save();
      check(saved.monitoring_policies[0].notifications.length===1,"Explicitly adding after empty saves one assignment");
    });
    await runPath("save.failure",async()=>{
      await edit("urgent");await changeName("Urgent edited");saveMode="reject";await save();
      check(name().value==="Urgent edited"&&root.textContent.includes("Synthetic storage rejected"),"Failed save retains input and names error");
      await save();check(saved.notification_definitions.profiles.urgent.name==="Urgent edited","Deliberate retry saves");
      savedList("profiles","urgent","Urgent edited");
    });
    await runPath("save.pending",async()=>{
      await edit("urgent");await changeName("Urgent delayed");saveMode="hold";const before=persistCount();await click('[data-definition-action="save-scoped"]');
      check(Boolean(card.scopedBusy)&&root.textContent.includes("Saving"),"Pending save stays visible");
      const pending=root.querySelector('[data-definition-action="save-scoped"]');check(!pending||pending.disabled||pending.closest('fieldset[disabled]'),"Duplicate submit disabled");
      releaseSave();releaseSave=null;await settle();check(persistCount()===before+1&&saved.notification_definitions.profiles.urgent.name==="Urgent delayed","Only one request submitted");
      savedList("profiles","urgent","Urgent delayed");
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');await changeName("Unrelated policy draft during outage");
      await profiles();await click('[data-definition-action="notification-view"][data-definition-kind="methods"]');await click('[data-definition-action="edit"][data-definition-kind="methods"][data-definition-id="phone"]');await settle();
      await changeName("Phone saved through outage");saveMode="hold";await click('[data-definition-action="save-scoped"]');
      const editorInput=name(),current=card.current,requests=persistCount();
      // The outage belongs to monitoring, so its pending editor must remain available.
      card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();
      check(name()===editorInput&&card.main.inert&&root.textContent.includes("Saving…")&&!card.main.querySelector('.banner'),"An external outage keeps the exact pending editor visible and locked");
      check(root.querySelector('.workspace-status').textContent==="Applying changes…"&&card.current.data.available===false,"Pending editor names the operation without inventing healthy monitoring");
      find('[data-definition-action="save-scoped"]').click();await tick();check(persistCount()===requests,"Disabled repeated Save sends no request");
      card.current={...card.current,status:"disconnected"};card.render();check(name()===editorInput&&root.querySelector('.workspace-status').textContent.includes("Connection lost"),"Disconnect retains pending editor with truthful notice");
      card.current=current;card.render();check(root.textContent.includes("Saving…")&&!root.textContent.includes("Changes saved."),"A current subscription does not confirm the save");
      card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();
      releaseSave();releaseSave=null;await settle();
      check(name()===editorInput&&card.main.inert&&!root.textContent.includes("Changes saved.")&&!root.textContent.includes("Saving…"),"Confirmed response retains the locked editor without a success message");
      check(root.querySelector('.workspace-status').textContent==="Finishing update…","Confirmed save explains the remaining wait without duplicating success");
      check(saved.notification_definitions.methods.phone.name==="Phone saved through outage"&&card.settingsDraft.monitoring_policies[0].name==="Unrelated policy draft during outage"&&saved.monitoring_policies[0].name!=="Unrelated policy draft during outage","Exact method saves while unrelated policy draft stays unsaved");
      card.current=current;card.render();check(!card.main.inert&&name().value==="Phone saved through outage","Current monitoring restores editing after confirmation");
      for(const [outcome,message] of [["reject","Synthetic storage rejected"],["rollback-failed","Synthetic save and rollback failed"],["lost","Synthetic response lost"],["refresh-fail","Changes were saved, but current settings could not be reloaded"]]) {
        await changeName(`Phone ${outcome}`);saveMode=`hold-${outcome}`;await click('[data-definition-action="save-scoped"]');
        const input=name(),beforeResult=persistCount();
        card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();check(name()===input,"Failure scenario starts with retained pending editor");
        card.current={...card.current,status:"disconnected"};card.render();
        releaseSave();releaseSave=null;await settle();
        check(card.main.querySelector('.banner')&&root.textContent.includes(message)&&!root.textContent.includes("Changes saved."),"Failed or uncertain result ends exception and remains explicit");
        card.render();card.render();check(root.textContent.includes(message)&&persistCount()===beforeResult,"Repeated unavailable updates preserve the failure and never resubmit");
        check(card.settingsDraft.notification_definitions.methods.phone.name===`Phone ${outcome}`&&card.settingsDraft.monitoring_policies[0].name==="Unrelated policy draft during outage","Failure preserves both drafts");
        card.current=current;card.render();await save();
        check(saved.notification_definitions.methods.phone.name===`Phone ${outcome}`,"Explicit retry inspects and resolves saved state");
        savedList("methods","phone","Phone "+outcome);
        await click('[data-definition-action="edit"][data-definition-kind="methods"][data-definition-id="phone"]');await settle();
      }
      await changeName("Phone confirmed before runtime error");saveMode="hold";await click('[data-definition-action="save-scoped"]');
      card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();releaseSave();releaseSave=null;await settle();
      card.current={status:"unavailable",data:{schema_version:3,available:false,error:"Synthetic runtime storage failure"}};card.render();
      check(card.main.querySelector('.banner')&&!root.textContent.includes("Changes saved.")&&root.textContent.includes("Monitoring unavailable"),"Terminal runtime error stays visible after confirmed save without a success message");
      card.current=current;card.render();
      await changeName("Phone navigation during outage");saveMode="hold";await click('[data-definition-action="save-scoped"]');
      card.current={status:"unavailable",data:{schema_version:3,available:false}};card.render();
      await click('[data-page="problems"]');check(card.main.querySelector('.banner')&&root.textContent.includes("Monitoring unavailable")&&!card.retainedSave,"Leaving the saving editor restores ordinary unavailable presentation");
      releaseSave();releaseSave=null;await settle();card.current=current;card.render();
      await profiles();await click('[data-definition-action="notification-view"][data-definition-kind="methods"]');await click('[data-definition-action="edit"][data-definition-kind="methods"][data-definition-id="phone"]');await settle();
      check(name().value==="Phone navigation during outage"&&saved.notification_definitions.methods.phone.name===name().value,"Returning after navigation shows the confirmed saved method");
      await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-kind="policies"]');check(name().value==="Unrelated policy draft during outage","Unrelated draft survives external outage sequence");await click('[data-definition-action="discard-scoped"]');
      await edit("urgent");
    });
    await runPath("save.refresh-failure",async()=>{
      await changeName("Urgent saved without refresh");saveMode="refresh-fail";await save();
      check(saved.notification_definitions.profiles.urgent.name==="Urgent saved without refresh"&&root.textContent.includes("were saved"),"Confirmed save is distinguished from failed reread");
      await changeName("Urgent restored");await save();savedList("profiles","urgent","Urgent restored");
    });
    await runPath("save.uncertain",async()=>{
      await edit("urgent");await changeName("Urgent response lost");saveMode="lost";await save();const before=persistCount();
      check(saved.notification_definitions.profiles.urgent.name==="Urgent response lost","Synthetic save applied before response loss");
      await save();check(persistCount()===before,"Retry rereads and does not repeat applied save");
      savedList("profiles","urgent","Urgent response lost");
    });
    await runPath("updates.retention",async()=>{
      await profiles();
      await click('[data-definition-action="notification-view"][data-definition-kind="methods"]');await click('[data-definition-action="edit"][data-definition-kind="methods"]');await settle();
      const input=name();input.focus();input.setSelectionRange(2,5);card.render();card.render();
      check(name()===input&&root.activeElement===input&&input.selectionStart===2,"Unchanged update retains DOM/focus/selection");
      card.current={...card.current,status:"disconnected"};card.render();check(card.main.inert&&root.textContent.includes("last completed update")&&name()===input,"Disconnected view is retained and read-only");
      card.current={...card.current,status:"current"};card.render();check(!card.main.inert,"Fresh snapshot restores controls");
    });
    await runPath("save.conflict",async()=>{
      await edit("urgent");await changeName("Conflicting local name");saveMode="conflict";await save();
      check(name().value==="Conflicting local name"&&saved.notification_definitions.profiles.urgent.name==="Changed by another administrator","Concurrent result does not overwrite server or discard draft");
      const before=persistCount();await save();check(persistCount()===before&&root.textContent.includes("Your draft is preserved"),"Reread identifies object conflict before another mutation");
      await click('[data-definition-action="discard-scoped"]');
    });
    await runWorkspaceControlPaths({card,root,check,find,settle,click,change,save,savedList,runPath,getSaved:()=>saved,setTestMode:value=>{testMode=value;}});
    await runBrowsingControlPaths({card,root,check,find,settle,click,change,save,runPath,getSaved:()=>saved});
    check(saved.notifications===false,"Ordinary sending finishes off");
    check(calls.every(request=>["homeostatic/configuration","homeostatic/save_settings","homeostatic/preview_delivery_method","homeostatic/test_delivery_method"].includes(request.type)),"Only mocked configuration and deliberate test requests");
    await profiles();
    const summary=receiptSummary(receipt);feedback.textContent=`PASS: ${summary.pass} control paths; ${summary.untested} paths remain untested in this fixture. No live requests.`;
  }catch(error){feedback.textContent="FAIL: "+error.message;console.error(error);}
  finally{publish();}
};
publish();
document.querySelector("#saved-state").textContent=JSON.stringify(saved,null,2);
