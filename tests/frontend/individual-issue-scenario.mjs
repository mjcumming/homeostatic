import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {individualIssueFixture,ISSUE_ID,CHECK_ID} from "./individual-issue-fixture.mjs";
import {ENTITY_ID} from "./source-details-fixture.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,calls=[];
const copy=value=>structuredClone(value);
let fixture=individualIssueFixture(),revision=0,coverageFailure=false;
let holdReads=false,activeReads=0,maxActiveReads=0;
const heldReads=[];
const check=(value,message)=>{if(!value)throw Error(message);};
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let index=0;index<8;index++)await frame();};
const find=(selector,scope=root)=>{const target=scope.querySelector(selector);check(target,"Missing "+selector);return target;};
const click=async(selector,scope=root)=>{const target=find(selector,scope);check(!target.disabled&&target.getClientRects().length&&!target.closest("[inert]"),"Reachable "+selector);target.scrollIntoView({block:"nearest"});target.click();await settle();};
const input=async(selector,value,scope=root)=>{const target=find(selector,scope);target.value=value;target.dispatchEvent(new Event("input",{bubbles:true,composed:true}));await settle();};
const body=()=>find(".dialog-body");
const mutations=()=>calls.filter(request=>request.type==="call_service"||request.type==="homeostatic/save_settings");
function publish() {fixture.base.current.data.updated_at=new Date(Date.parse("2026-10-15T17:25:00Z")+ ++revision*1000).toISOString();card.current={status:"current",data:fixture.base.current.data};card.tools.update(card.current);card.render();if(card.detail)card.loadDetail();}
function condition(value) {
  const old=fixture;fixture=individualIssueFixture(value);
  fixture.base.current.data.inventory.operator_controls=old.base.current.data.inventory.operator_controls;
  fixture.base.current.data.policy.episodes=old.base.current.data.policy.episodes;
  document.querySelector("#condition").value=value;publish();
}
function secondCheck() {
  const data=fixture.base.current.data,first=fixture.base.editors.configuration.settings.monitoring_policies.at(-1);
  const policy={...copy(first),id:"second-temperature",name:"Second temperature policy",parameters:{...first.parameters,minimum:75}};
  fixture.base.editors.configuration.settings.monitoring_policies.push(policy);
  fixture.base.sourceDetail.monitoring_policies.push({id:policy.id,name:policy.name});
  const source={...copy(fixture.source),node_id:"temperature:second",monitoring_policy:policy.id,name:fixture.entity.name+" · "+policy.name};
  data.inventory.nodes=[...data.inventory.nodes,source];
  const reasons=fixture.episode.reasons.map(reason=>({...copy(reason),node_id:source.node_id,message:"Temperature 68 °F is below the minimum 75 °F.",evidence:{...reason.evidence,minimum:75}}));
  data.inventory.episodes.push({...copy(fixture.episode),episode_id:"second-temperature-issue",anchor:source.node_id,recorded:[source.node_id],reasons});
  data.inventory.entity_status[source.node_id]={current:copy(reasons[0]),findings:copy(reasons)};
  card.editors.configuration=copy(fixture.base.editors.configuration);card.editors.settingsDraft=copy(card.editors.configuration.settings);publish();
}
function nodeResult(id) {
  const result=copy(fixture.result);
  if(id!==CHECK_ID) {
    result.source=copy(fixture.base.current.data.inventory.nodes.find(source=>source.node_id===id));
    result.monitoring_policies=[{id:"second-temperature",name:"Second temperature policy"}];
    result.temperature_status.observation.message="Temperature 68 °F is below the minimum 75 °F.";
    result.temperature_status.observation.evidence.minimum=75;
    result.entity_status=copy(fixture.base.current.data.inventory.entity_status[id]);result.explanation.findings=copy(result.entity_status.findings);
  }
  return result;
}
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},localize:fixture.base._hass.localize,states:{[fixture.entity.entity_id]:{state:"68",attributes:{unit_of_measurement:"°F"}}},async callWS(request){
  calls.push(copy(request));
  const data=fixture.base.current.data;
  if(request.type==="homeostatic/configuration")return copy(fixture.base.editors.configuration);
  if(request.type==="homeostatic/node")return nodeResult(request.node_id);
  if(request.type==="homeostatic/source") {
    check([ENTITY_ID,"device:third-floor"].includes(request.node_id),"Coverage uses the selected canonical source");
    if(coverageFailure)throw Error("Synthetic entity coverage unavailable");
    return {...copy(fixture.base.sourceDetail),nodeId:request.node_id,updated_at:data.updated_at};
  }
  if(request.type!=="call_service")throw Error("Unexpected isolated request "+request.type);
  const payload=request.service_data;
  if(request.service==="acknowledge") {
    const acknowledgment={episode_id:payload.episode_id,at:"2026-10-15T17:26:00Z",actor_id:"fixture"};
    data.policy.episodes.push({episode_id:payload.episode_id,acknowledgment,require_acknowledgment:true});
    return {response:{acknowledgment}};
  }
  if(request.service==="shelve") {
    const control={control_id:"fixture-pause",action:"shelve",target:payload.episode_id,until:payload.until,reason:payload.reason};
    data.inventory.operator_controls.push(control);return {response:{control}};
  }
  if(request.service==="cancel_control") {
    data.inventory.operator_controls=data.inventory.operator_controls.filter(control=>control.control_id!==payload.control_id);
    return {response:{cancelled_control_id:payload.control_id}};
  }
  throw Error("Unexpected isolated service "+request.service);
}};
const callWS=card._hass.callWS;
card._hass.callWS=async request=>{
  if(!holdReads||!["homeostatic/node","homeostatic/source"].includes(request.type))return callWS(request);
  activeReads++;maxActiveReads=Math.max(maxActiveReads,activeReads);
  const response=await callWS(request);
  await new Promise(resolve=>heldReads.push(resolve));
  activeReads--;
  return response;
};
Object.assign(card,{current:fixture.base.current,editors:{configuration:copy(fixture.base.editors.configuration),settingsDraft:copy(fixture.base.editors.configuration.settings)},page:"problems",sourcesGrouping:"integration",sourcesExpanded:new Set(fixture.base.sourcesExpanded)});
card.render();
const close=async()=>{if(card.tools.dialog.open)await click('[data-tool="close"]',card.tools.dialog);if(card.dialog.open)await click('[data-action="close"]',card.dialog);};
async function open() {
  await close();await click('.nav [data-page="problems"]');
  for(const toggle of [...root.querySelectorAll('[data-issue-group][aria-expanded="false"]')])await click(`[data-issue-group="${toggle.dataset.issueGroup}"]`);
  await click('[data-device-issues="third-floor"]');check(card.dialog.open,"Device issues open from the rendered queue");
}
const endTime=()=>{const time=new Date(Date.now()+3600000);time.setMinutes(time.getMinutes()-time.getTimezoneOffset());return time.toISOString().slice(0,16);};
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
document.querySelector("#condition").onchange=event=>condition(event.target.value);
document.querySelector("#open").onclick=()=>open();
let openedEntity=null;card.addEventListener("hass-more-info",event=>{openedEntity=event.detail.entityId;});

async function run() {
  const button=document.querySelector("#run"),result=document.querySelector("#result"),evidence=[];
  button.disabled=true;
  const receipt={...emptyReceipt({fixture:"individual-issue.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",build:"working tree",transport:"synthetic inventory and mocked services"}),status:"running",evidence};
  try {
    await close();fixture=individualIssueFixture();card.editors.configuration=copy(fixture.base.editors.configuration);card.editors.settingsDraft=copy(fixture.base.editors.configuration.settings);calls.length=0;publish();await settle();await open();
    const settings=JSON.stringify(card.editors.configuration.settings);
    check(find("#detail-title").textContent==="3rd Floor Sensor","Title names the owning device");
    check(body().innerText.includes("Temperature below minimum")&&body().innerText.includes("68 °F")&&body().innerText.includes("80 °F"),"Device issue preserves measured temperature and violated bound");
    check(body().innerText.includes("Required duration")&&body().innerText.includes("1 hour"),"Qualification duration stays visible");
    check(body().querySelector('a[href="/config/devices/device/third-floor"]'),"Device navigation is directly available");
    check(!body().querySelector('[data-disclosure="issue-details"]'),"Current evidence has no extra disclosure");
    check(body().querySelector('[data-device-response="acknowledge"]')&&body().querySelector('[data-device-response="pause"]'),"One current issue has direct response actions");
    check(!body().querySelector('[data-device-issue-select]'),"Single issue needs no selection controls");
    condition("high");await settle();check(body().innerText.includes("86 °F")&&body().innerText.includes("Temperature above maximum"),"Current high reading replaces low evidence");
    condition("missing");await settle();check(body().innerText.includes("Waiting for a temperature reading")&&!/68 °F|86 °F/.test(body().innerText),"Missing temperature evidence shows no stale measurement");
    condition("low");await settle();
    await click('[data-definition-action="open-policy"][data-definition-id="home-temperature"]',body());
    check(card.page==="policies"&&card.definitionSelection.id==="home-temperature","Policy link opens the exact editor");
    await input('[data-definition-field="name"]',"Temperature draft");
    await click('[data-workspace-return]');check(card.dialog.open&&card.detail.deviceId==="third-floor","Back restores the owning device issue dialog");
    check(JSON.stringify(card.editors.configuration.settings)===settings&&mutations().length===0,"Browsing preserves saved settings");
    check(card.editors.settingsDraft.monitoring_policies.find(policy=>policy.id==="home-temperature").name==="Temperature draft","Editor draft survives Back");
    const savedSettings=fixture.base.editors.configuration.settings;
    savedSettings.notification_definitions={profiles:{morning:{name:"Morning summary",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:[]}},methods:{}};
    savedSettings.monitoring_policies.find(policy=>policy.id==="devices").notifications=[{id:"morning-device",profile:"morning"}];
    savedSettings.monitoring_policies.find(policy=>policy.id==="entities").notifications=[{id:"morning-entity",profile:"morning"}];
    card.editors.configuration=copy(fixture.base.editors.configuration);card.editors.settingsDraft=copy(savedSettings);publish();await settle();await open();
    check(body().querySelectorAll('[data-definition-action="open-notification"][data-definition-id="morning"]').length===1,"Shared notification links are deduplicated across covering policies");
    check(body().innerText.includes("No delivery method selected")&&!body().innerText.includes("Notifications off"),"Issue-specific delivery gaps stay visible without repeating global sending status");
    await click('[data-definition-action="open-notification"][data-definition-id="morning"]',body());
    check(card.page==="notifications"&&card.definitionSelection.id==="morning","Notification link opens its exact saved editor");
    await input('[data-definition-field="name"]',"Morning draft");await click('[data-workspace-return]');
    check(card.dialog.open&&card.detail.deviceId==="third-floor","Notification Back returns to the same device issues");
    check(body().innerText.includes("Morning summary")&&!body().innerText.includes("Morning draft"),"Issue links retain saved notification names");
    await click('[data-definition-action="open-notification"][data-definition-id="morning"]',body());
    check(find('[data-definition-field="name"]').value==="Morning draft","Notification draft survives the round trip");
    await click('[data-workspace-return]');
    check(JSON.stringify(card.editors.configuration.settings)===JSON.stringify(savedSettings)&&mutations().length===0,"Notification browsing never saves drafts");
    secondCheck();await settle();await open();
    check(body().querySelectorAll('[data-device-issue-select]').length===2&&body().innerText.includes("75 °F")&&body().innerText.includes("80 °F"),"Independent overlapping policies keep both current findings");
    const extra=find('[data-device-issue-select="second-temperature-issue"]',body());extra.checked=false;extra.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    await click('[data-device-response="acknowledge"]',body());
    check(mutations().length===1&&mutations()[0].service_data.episode_id===ISSUE_ID,"Acknowledgment targets only the selected issue");
    await click('[data-device-response="pause"]',body());await click('[data-device-response="cancel-pause"]',body());check(mutations().length===1,"Cancel sends no pause");
    await click('[data-device-response="pause"]',body());await click('[data-device-response="apply-pause"]',body());
    check(mutations().length===2&&mutations()[1].service_data.episode_id===ISSUE_ID,"Pause targets only the selected issue");
    check(fixture.base.current.data.inventory.operator_controls.length===1&&fixture.base.current.data.policy.episodes.length===1,"Mocked saved controls retain their exact membership");
    check(!calls.some(request=>request.type==="homeostatic/save_settings"),"Issue responses never save policy drafts");
    const bounds=card.dialog.getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth+1&&body().scrollWidth<=body().clientWidth+1,"Dialog fits the current viewport");
    evidence.push("Rendered device queue entry; captured temperature and duration; current/missing evidence refresh; exact policy editor and preserved draft through Back; two independent findings; subset acknowledgment and pause, Cancel and mocked saved membership; no policy mutation or horizontal overflow.");
    receipt.status="pass";result.textContent="Individual issue checks passed";
  } catch(error) {receipt.status="fail";receipt.error=error.message;result.textContent="Failed: "+error.message;}
  recordResult(receipt,"issues.individual",receipt.status,receipt.error||evidence.join(" "));
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"individual-issue.html",receipt},location.origin);button.disabled=false;
}
document.querySelector("#run").onclick=run;
