import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel-v36"),root=card.shadowRoot,calls=[];
const copy=value=>structuredClone(value),families={esphome:"ESPHome",mqtt:"MQTT",eero:"eero"};
const settings={...notificationSettings(),monitoring_policies:[
  {id:"devices",name:"Device availability",enabled:true,check:"availability",match:{kind:["device"]},parameters:{},notifications:[]},
  {id:"entities",name:"Entity availability",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[]},
]};
const configuration=()=>({revision:"device-issues-fixture",settings:copy(settings),delivery_targets:[],notification_people:[],monitoring_policy_templates:[],areas:[],labels:[],floors:[]});
let data;
function inventory() {
  const value=monitoringExample(),canonical=[],checks=[],episodes=[],status={};
  const addIssue=(source,id,policy)=>{
    const check={...source,node_id:`check:${id}`,name:`${source.name} · ${policy.name}`,monitoring_source:source.node_id,monitoring_policy:policy.id,check_id:"availability",watched:true};
    const current={status:"fail",reason:source.kind==="device"?"all_unavailable":"unavailable",message:source.kind==="device"?"All selected entities are unavailable.":"Home Assistant reports this entity unavailable.",observed_at:"2026-10-15T18:00:00Z"};
    const finding={...current,node_id:check.node_id,check_id:"availability"};
    checks.push(check);status[check.node_id]={current,findings:[finding]};
    episodes.push({episode_id:id,anchor:check.node_id,recorded:[check.node_id],impact:[],importance:"normal",opened_at:new Date(Date.UTC(2026,9,15,12,episodes.length)).toISOString(),reasons:[finding]});
    return check;
  };
  for(const [id,name] of Object.entries(families))canonical.push(baseSource(`entry:${id}`,name,"integration",{entry_id:id,attributes:{domain:[id]}}));
  const addDevice=(id,name,owner,readings,deviceCheck=true)=>{
    const device=baseSource(`device:${id}`,name,"device",{owner_id:owner,attributes:{device:[id],integration:[owner]}});
    const entities=readings.map(([suffix,label,domain="sensor"])=>baseSource(`entity:${id}-${suffix}`,label,"entity",{entity_id:`${domain}.${id.replaceAll("-","_")}_${suffix}`,owner_id:owner,attributes:{device:[id],integration:[owner],domain:[domain]}}));
    canonical.push(device,...entities);
    if(deviceCheck)addIssue({...device,availability_entities:entities.map(entity=>entity.entity_id)},`${id}-device`,settings.monitoring_policies[0]);
    entities.forEach((entity,index)=>addIssue(entity,`${id}-${readings[index][0]}`,settings.monitoring_policies[1]));
  };
  addDevice("ball","Xiaozhi Ball","esphome",[["player","Xiaozhi Ball","media_player"]]);
  addDevice("laundry","Laundry Sensor","mqtt",[["temperature","Temperature"],["humidity","Humidity"]]);
  addDevice("twin-a","Window Sensor","mqtt",[["contact","Contact","binary_sensor"]],false);
  addDevice("twin-b","Window Sensor","mqtt",[["contact","Contact","binary_sensor"]],false);
  const standalone=baseSource("entity:standalone","Outdoor weather feed","entity",{entity_id:"sensor.outdoor_feed",owner_id:"mqtt",attributes:{integration:["mqtt"],domain:["sensor"]}});
  canonical.push(standalone);addIssue(standalone,"standalone",settings.monitoring_policies[1]);
  const sharedFindings=[status["check:twin-a-contact"].findings[0],status["check:twin-b-contact"].findings[0]];
  episodes.push({episode_id:"mqtt-shared",anchor:"entry:mqtt",recorded:["entry:mqtt",...sharedFindings.map(finding=>finding.node_id)],impact:[],importance:"normal",opened_at:"2026-10-15T11:00:00Z",reasons:sharedFindings});
  for(let index=0;index<45;index++)addDevice(`client-${index}`,`Client ${String(index).padStart(2,"0")}`,"eero",[["state","Connection"]],false);
  Object.assign(value,{schema_version:3,catalog_loaded:true,catalog_revision:"device-issues-catalog",updated_at:"2026-10-15T18:00:00Z",devices:canonical.filter(source=>source.kind==="device").map(source=>({id:source.attributes.device[0],name:source.name,config_entry_id:source.owner_id})),areas:[],floors:[]});
  Object.assign(value.inventory,{nodes:[...canonical,...checks],catalog:{candidates:canonical},episodes,entity_status:status,attention_controls_supported:true,integration_evidence:Object.fromEntries(Object.keys(families).map(id=>[`entry:${id}`,{current:{status:"pass",reason:"loaded"},last_failure:null}])),resolved_history:{started_at:"2026-10-15T00:00:00Z",retention:{max_episodes:100,max_age_days:30},episodes:[]}});
  return value;
}
const check=(condition,message)=>{if(!condition)throw Error(message);};
const find=(selector,scope=root)=>{const element=scope.querySelector(selector);check(element,`Missing ${selector}`);return element;};
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let index=0;index<8;index++)await frame();};
const click=async(selector,scope=root)=>{const element=find(selector,scope);check(!element.disabled&&element.getClientRects().length,"Reachable "+selector);element.scrollIntoView({block:"nearest"});element.click();await settle();};
const group=id=>find(`[data-issue-group="integration:${id}"]`).closest(".issue-group");
const ids=scope=>[...scope.querySelectorAll("[data-episode]")].map(element=>element.dataset.episode);
const search=async query=>{const input=find("[data-issue-search]");input.value=query;input.dispatchEvent(new Event("input",{bubbles:true}));await settle();};
const sort=async value=>{const select=find("[data-issue-sort]");select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));await settle();};
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:key=>Object.entries(families).find(([id])=>key===`component.${id}.title`)?.[1]||null,async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/node"){
    const source=data.inventory.nodes.find(item=>item.node_id===request.node_id);check(source,"Detail source is in the synthetic inventory");
    const status=data.inventory.entity_status[source.node_id];
    return {source:copy(source),readiness:{answer:"unknown",nodes:[]},explanation:{findings:copy(status?.findings||[]),nodes:[]},entity_status:copy(status),monitoring_policies:settings.monitoring_policies.filter(policy=>policy.id===source.monitoring_policy),device_evidence:null,device_availability:null,integration_evidence:data.inventory.integration_evidence[source.node_id]};
  }
  throw Error(`Forbidden isolated request: ${request.type}`);
}};
root.addEventListener("click",event=>{if(event.target.closest("a[href]"))event.preventDefault();});
function reset(expanded=true) {
  if(card.dialog.open)card.dialog.close();
  data=inventory();calls.length=0;
  card._hass.states=Object.fromEntries(data.inventory.catalog.candidates.filter(source=>source.entity_id).map(source=>[source.entity_id,{state:"unavailable",attributes:{}}]));
  Object.assign(card,{current:{status:"current",data},configuration:configuration(),settingsDraft:copy(settings),scopedConfiguration:null,page:"problems",detail:null,issueQuery:"",issueSort:"newest",issueGroupsExpanded:new Set(expanded?["integration:esphome","integration:mqtt"]:[]),issueGroupLimits:new Map(),availabilityNotice:null,availabilityError:null,availabilityContext:null,issueAvailabilityPlan:null,issueAvailabilityEpisode:null});
  initializeScopedConfiguration(card);card.render();
}
document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};
document.querySelector("#reset").onclick=()=>{reset();document.querySelector("#feedback").textContent="Synthetic examples restored. No saved settings changed.";};
document.querySelector("#run").onclick=async()=>{
  const button=document.querySelector("#run"),feedback=document.querySelector("#feedback"),evidence=[];button.disabled=true;
  const receipt={...emptyReceipt({fixture:"device-issues.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",build:"working tree",transport:"synthetic inventory; no live services",physical_safari:"untested"}),status:"running",evidence};
  try {
    reset(false);await settle();
    check(root.querySelectorAll(".issue-group").length===3&&!root.querySelector("[data-episode]"),"Integration groups start collapsed");
    check(!card.main.querySelector("[data-issue-availability],.issue-availability,.issue-monitoring-feedback"),"Collapsed queue has no removal controls, counts or review");
    await click('[data-issue-group="integration:esphome"]');await click('[data-issue-group="integration:mqtt"]');
    check(!card.main.querySelector("[data-issue-availability],.issue-availability,.issue-monitoring-feedback"),"Expanded queue has no removal controls, counts or review");
    const ball=find('[data-issue-device="ball"]');
    check(ball.querySelectorAll(".issue-device-title").length===1&&ball.querySelector("h3").textContent==="Xiaozhi Ball","Ball has one device heading");
    check(ids(ball).sort().join(",")==="ball-device,ball-player","Device and player findings remain individually reachable");
    check([...ball.querySelectorAll(".issue-title")].every(title=>!title.textContent.includes("Xiaozhi Ball")),"Device name is not repeated as each finding title");
    check(root.querySelectorAll('[data-issue-device="twin-a"],[data-issue-device="twin-b"]').length===2,"Equal names retain distinct registry devices");
    check(!find('[data-episode="standalone"]').closest(".issue-device")&&!find('[data-episode="mqtt-shared"]').closest(".issue-device"),"Standalone and shared findings stay at integration level");
    check(root.querySelectorAll('[data-episode="mqtt-shared"]').length===1,"Shared issue appears once");
    check(ball.getBoundingClientRect().left>group("esphome").getBoundingClientRect().left,"Device is visually indented beneath its integration");
    evidence.push("Three integration families; single device heading; independent findings; equal names, standalone and shared issue identities.");
    const row=find('[data-episode="ball-player"]');row.focus();check(root.activeElement===row&&row.tagName==="BUTTON","Individual finding is a focusable native button");
    await click('[data-episode="ball-player"]');
    check(card.dialog.open&&card.detail.episodeId==="ball-player","Individual finding opens its exact issue");
    check(find("[data-acknowledge]",card.dialog).dataset.acknowledge==="ball-player","Acknowledgment still targets only this issue");
    check(calls.some(request=>request.type==="homeostatic/node"&&request.node_id==="check:ball-player"),"Detail reads the original check");
    await click('[data-action="close"]',card.dialog);check(!card.dialog.open,"Issue detail closes");
    evidence.push("Focusable issue button, exact check query and acknowledgment identity, and detail close; no attention action invoked.");
    await search("Laundry Sensor");
    check(root.querySelectorAll(".issue-device").length===1&&ids(root).length===3,"Parent device search reveals every matching finding");
    await search("");await sort("name");
    check([...root.querySelectorAll("[data-issue-group]")].map(element=>element.dataset.issueGroup).join(",")==="integration:eero,integration:esphome,integration:mqtt","Name sort orders integration groups");
    await sort("oldest");check(ids(group("esphome")).join(",")==="ball-device,ball-player","Oldest order preserves device findings");
    await sort("newest");check(ids(group("esphome")).join(",")==="ball-player,ball-device","Newest order preserves device findings");
    await click('[data-issue-group="integration:eero"]');check(ids(group("eero")).length===40,"Initial large integration page is bounded");
    await click('[data-issue-more="integration:eero"]');check(ids(group("eero")).length===45&&new Set(ids(group("eero"))).size===45,"Show more reaches each exact issue once");
    data=copy(data);data.updated_at="2026-10-15T18:01:00Z";card.current={status:"current",data};card.render();await settle();
    check(find('[data-issue-group="integration:esphome"]').getAttribute("aria-expanded")==="true"&&root.querySelectorAll('[data-issue-device="ball"]').length===1,"Refresh retains expansion and a single heading");
    check(ids(group("eero")).length===45,"Refresh retains the expanded issue page");
    evidence.push("Parent-name search, three sort choices, 40-to-45 pagination and unchanged refresh retention.");
    for(const [episodeId,entityIds] of [
      ["ball-player",["media_player.ball_player"]],
      ["ball-device",["media_player.ball_player"]],
      ["laundry-temperature",["sensor.laundry_temperature"]],
      ["laundry-device",["sensor.laundry_temperature","sensor.laundry_humidity"]],
      ["mqtt-shared",["binary_sensor.twin_a_contact","binary_sensor.twin_b_contact"]],
      ["standalone",["sensor.outdoor_feed"]],
    ]) {
      await click('[data-episode="'+episodeId+'"]');
      check(card.dialog.open&&card.detail.episodeId===episodeId,"The rendered finding opens its original issue");
      check(find(".issue-availability",card.dialog).dataset.issueAvailabilityOwner===episodeId,"Removal belongs to this opened issue");
      await click('[data-issue-availability="remove"][data-issue-id="'+episodeId+'"]',card.dialog);
      const selected=card.issueAvailabilityPlan.sources.map(source=>source.entityId).sort();
      check(card.issueAvailabilityEpisode===episodeId&&selected.join(",")===entityIds.toSorted().join(","),"Review selects only the opened issue's current unavailable entities: "+episodeId);
      check(!find(".source-availability-confirm details",card.dialog).open,"Exact entity and policy details start collapsed");
      await click('[data-issue-availability="cancel"][data-issue-id="'+episodeId+'"]',card.dialog);
      check(!card.issueAvailabilityPlan&&card.dialog.open,"Cancel preserves the opened issue without a pending review");
      await click('[data-action="close"]',card.dialog);
    }
    await click('[data-episode="ball-player"]');
    await click('[data-issue-availability="remove"][data-issue-id="ball-player"]',card.dialog);
    await click('[data-action="close"]',card.dialog);
    check(!card.issueAvailabilityPlan&&!card.issueAvailabilityEpisode,"Closing the dialog discards its unsaved review");
    await click('[data-episode="laundry-temperature"]');
    check(!card.issueAvailabilityPlan&&!card.dialog.querySelector('[data-issue-availability="confirm"]'),"Another issue starts without the previous review");
    await click('[data-action="close"]',card.dialog);
    check(JSON.stringify(card.configuration.settings)===JSON.stringify(settings),"Browsing and cancellation leave saved monitoring unchanged");
    check(!card.main.querySelector("[data-issue-availability],.issue-availability,.issue-monitoring-feedback"),"The queue remains free of removal controls and feedback after closing");
    check(calls.every(request=>["homeostatic/node","homeostatic/configuration"].includes(request.type)),"Browsing and Cancel send no mutation or live-service request");
    check(find(".shell").scrollWidth<=find(".shell").clientWidth+1,"Current viewport has no horizontal overflow");
    evidence.push("No queue removal controls or counts. Actual entity, device, shared and standalone issue dialogs review only their own current unavailable entities; unrelated unavailable siblings are excluded. Cancel and Close discard review without mutations or live services; current viewport fits.");
    receipt.status="pass";feedback.textContent="PASS: Device hierarchy, original issue actions, search, sorting, pagination, refresh and Cancel. Synthetic data only.";
  }catch(error){receipt.status="fail";receipt.error=error.message;feedback.textContent=`FAIL: ${error.message}`;}
  recordResult(receipt,"issues.device-hierarchy",receipt.status,receipt.error||evidence.join(" "));
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);
  parent.postMessage({type:"homeostatic-acceptance",fixture:"device-issues.html",receipt},location.origin);button.disabled=false;
};
reset();
