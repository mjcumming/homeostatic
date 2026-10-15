import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const card=document.querySelector("homeostatic-card"),feedback=document.querySelector("#feedback"),root=card.shadowRoot;
const areas=[{id:"utility",name:"Utility room",floor_id:"ground"},{id:"kitchen",name:"Kitchen",floor_id:"ground"},{id:"garage",name:"Garage",floor_id:"ground"},{id:"bedroom",name:"Bedroom",floor_id:"upper"},{id:"office",name:"Office",floor_id:"upper"}];
const floors=[{id:"ground",name:"Ground floor"},{id:"upper",name:"Upstairs"}];
const sensors=Array.from({length:50},(_,index)=>{
  const number=String(index+1).padStart(2,"0"),area=areas[index%areas.length],reference=`registry:temperature-${number}`;
  return {node_id:`entity:${reference}`,monitoring_source:`entity:${reference}`,name:`${area.name} temperature ${number}`,kind:"entity",entity_id:`sensor.temperature_${number}`,attributes:{kind:["entity"],entity:[reference],device:[`device-${number}`],domain:["sensor"],device_class:["temperature"],area:[area.id],floor:[area.floor_id]},watched:false,attached_by:[],requirements:[],state:"68"};
});
sensors[0].name="Main Floor Thermostat Indoor temperature";
sensors[1].name="Second Floor Thermostat Indoor temperature";
const initial=notificationSettings();
initial.notification_definitions.profiles.acknowledge.methods=["phone"];
initial.monitoring_policies=[{...newMonitoringPolicy([],"temperature_limit",initial.notification_definitions.profiles),id:"temperature",name:"Home Interior Temperature Monitoring",match:{kind:["entity"],entity:["registry:temperature-01","registry:temperature-02"]},parameters:{unit:"°F",minimum:60,maximum:null,duration_seconds:3600},enabled:true},{...newMonitoringPolicy([],"battery",initial.notification_definitions.profiles),id:"battery",name:"Low batteries"}];
initial.timings={settle:120,unknown_hold:900,retry_hold:120,clear_hold:120,rejoin_grace:60,startup_grace:120,startup_quiet_max:600,coalesce_count:3,coalesce_window:60,batch:30};
const freshData=()=>{const data=monitoringExample();return {...data,schema_version:3,catalog_loaded:true,areas:structuredClone(areas),floors:structuredClone(floors),devices:sensors.map(source=>({id:source.attributes.device[0],name:source.name})),inventory:{...data.inventory,nodes:sensors.slice(0,2).map(source=>({...source,node_id:`check:${source.node_id}`,name:`${source.name} · Entities`,watched:true})),catalog:{candidates:structuredClone(sensors)}}};};
let saved=structuredClone(initial),revision=1,rejectSave=false,receipt;
const calls=[];
const configuration=()=>({revision:String(revision),settings:structuredClone(saved),areas:structuredClone(areas),floors:structuredClone(floors),labels:[],delivery_targets:[{channel:"phone:owner",name:"Owner phone",type:"App",available:true}],notification_people:[],monitoring_policy_templates:[]});
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:()=>null,async callWS(request){
  calls.push(structuredClone(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/save_settings") {
    if(rejectSave){rejectSave=false;throw Object.assign(Error("Synthetic save rejection"),{code:"save_failed"});}
    if(request.revision!==String(revision))throw Object.assign(Error("Synthetic revision conflict"),{code:"stale_configuration"});
    saved=structuredClone(request.settings);revision++;publish();return {saved:true};
  }
  throw Error("Unexpected request in isolated temperature fixture: "+request.type);
}};
const check=(value,message)=>{if(!value)throw Error(message);};
const tick=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const find=selector=>{const element=root.querySelector(selector);check(element,"Missing "+selector);return element;};
const field=name=>`[data-definition-field="${name}"]`;
const bound=name=>field(`parameters:${name}`);
const duration=()=>find(bound("duration_seconds"));
const durationUnit=()=>find(field("duration-unit:duration_seconds"));
const currentPolicy=()=>card.settingsDraft.monitoring_policies.find(item=>item.id==="temperature");
const savedPolicy=()=>saved.monitoring_policies.find(item=>item.id==="temperature");
const saveCount=()=>calls.filter(request=>request.type==="homeostatic/save_settings").length;
const click=async selector=>{
  const element=find(selector);check(!element.matches(":disabled")&&!element.closest("[inert]"),"Control is enabled: "+selector);
  element.scrollIntoView({block:"nearest"});await tick();
  const box=element.getBoundingClientRect(),hit=root.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
  check(box.width>0&&box.height>0&&(hit===element||element.contains(hit)),"Control is reachable: "+selector);
  element.focus({preventScroll:true});element.click();await tick();
};
const change=async(selector,value)=>{const element=find(selector);check(!element.matches(":disabled")&&!element.closest("[inert]"),"Input is enabled: "+selector);element.focus();if(element.type==="checkbox")element.checked=value;else element.value=value;element.dispatchEvent(new Event("input",{bubbles:true,composed:true}));element.dispatchEvent(new Event("change",{bubbles:true,composed:true}));await tick();};
const settle=async()=>{for(let attempt=0;attempt<100;attempt++){await tick();if(!card.scopedBusy&&!card.settingsBusy){await tick();return;}}throw Error("Mock save did not settle");};
const save=async()=>{await click('[data-definition-action="save-scoped"]');await settle();check(!/Changes saved|saved\./i.test(root.textContent),"A save leaves no persistent success message");};
const discard=()=>click('[data-definition-action="discard-scoped"]');
const pick=()=>click('[data-definition-action="pick"]');
const finish=()=>click('[data-definition-action="finish-pick"]');
const selection=id=>`[data-definition-field="selection"][data-definition-value="${id}"]`;
const reopen=async()=>{await click('[data-definition-action="close"]');await click('[data-definition-action="edit"][data-definition-id="temperature"]');};
const visibleError=()=>Boolean([...root.querySelectorAll('.config-error,[role="alert"],[aria-invalid="true"],input:invalid')].find(element=>element.getClientRects().length));
const publish=()=>{window.temperaturePolicyReceipt=receipt;document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);document.querySelector("#saved-state").textContent=JSON.stringify(saved,null,2);};
const reset=()=>{saved=structuredClone(initial);revision=1;calls.length=0;rejectSave=false;card.scopedConfiguration=null;card.scopedBusy=null;card.settingsBusy=false;card.scopedError=null;card.scopedNotice=null;card.configuration=configuration();card.settingsDraft=structuredClone(saved);card.current={status:"current",data:freshData()};card.page="policies";card.definitionSelection={kind:"policies",id:"temperature"};card.policyPicker=null;card.policyCreating=false;card.policyDurationUnits={};card.policyValidation=null;card.navigation.entries.clear();card.navigation.origins.clear();card.navigation.currentId=null;card.navigation.lastPath=null;card.workspaceReturn=null;card.renderedContent=null;card.savedPageState=null;card.render();};
const cases=[
  ["initial-state","Saved temperature editor","Below 60°F, no upper bound, 60 minutes and monitoring enabled in the heading; global notifications stay off."],
  ["lower-only","Below, Above, duration and Save policy","A lower-only policy saves exact bounds and duration and reopens correctly."],
  ["upper-only","Below, Above and Save policy","An upper-only policy saves without inventing a lower bound."],
  ["both-bounds","Below, Above and Save policy","Both bounds persist independently."],
  ["missing-bounds","Clear both bounds and Save policy","Visible validation blocks the request and retains input."],
  ["reversed-bounds","Lower bound above upper bound and Save policy","Visible validation blocks the request and retains input."],
  ["missing-sensors","Remove the selected sensors and Save policy","An empty exact selection is blocked before saving."],
  ["duration-units","Minutes, hours and numeric duration","Unit-only changes stay clean; edits convert to exact integer seconds."],
  ["enabled-state","Header monitoring switch and Save policy","Monitoring state saves independently of global sending."],
  ["save-and-discard","Rejected save, Discard changes, retry","Failure keeps the exact draft; discard restores saved settings; deliberate retry saves."],
  ["scoped-draft","Edit a notification, then save the temperature policy","Unrelated notification draft survives and remains unsaved."],
  ["picker-retention","Search, scroll, select, Done","Selection keeps list scroll, checkbox focus and search query; area context identifies equipment."],
  ["responsive-themes","320px, 390px and desktop; light and dark","Editor, controls and long picker rows fit within the available width."],
];
const freshReceipt=()=>({schema_version:1,started_at:new Date().toISOString(),environment:{fixture:"temperature-policy-editor.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",data:"synthetic",saves:"mocked",backend_validation:"not exercised",physical_safari:"untested"},results:cases.map(([id,controls,expected])=>({id,controls,expected,status:"untested",evidence:[]}))});
async function runPath(id,action){
  reset();const item=receipt.results.find(result=>result.id===id),before=saveCount();
  try{await action();check(saved.notifications===false,"Global notifications remain off");check(calls.every(request=>["homeostatic/configuration","homeostatic/save_settings"].includes(request.type)),"Only isolated settings requests occurred");item.status="pass";item.evidence.push(`Rendered controls and persisted-state assertions passed; ${saveCount()-before} mocked save request(s).`);}
  catch(error){item.status="fail";item.evidence.push(error.message);}
  finally{publish();}
}
const fit=()=>{const editor=find('.unified-policy-editor'),host=card.getBoundingClientRect();check(card.scrollWidth<=card.clientWidth+1&&editor.scrollWidth<=editor.clientWidth+1,"Editor has no horizontal overflow");for(const element of root.querySelectorAll('.unified-policy-editor input,.unified-policy-editor select,.unified-policy-editor button')){const box=element.getBoundingClientRect();if(box.width&&box.height)check(box.left>=host.left-1&&box.right<=host.right+1,"A visible editor control fits the card");}};
document.querySelector("#show").onclick=()=>{reset();feedback.textContent="Preview: below 60°F for 60 minutes, two selected sensors, monitoring enabled and global notifications off.";};
document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};
document.querySelector("#run").onclick=async()=>{
  const run=document.querySelector("#run"),originalWidth=card.style.width,originalTheme=document.documentElement.dataset.theme||"light";run.disabled=true;receipt=freshReceipt();publish();feedback.textContent="Running isolated temperature editor checks…";
  try {
    await runPath("initial-state",async()=>{check(find(bound("minimum")).value==="60"&&find(bound("maximum")).value==="","Saved bounds are displayed");check(duration().value==="60"&&duration().dataset.durationUnit==="minutes"&&durationUnit().value==="minutes","3600 seconds displays as 60 minutes");const enabled=find(field("enabled"));check(enabled.checked&&find("h1").closest("header").contains(enabled),"Monitoring switch belongs to the policy heading");check(!root.querySelector('[data-definition-action="save-scoped"]'),"Unchanged policy has no Save action");check(!find('[data-notifications-switch]').checked,"Global sending is visibly off");check(find("h1").textContent===savedPolicy().name,"Policy name is the heading");const rows=root.querySelectorAll(".policy-selected-sources li");check(rows.length===2&&rows[0].textContent.includes(sensors[0].name)&&rows[1].textContent.includes(sensors[1].name),"Each selected sensor has its own row");check(!root.textContent.includes("· Entities")&&!root.textContent.includes("What to watch"),"Equipment names exclude policy suffixes and redundant headings");check(find('[data-definition-action="pick"]').closest(".policy-watch-controls"),"Selection action stays beside Include");});
    await runPath("lower-only",async()=>{await change(bound("minimum"),"55");await change(bound("duration_seconds"),"30");await save();check(savedPolicy().parameters.minimum===55&&savedPolicy().parameters.maximum==null&&savedPolicy().parameters.duration_seconds===1800,"Lower-only settings persist");await reopen();check(find(bound("minimum")).value==="55"&&find(bound("maximum")).value===""&&duration().value==="30","Reopening shows saved lower-only settings");});
    await runPath("upper-only",async()=>{await change(bound("minimum"),"");await change(bound("maximum"),"80");await save();check(savedPolicy().parameters.minimum==null&&savedPolicy().parameters.maximum===80,"Upper-only settings persist");await reopen();check(find(bound("minimum")).value===""&&find(bound("maximum")).value==="80","Reopening shows the upper-only bound");});
    await runPath("both-bounds",async()=>{await change(bound("minimum"),"55");await change(bound("maximum"),"78");await save();check(savedPolicy().parameters.minimum===55&&savedPolicy().parameters.maximum===78,"Both bounds persist");});
    await runPath("missing-bounds",async()=>{await change(bound("minimum"),"");await save();check(saveCount()===0&&visibleError(),"Missing bounds show validation before a request");check(find(bound("minimum")).value===""&&find(bound("maximum")).value==="","Validation retains empty inputs");});
    await runPath("reversed-bounds",async()=>{await change(bound("minimum"),"80");await change(bound("maximum"),"60");await save();check(saveCount()===0&&visibleError(),"Reversed bounds show validation before a request");check(find(bound("minimum")).value==="80"&&find(bound("maximum")).value==="60","Validation retains reversed inputs");});
    await runPath("missing-sensors",async()=>{await pick();await click(selection("registry:temperature-01"));await click(selection("registry:temperature-02"));await finish();await save();check(saveCount()===0&&visibleError(),"An empty exact selection cannot save");});
    await runPath("duration-units",async()=>{const before=JSON.stringify(currentPolicy());await change(field("duration-unit:duration_seconds"),"hours");check(duration().value==="1"&&duration().dataset.durationUnit==="hours","60 minutes converts to one hour");check(JSON.stringify(currentPolicy())===before&&!root.querySelector('[data-definition-action="save-scoped"]'),"Changing only presentation units keeps the policy clean");await change(bound("duration_seconds"),"1.25");await save();check(savedPolicy().parameters.duration_seconds===4500,"1.25 hours saves exactly 4500 seconds");await change(field("duration-unit:duration_seconds"),"minutes");check(duration().value==="75"&&!root.querySelector('[data-definition-action="save-scoped"]'),"75-minute display preserves the exact saved duration");await change(bound("duration_seconds"),"0");await save();check(savedPolicy().parameters.duration_seconds===0,"Zero remains explicit immediate detection");});
    await runPath("enabled-state",async()=>{await change(field("enabled"),false);await save();check(savedPolicy().enabled===false,"Monitoring can be disabled");await reopen();check(!find(field("enabled")).checked,"Saved disabled state reopens");await change(field("enabled"),true);await save();check(savedPolicy().enabled===true&&!find('[data-notifications-switch]').checked,"Enabling monitoring leaves global sending off");});
    await runPath("save-and-discard",async()=>{const name=savedPolicy().name;await change(field("name"),"Pending temperature name");rejectSave=true;await save();check(savedPolicy().name===name&&currentPolicy().name==="Pending temperature name"&&root.textContent.includes("Synthetic save rejection"),"Rejected save keeps the exact draft and displays failure");await discard();check(find(field("name")).value===name&&!root.querySelector('[data-definition-action="save-scoped"]'),"Discard restores the saved policy");await change(field("name"),"Retried temperature name");rejectSave=true;await save();await save();check(savedPolicy().name==="Retried temperature name","Deliberate retry persists the draft");});
    await runPath("scoped-draft",async()=>{const original=saved.notification_definitions.profiles.morning.name;await click('[data-page="notifications"]');await click('[data-definition-action="edit"][data-definition-kind="profiles"][data-definition-id="morning"]');await change(field("name"),"Pending morning notification");await click('[data-page="policies"]');await click('[data-definition-action="edit"][data-definition-id="temperature"]');await change(bound("minimum"),"58");await save();check(savedPolicy().parameters.minimum===58,"Temperature policy saves");check(saved.notification_definitions.profiles.morning.name===original&&card.settingsDraft.notification_definitions.profiles.morning.name==="Pending morning notification","Unrelated notification draft stays pending");});
    await runPath("picker-retention",async()=>{await pick();await change('[data-definition-picker-search]',"temperature");check(root.querySelectorAll(field("selection")).length===50,"All 50 temperature sensors are searchable");const target=find(selection("registry:temperature-41")),list=find('.policy-picker-options');target.scrollIntoView({block:"center"});await tick();const top=list.scrollTop;check(top>0,"The list is scrolled below the first choices");target.focus({preventScroll:true});target.click();await tick();check(Math.abs(find('.policy-picker-options').scrollTop-top)<=1,"Selecting a sensor preserves list scroll");check(root.activeElement?.dataset.definitionValue==="registry:temperature-41","Focus stays on the selected sensor");check(find('[data-definition-picker-search]').value==="temperature","Selection preserves the search query");const row=find(selection("registry:temperature-41")).closest("label");check(row.textContent.includes("Utility room")&&row.textContent.includes("Ground floor")&&!/\bEntities\b/.test(row.textContent),"Area and floor identify the sensor without a generic entity suffix");await finish();check(currentPolicy().match.entity.includes("registry:temperature-41")&&saveCount()===0,"Done retains an unsaved selection");});
    await runPath("responsive-themes",async()=>{for(const theme of ["light","dark"]){document.documentElement.dataset.theme=theme;for(const width of [320,390,Math.min(1100,innerWidth)]){card.style.width=`${width}px`;await tick();fit();await pick();await tick();fit();const picker=find('.policy-picker');check(picker.scrollWidth<=picker.clientWidth+1,"Picker fits the selected width");for(const row of root.querySelectorAll('.policy-picker-choice'))check(row.scrollWidth<=row.clientWidth+1,"Sensor names wrap within their rows");await finish();}}});
  } finally {
    card.style.width=originalWidth;document.documentElement.dataset.theme=originalTheme;run.disabled=false;receipt.completed_at=new Date().toISOString();receipt.summary=Object.fromEntries(["pass","fail","untested"].map(status=>[status,receipt.results.filter(item=>item.status===status).length]));publish();reset();feedback.textContent=`${receipt.summary.pass} passed, ${receipt.summary.fail} failed, ${receipt.summary.untested} untested. The preview is restored; the receipt retains this run.`;
  }
};
receipt=freshReceipt();reset();publish();
