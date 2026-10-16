import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";

const card=document.querySelector("homeostatic-panel-v42"),root=card.shadowRoot,feedback=document.querySelector("#feedback");
const copy=value=>structuredClone(value),calls=[];
const initial={...notificationSettings(),monitoring_policies:[{id:"entities",name:"Entities",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[]}]};
const families=[["mqtt","MQTT",4],["esphome","ESPHome",2],["home_connect","Home Connect",1]];
const entries=families.map(([id,name])=>baseSource(`entry:${id}`,name,"integration",{entry_id:id,attributes:{domain:[id]}}));
const sources=families.flatMap(([id,name,count])=>Array.from({length:count},(_,index)=>baseSource(`entity:${id}-${index}`,`${name} ${index===0?"Kitchen":index===1?"Back porch":`Reading ${index+1}`}`,"entity",{entity_id:`sensor.${id}_${index}`,owner_id:id,attributes:{integration:[id],device:[`${id}-${index}`]}})));
const checks=sources.map(source=>({...source,node_id:`check:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:"entities",watched:true,check_id:"availability"}));
const episodes=checks.map((check,index)=>({episode_id:`issue:${check.node_id}`,anchor:check.node_id,recorded:[check.node_id],impact:[],importance:"normal",reasons:[{node_id:check.node_id,status:"warn",reason:"unavailable",message:"Home Assistant reports this entity unavailable.",check_id:"availability"}],opened_at:`2026-10-15T11:0${8-index}:00Z`}));
const originalHistory={episode:{...episodes[0],episode_id:"older-issue",opened_at:"2026-10-14T23:00:00Z"},source:{node_id:sources[0].node_id,name:"Kitchen sensor",kind:"entity"},resolution:"cleared",resolved_at:"2026-10-15T10:00:00Z"};
let saved,revision;
const configuration=()=>({revision:String(revision),settings:copy(saved),delivery_targets:[],notification_people:[],monitoring_policy_templates:[],areas:[],labels:[],floors:[]});
function inventory() {
  const data=monitoringExample(),excluded=new Set(saved.monitoring_policies[0].excluded_sources||[]),active=checks.filter(check=>!excluded.has(check.monitoring_source));
  Object.assign(data,{schema_version:3,catalog_loaded:true,catalog_revision:"fixture-catalog",updated_at:"2026-10-15T11:10:00Z",devices:sources.map(source=>({id:source.attributes.device[0],name:source.name,config_entry_id:source.owner_id}))});
  data.inventory={...data.inventory,nodes:[...entries,...sources,...active],catalog:{candidates:[...entries,...sources]},episodes:episodes.filter(episode=>active.some(check=>check.node_id===episode.anchor)),entity_status:Object.fromEntries(active.map(check=>[check.node_id,{current:{status:"warn",reason:"unavailable"}}])),resolved_history:{started_at:"2026-10-14T12:00:00Z",retention:{max_episodes:100,max_age_days:30},episodes:[copy(originalHistory),...episodes.filter(episode=>!active.some(check=>check.node_id===episode.anchor)).map(episode=>({episode:copy(episode),source:copy(sources.find(source=>`check:${source.node_id}`===episode.anchor)),resolution:"removed",resolved_at:"2026-10-15T11:10:00Z"}))]}};
  return data;
}
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:Object.fromEntries(sources.map(source=>[source.entity_id,{state:"unavailable",attributes:{}}])),localize:key=>families.find(([id])=>key===`component.${id}.title`)?.[1]||null,async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/node") {
    const data=inventory(),source=data.inventory.nodes.find(item=>item.node_id===request.node_id);
    if(!source)throw Error("Missing isolated issue source: "+request.node_id);
    const episode=data.inventory.episodes.find(item=>item.anchor===source.node_id);
    return {source:copy(source),entity_status:copy(data.inventory.entity_status[source.node_id]),explanation:{findings:copy(episode?.reasons||[]),nodes:[]},readiness:{answer:"unknown",nodes:[]},impact:{nodes:[]},monitoring_policies:saved.monitoring_policies.filter(policy=>policy.id===source.monitoring_policy),device_evidence:null,device_availability:null,integration_evidence:null};
  }
  if(request.type==="homeostatic/save_settings"){
    if(request.revision!==String(revision))throw Error("Simulated settings revision changed");
    saved=copy(request.settings);revision++;card.current={status:"current",data:inventory()};return {saved:true};
  }
  throw Error(`No live services: unexpected isolated request ${request.type}`);
}};
root.addEventListener("click",event=>{if(event.target.closest("a[href]"))event.preventDefault();});
const tick=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const check=(condition,message)=>{if(!condition)throw Error(message);};
const find=selector=>{const element=root.querySelector(selector);check(element,`Missing ${selector}`);return element;};
async function click(selector) {const element=find(selector);check(!element.disabled,`Disabled ${selector}`);element.click();await tick();}
async function settle() {for(let index=0;index<60;index++){await tick();if(!card.scopedBusy&&!card.settingsBusy&&!card.configBusy)return;}throw Error("Simulated save did not settle");}
function reset() {
  if(card.dialog.open)card.dialog.close();
  saved=copy(initial);revision=1;calls.length=0;
  Object.assign(card,{current:{status:"current",data:inventory()},configuration:configuration(),settingsDraft:copy(saved),scopedConfiguration:null,page:"problems",issueQuery:"",issueGroupsExpanded:new Set(),issueGroupLimits:new Map(),availabilityNotice:null,availabilityError:null,availabilityContext:null,issueAvailabilityPlan:null,issueAvailabilityEpisode:null,detail:null});
  initializeScopedConfiguration(card);card.render();
}
async function openReview() {
  await click('[data-issue-group="integration:mqtt"]');
  check(!card.main.querySelector('[data-issue-availability],.issue-availability,.issue-monitoring-feedback'),"Expanded queue has no removal control, count or review");
  await click('[data-episode="'+episodes[0].episode_id+'"]');
  check(card.dialog.open&&card.detail.episodeId===episodes[0].episode_id,"The actual finding opens its exact issue");
  await click('.dialog-body [data-issue-availability="remove"][data-issue-id="'+episodes[0].episode_id+'"]');
}
const themeColor=()=>{const sample=document.createElement("i");sample.style.backgroundColor=getComputedStyle(card).getPropertyValue("--primary-color").trim();sample.hidden=true;document.body.append(sample);const value=getComputedStyle(sample).backgroundColor;sample.remove();return value;};
document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};
document.querySelector("#reset").onclick=()=>{reset();feedback.textContent="Synthetic issues restored for visual inspection.";};
document.querySelector("#confirm").onclick=async()=>{reset();await openReview();feedback.textContent="Review the simulated policy change for this issue’s one unavailable entity.";};
document.querySelector("#run").onclick=async()=>{
  const evidence=[];feedback.textContent="Running isolated Issues checks…";
  const receipt={fixture:"issues-layout.html",viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",browser:navigator.userAgent,data:"synthetic",services:"forbidden",physical_safari:"untested",status:"running",evidence};
  try {
    reset();await tick();
    check(root.querySelectorAll('.header .nav [data-page="history"]').length===1&&!root.querySelector('main [data-page="history"]'),"History occurs once in primary navigation");
    check(root.querySelectorAll(".issue-group").length===3,"Three neutral investigation groups render");
    check(root.querySelector(".shell").scrollWidth<=root.querySelector(".shell").clientWidth+1,"Issue queue has no horizontal overflow");
    for(const header of root.querySelectorAll(".issue-group-toggle")){const bounds=header.getBoundingClientRect();check(bounds.width>=44&&bounds.height>=44,"Group disclosures have touch targets");}
    check(!card.main.querySelector("[data-issue-availability],.issue-availability,.issue-monitoring-feedback"),"Collapsed queue has no removal control, count or review");
    evidence.push("Primary History navigation, readable group counts, touch targets and no horizontal overflow.");
    await openReview();
    check(parseFloat(getComputedStyle(find(".dialog-body .source-availability-confirm .actions")).rowGap)>=8,"Issue confirmation actions have clear spacing");
    check(card.dialog.scrollWidth<=card.dialog.clientWidth+1,"Issue confirmation has no horizontal overflow");
    for(const button of card.dialog.querySelectorAll(".source-availability-confirm .button")){const bounds=button.getBoundingClientRect();check(bounds.width>=44&&bounds.height>=44,"Confirmation actions have touch targets");}
    check(card.issueAvailabilityEpisode===episodes[0].episode_id&&card.issueAvailabilityPlan.sourceIds.join(",")===sources[0].node_id,"The review contains only this issue’s entity");
    receipt.action_colors={theme:themeColor(),save:getComputedStyle(find('[data-issue-availability="confirm"]')).backgroundColor,cancel:getComputedStyle(find('[data-issue-availability="cancel"]')).backgroundColor};
    check(receipt.action_colors.save===receipt.action_colors.theme,"Save uses the theme primary action color");
    check(!find(".source-availability-confirm details").open,"Optional entity and policy detail is collapsed");
    await click('.dialog-body [data-issue-availability="cancel"]');check(calls.every(request=>request.type==="homeostatic/node")&&JSON.stringify(saved)===JSON.stringify(initial)&&card.dialog.open&&!card.issueAvailabilityPlan,"Cancel has no saved effects and keeps the issue open");
    await click('.dialog-body [data-issue-availability="remove"][data-issue-id="'+episodes[0].episode_id+'"]');await click('.dialog-body [data-issue-availability="confirm"]');await settle();
    check(calls.filter(call=>call.type==="homeostatic/save_settings").length===1,"Removal saves exactly once");
    check(saved.monitoring_policies[0].excluded_sources.join(",")===sources[0].node_id&&!card.dialog.open&&!card.detail&&!card.main.querySelector("[data-issue-availability],.issue-monitoring-feedback"),"Only this issue’s entity is excluded and the dialog closes quietly");
    check(card.main.querySelectorAll('[data-issue-group="integration:mqtt"]').length===1&&card.main.querySelectorAll("[data-episode]").length===3,"Other unavailable MQTT findings remain reachable");
    evidence.push("No queue removal controls. Exact opened issue review, spaced touch targets, no dialog overflow, accent Save, neutral Cancel with no write, and one simulated single-entity policy save that closes quietly while sibling findings remain.");
    await click('.header .nav [data-page="history"]');
    check(find("main h1").textContent==="History"&&!root.querySelector(".workspace-tabs"),"History is its own page without nested tabs");
    check(root.querySelector('.header .nav [data-page="history"][aria-current="page"]'),"History is the selected primary destination");
    check(root.textContent.includes("Kitchen sensor")&&root.textContent.includes("Monitoring ended"),"History retains cleared and removed outcomes");
    evidence.push("History opens as a separate selected primary page and keeps actual recorded outcomes.");
    check(calls.every(request=>["homeostatic/node","homeostatic/configuration","homeostatic/save_settings"].includes(request.type)),"No notification or live service calls");
    receipt.status="pass";feedback.textContent="PASS: Issues layout, scoped save and separate History navigation. Synthetic data only.";
  }catch(error){receipt.status="fail";receipt.error=error.message;feedback.textContent=`FAIL: ${error.message}`;}
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);
};
reset();
