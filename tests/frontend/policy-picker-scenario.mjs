import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const card=document.querySelector("homeostatic-card"),feedback=document.querySelector("#feedback");
const areas=[{id:"kitchen",name:"Kitchen",floor_id:"ground"},{id:"garage",name:"Garage",floor_id:"ground"},{id:"office",name:"Office",floor_id:"upper"},{id:"empty",name:"Spare room",floor_id:"upper"}];
const floors=[{id:"ground",name:"Ground floor"},{id:"upper",name:"Upstairs"}];
const labels=[{id:"safety",name:"Safety"},{id:"climate",name:"Climate"},{id:"future",name:"Future equipment"}];
const source=(kind,id,name,attributes={},extra={})=>({node_id:`${kind}:${id}`,name,kind,attributes:{kind:[kind],...(kind==="device"||kind==="ups"?{device:[id]}:{entity:[`registry:${id}`]}),...attributes},watched:false,attached_by:[],requirements:[],...extra});
const rows=[
  source("battery","kitchen-motion","Motion sensor battery",{area:["kitchen"],label:["safety"]},{entity_id:"sensor.kitchen_motion_battery",state:"unavailable"}),
  source("battery","garage-motion","Motion sensor battery",{area:["garage"],label:["safety"]},{entity_id:"sensor.garage_motion_battery",state:"unknown"}),
  source("battery","kitchen-motion-2","Motion sensor battery",{area:["kitchen"]},{entity_id:"sensor.kitchen_motion_battery_2"}),
  source("battery","long-name","Garden-facing window contact sensor with a long descriptive equipment name",{area:["kitchen"]},{entity_id:"sensor.garden_facing_window_contact_battery"}),
  source("battery","unassigned","Loose battery",{},{entity_id:"sensor.loose_battery"}),
  source("battery","missing-area","Moved battery",{area:["removed"]},{entity_id:"sensor.moved_battery"}),
  source("device","kitchen-device","Motion sensor",{area:["kitchen"]}),
  source("device","garage-device","Motion sensor",{area:["garage"]}),
  source("vacuum","robot","Robot vacuum",{area:["garage"]},{entity_id:"vacuum.robot"}),
  source("ups","backup","Network backup",{area:["office"]}),
  source("entity","temperature","Temperature",{domain:["sensor"],device_class:["temperature"],area:["office"],label:["climate"]},{entity_id:"sensor.office_temperature"}),
  source("entity","thermostat","Heating",{domain:["climate"],area:["garage"],label:["climate"]},{entity_id:"climate.garage"}),
  source("entity","humidity","Humidity",{domain:["sensor"],device_class:["humidity"],area:["kitchen"]},{entity_id:"sensor.kitchen_humidity"}),
];
const initial=notificationSettings();
initial.monitoring_policies=[...new Set(["battery","device","entity","vacuum","ups_power","thermostat","temperature_limit"])].map(type=>({...newMonitoringPolicy([],type),id:type,name:type==="battery"?"Batteries":type,match:{kind:[type.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(type)?"entity":type],...(type==="battery"?{entity:["registry:kitchen-motion"]}:{})}}));
initial.timings={settle:120,unknown_hold:900,retry_hold:120,clear_hold:120,rejoin_grace:60,startup_grace:120,startup_quiet_max:600,coalesce_count:3,coalesce_window:60,batch:30};
const freshData=()=>({...monitoringExample(),schema_version:3,catalog_loaded:true,areas:structuredClone(areas),floors:structuredClone(floors),devices:[],inventory:{...monitoringExample().inventory,nodes:[],catalog:{candidates:structuredClone(rows)}}});
let saved=structuredClone(initial),revision=1,rejectSave=false,receipt,keyboardBefore=null;
const calls=[];
const configuration=()=>({revision:String(revision),settings:structuredClone(saved),areas:structuredClone(areas),floors:structuredClone(floors),labels:structuredClone(labels),delivery_targets:[],notification_people:[],monitoring_policy_templates:[]});
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:()=>null,async callWS(request){
  calls.push(structuredClone(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/save_settings") {
    if(rejectSave){rejectSave=false;throw Object.assign(Error("Synthetic save rejection"),{code:"save_failed"});}
    if(request.revision!==String(revision))throw Object.assign(Error("Synthetic revision conflict"),{code:"stale_configuration"});
    saved=structuredClone(request.settings);revision++;publish();return {saved:true};
  }
  throw Error("Unexpected request in isolated picker fixture: "+request.type);
}};
const root=card.shadowRoot;
const check=(value,message)=>{if(!value)throw Error(message);};
const tick=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const find=selector=>{const element=root.querySelector(selector);check(element,"Missing "+selector);return element;};
const click=async selector=>{
  const element=find(selector);check(!element.matches(":disabled")&&!element.closest("[inert]"),"Control is enabled: "+selector);
  element.scrollIntoView({block:"nearest"});await tick();
  const box=element.getBoundingClientRect(),hit=root.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
  check(box.width>0&&box.height>0&&(hit===element||element.contains(hit)),"Control is reachable: "+selector);
  element.click();await tick();
};
const change=async(selector,value)=>{const element=find(selector);element.focus();if(element.type==="checkbox")element.checked=value;else element.value=value;element.dispatchEvent(new Event("input",{bubbles:true,composed:true}));element.dispatchEvent(new Event("change",{bubbles:true,composed:true}));await tick();};
const settle=async()=>{for(let n=0;n<100;n++){await tick();if(!card.scopedBusy&&!card.settingsBusy){await tick();return;}}throw Error("Mock save did not settle");};
const pick=()=>click('[data-definition-action="pick"]');
const finish=()=>click('[data-definition-action="finish-pick"]');
const save=async()=>{await click('[data-definition-action="save-scoped"]');await settle();};
const option=id=>`[data-definition-field="selection"][data-definition-value="${id}"]`;
const ids=()=>[...root.querySelectorAll('[data-definition-field="selection"]')].map(input=>input.dataset.definitionValue).sort();
const row=id=>find(option(id)).closest("label");
const saveCount=()=>calls.filter(request=>request.type==="homeostatic/save_settings").length;
const policy=()=>card.settingsDraft.monitoring_policies.find(item=>item.id==="battery");
const publish=()=>{window.policyPickerReceipt=receipt;document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);document.querySelector("#saved-state").textContent=JSON.stringify(saved,null,2);};
const reset=()=>{saved=structuredClone(initial);revision=1;calls.length=0;rejectSave=false;card.scopedConfiguration=null;card.scopedError=null;card.scopedNotice=null;card.configuration=configuration();card.settingsDraft=structuredClone(saved);card.current={status:"current",data:freshData()};card.page="policies";card.definitionSelection={kind:"policies",id:"battery"};card.policyPicker=null;card.render();};
const cases=[
  ["keyboard-escape","Open picker, focus search, press the native Escape key","Escape closes the picker, preserves the draft and returns focus to Choose batteries."],
  ["source-context","Choose batteries, search by area and entity ID, select across the row","Names retain area and floor; remaining duplicates show entity IDs; no save occurs."],
  ["area-relevance","Watch batteries in areas, Show all areas, selected only","Only areas with suitable batteries appear by default; selected empty areas remain visible."],
  ["label-relevance","Watch batteries with labels, Show all labels","Only relevant labels appear by default, and empty selections remain explicit."],
  ["catalog-loading","Loading, failed catalog load, complete catalog refresh","Loading and retryable failures retain saved identities without claiming emptiness."],
  ["scoped-save","Save policy, return to list, reopen","The area selection persists; unrelated policy and delivery drafts remain unsaved."],
  ["save-rejection","Invalid empty selection, rejected save, deliberate retry","Invalid selection sends no request; failed save keeps the exact draft for retry."],
  ["selection-layout","Full-width search, compact clickable rows, long name and narrow viewport","Search and rows fit the viewport, retain accessible labels and meet touch target size."],
];
const freshReceipt=()=>({schema_version:1,started_at:new Date().toISOString(),environment:{fixture:"policy-picker.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",data:"synthetic",saves:"mocked",physical_safari:"untested"},results:cases.map(([id,controls,expected])=>({id,controls,expected,status:"untested",evidence:[]}))});
async function runPath(id,action) {
  const item=receipt.results.find(result=>result.id===id),before=saveCount();
  try{await action();item.status="pass";item.evidence.push(`Rendered controls and state assertions passed; ${saveCount()-before} mocked save request(s).`);}
  catch(error){item.status="fail";item.evidence.push(error.message);throw error;}
  finally{publish();}
}
async function show() {reset();await pick();feedback.textContent="Battery choices with duplicate names, location metadata and a long equipment name.";}
document.querySelector("#show").onclick=show;
document.querySelector("#keyboard").onclick=async()=>{
  if(card.policyPicker)await finish();
  keyboardBefore=JSON.stringify(card.settingsDraft);await pick();
  check(root.activeElement===find('[data-definition-picker-search]'),"Opening the picker focuses search");
  feedback.textContent="Press the real Escape key. The picker should close, preserve the draft and return focus to Choose batteries.";
};
root.addEventListener("keydown",async event=>{
  if(event.key!=="Escape"||!event.isTrusted||keyboardBefore===null)return;
  await tick();const item=receipt.results.find(result=>result.id==="keyboard-escape");
  const passed=card.policyPicker===null&&JSON.stringify(card.settingsDraft)===keyboardBefore&&root.activeElement?.dataset.definitionAction==="pick";
  item.status=passed?"pass":"fail";item.evidence.push(passed?"Native Escape preserved the draft and returned focus after search received focus on opening.":"Native Escape did not preserve the expected focus and draft.");keyboardBefore=null;
  feedback.textContent=passed?"PASS: native Escape closes the picker and returns focus.":"FAIL: native Escape focus or draft preservation.";publish();
});
document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};
document.querySelector("#run").onclick=async()=>{
  reset();receipt=freshReceipt();publish();feedback.textContent="Running isolated picker checks…";
  try {
    await runPath("source-context",async()=>{
      await pick();check(root.activeElement===find('[data-definition-picker-search]'),"Opening the picker focuses search");check(row("registry:kitchen-motion").textContent.includes("Kitchen")&&row("registry:kitchen-motion").textContent.includes("Ground floor"),"Battery includes area and floor");
      check(row("registry:kitchen-motion").textContent.includes("sensor.kitchen_motion_battery")&&row("registry:kitchen-motion-2").textContent.includes("sensor.kitchen_motion_battery_2"),"Same-name and same-area choices include entity IDs");
      check(!row("registry:garage-motion").textContent.includes("sensor.garage_motion_battery"),"Area alone distinguishes the garage battery");
      check(row("registry:unassigned").textContent.includes("No area assigned")&&row("registry:missing-area").textContent.includes("Area unavailable"),"Absent assignment differs from missing area metadata");
      await change('[data-definition-picker-search]',"Garage");check(JSON.stringify(ids())===JSON.stringify(["registry:garage-motion"]),"Search matches area");
      await click(`${option("registry:garage-motion")} + .policy-picker-copy`);check(policy().match.entity.includes("registry:garage-motion"),"The text row selects its checkbox");
      await change('[data-definition-picker-search]',"sensor.kitchen_motion_battery_2");check(JSON.stringify(ids())===JSON.stringify(["registry:kitchen-motion-2"]),"Search matches entity ID");
      await finish();check(root.activeElement?.dataset.definitionAction==="pick","Done returns focus to the picker button");check(root.textContent.includes("Kitchen")&&root.textContent.includes("Garage"),"Closed selection summary retains area");check(saveCount()===0,"Selection is still a draft");
    });
    await runPath("area-relevance",async()=>{
      await change('[data-definition-field="watch"]',"area");await pick();
      check(JSON.stringify(ids())===JSON.stringify(["garage","kitchen"]),"Only areas containing batteries are initially offered");
      check(row("kitchen").textContent.includes("3 batteries")&&row("garage").textContent.includes("1 battery"),"Counts include unavailable and unknown battery readings");
      await click(option("kitchen"));await change('[data-definition-picker-all]',true);check(ids().includes("empty")&&ids().includes("office"),"Show all includes empty areas");
      await click(option("empty"));await change('[data-definition-picker-all]',false);check(ids().includes("empty")&&!ids().includes("office"),"Selected empty area stays visible after Show all is off");
      check(row("empty").textContent.includes("No batteries currently found"),"Empty selected area is explained");
      await change('[data-definition-picker-selected]',true);check(JSON.stringify(ids())===JSON.stringify(["empty","kitchen"]),"Selected-only filter includes the empty area");
      await click(option("empty"));check(!ids().includes("empty")&&root.activeElement===find('[data-definition-picker-search]'),"Removing a filtered row moves focus to search");
      await change('[data-definition-picker-selected]',false);await change('[data-definition-picker-all]',true);await click(option("empty"));await change('[data-definition-picker-all]',false);await finish();
    });
    await runPath("label-relevance",async()=>{
      await change('[data-definition-field="watch"]',"label");await pick();check(JSON.stringify(ids())===JSON.stringify(["safety"]),"Only matching battery label appears");
      await change('[data-definition-picker-all]',true);await click(option("future"));await change('[data-definition-picker-all]',false);
      check(JSON.stringify(ids())===JSON.stringify(["future","safety"]),"Selected empty label remains reachable");check(row("future").textContent.includes("No batteries currently found"),"Empty label is explained");await finish();
    });
    await runPath("catalog-loading",async()=>{
      await change('[data-definition-field="watch"]',"area");await pick();await click(option("kitchen"));
      card.current={...card.current,data:{...card.current.data,catalog_loaded:false}};card.render();await tick();
      check(root.textContent.includes("Loading available sources")&&!root.textContent.includes("No batteries currently found"),"Loading cannot claim an empty area");check(policy().match.area.includes("kitchen"),"Loading retains selected identity");
      card.current.catalogError="Synthetic catalog failure";card.render();await tick();check(root.textContent.includes("Synthetic catalog failure")&&root.querySelector('[data-action="retry-catalog"]'),"Catalog failure offers retry");
      card.current={status:"current",data:freshData()};card.render();await tick();check(find(option("kitchen")).checked,"Complete catalog restores checked choice");await finish();
    });
    await runPath("scoped-save",async()=>{
      await pick();await change('[data-definition-picker-all]',true);await click(option("empty"));await finish();
      const originalMethods=structuredClone(saved.notification_definitions.methods),other=saved.monitoring_policies.find(item=>item.id==="device");
      card.settingsDraft.notification_definitions.methods.phone.name="Unrelated method draft";card.settingsDraft.monitoring_policies.find(item=>item.id==="device").name="Unrelated device draft";card.render();await tick();
      await save();check(JSON.stringify(saved.monitoring_policies.find(item=>item.id==="battery").match.area)===JSON.stringify(["kitchen","empty"]),"Saved area IDs match the draft");
      check(JSON.stringify(saved.notification_definitions.methods)===JSON.stringify(originalMethods)&&JSON.stringify(saved.monitoring_policies.find(item=>item.id==="device"))===JSON.stringify(other),"Save leaves unrelated persisted settings unchanged");
      check(card.settingsDraft.notification_definitions.methods.phone.name==="Unrelated method draft"&&card.settingsDraft.monitoring_policies.find(item=>item.id==="device").name==="Unrelated device draft","Unrelated drafts remain pending");
      const returnSelector=["[data-workspace-return]",'[data-definition-action="close"]'].find(selector=>root.querySelector(selector)?.getClientRects().length);
      check(returnSelector,"A visible Back to Policies control is present");await click(returnSelector);await click('[data-definition-action="edit"][data-definition-id="battery"]');await pick();check(find(option("kitchen")).checked&&find(option("empty")).checked,"Reopened saved editor keeps both selections");await finish();
    });
    await runPath("save-rejection",async()=>{
      await change('[data-definition-field="watch"]',"selected");const before=saveCount();await save();check(saveCount()===before&&root.textContent.includes("Choose at least one"),"Empty selection is rejected before save");
      await pick();await click(option("registry:garage-motion"));await finish();rejectSave=true;await save();
      check(root.textContent.includes("Synthetic save rejection")&&JSON.stringify(policy().match.entity)===JSON.stringify(["registry:garage-motion"]),"Rejected save retains the exact choice");
      check(saved.monitoring_policies.find(item=>item.id==="battery").match.area.includes("empty"),"Rejected save leaves confirmed area choice intact");await save();check(JSON.stringify(saved.monitoring_policies.find(item=>item.id==="battery").match.entity)===JSON.stringify(["registry:garage-motion"]),"Deliberate retry persists the intended entity");
    });
    await runPath("selection-layout",async()=>{
      await pick();const picker=find(".policy-picker"),search=find('[data-definition-picker-search]'),searchBox=search.getBoundingClientRect(),pickerBox=picker.getBoundingClientRect();
      check(search.labels.length===1&&search.labels[0].textContent.includes("Search by name or area"),"Search has a visible accessible label");check(searchBox.width>=pickerBox.width-60,"Search spans the picker width");
      check(root.querySelectorAll('.policy-picker [role="status"]').length===1,"The picker has one selection count");
      for(const label of root.querySelectorAll(".policy-picker-choice")) {
        const box=label.getBoundingClientRect();check(box.height>=44,"Every row has a 44px touch target");check(label.scrollWidth<=label.clientWidth+1,"Long names and IDs wrap within their row");
        check(label.querySelector("input")&&label.querySelector(".policy-picker-copy"),"Each full row labels its checkbox");
      }
      const last=row("registry:missing-area");last.scrollIntoView({block:"nearest"});await tick();const box=last.getBoundingClientRect(),hit=root.elementFromPoint(box.x+box.width/2,box.y+box.height/2);check(hit===last||last.contains(hit),"Scrolling reaches the final choice");
      check(card.scrollWidth<=card.clientWidth+1&&picker.scrollWidth<=picker.clientWidth+1,"Card and picker avoid horizontal overflow");check(saved.notifications===false&&calls.every(request=>["homeostatic/configuration","homeostatic/save_settings"].includes(request.type)),"No notification or live requests occurred");
    });
    feedback.textContent=`PASS: ${receipt.results.filter(item=>item.status==="pass").length} picker paths at ${innerWidth}px. Choose Check native Escape to finish keyboard acceptance. Physical Safari remains untested.`;
  }catch(error){feedback.textContent="FAIL: "+error.message;}
  finally{receipt.finished_at=new Date().toISOString();publish();}
};
reset();receipt=freshReceipt();publish();
