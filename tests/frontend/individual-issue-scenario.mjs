import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {individualIssueFixture,ISSUE_ID,CHECK_ID} from "./individual-issue-fixture.mjs";
import {ENTITY_ID} from "./source-details-fixture.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,calls=[];
const copy=value=>structuredClone(value);
let fixture=individualIssueFixture(),revision=0;
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
  const data=fixture.base.current.data,first=fixture.base.configuration.settings.monitoring_policies.at(-1);
  const policy={...copy(first),id:"second-temperature",name:"Second temperature policy",parameters:{...first.parameters,minimum:75}};
  fixture.base.configuration.settings.monitoring_policies.push(policy);
  const source={...copy(fixture.source),node_id:"temperature:second",monitoring_policy:policy.id,name:fixture.entity.name+" · "+policy.name};
  data.inventory.nodes.push(source);
  const reasons=fixture.episode.reasons.map(reason=>({...copy(reason),node_id:source.node_id,message:"Temperature 68 °F is below the minimum 75 °F.",evidence:{...reason.evidence,minimum:75}}));
  data.inventory.episodes.push({...copy(fixture.episode),episode_id:"second-temperature-issue",anchor:source.node_id,recorded:[source.node_id],reasons});
  data.inventory.entity_status[source.node_id]={current:{status:"warn",reason:"temperature_low"},findings:copy(reasons)};
  card.configuration=copy(fixture.base.configuration);card.settingsDraft=copy(card.configuration.settings);publish();
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
  if(request.type==="homeostatic/configuration")return copy(fixture.base.configuration);
  if(request.type==="homeostatic/node")return nodeResult(request.node_id);
  if(request.type==="homeostatic/source")return {...copy(fixture.base.sourceDetail),nodeId:request.node_id,updated_at:data.updated_at};
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
Object.assign(card,{current:fixture.base.current,configuration:copy(fixture.base.configuration),settingsDraft:copy(fixture.base.configuration.settings),page:"problems",sourcesGrouping:"integration",sourcesExpanded:new Set(fixture.base.sourcesExpanded)});
card.render();
const close=async()=>{if(card.tools.dialog.open)await click('[data-tool="close"]',card.tools.dialog);if(card.dialog.open)await click('[data-action="close"]',card.dialog);};
async function open(id=ISSUE_ID) {
  await close();await click('.nav [data-page="problems"]');
  for(const toggle of [...root.querySelectorAll('[data-issue-group][aria-expanded="false"]')])await click(`[data-issue-group="${toggle.dataset.issueGroup}"]`);
  await click(`[data-episode="${id}"]`);check(card.dialog.open,"Issue opens from its rendered row");
}
const endTime=()=>{const time=new Date(Date.now()+3600000);time.setMinutes(time.getMinutes()-time.getTimezoneOffset());return time.toISOString().slice(0,16);};
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
document.querySelector("#condition").onchange=event=>condition(event.target.value);
document.querySelector("#open").onclick=()=>open();
let openedEntity=null;card.addEventListener("hass-more-info",event=>{openedEntity=event.detail.entityId;});

async function run() {
  const button=document.querySelector("#run"),result=document.querySelector("#result"),evidence=[];
  button.disabled=true;
  const receipt={...emptyReceipt({fixture:"individual-issue.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",build:"working tree",transport:"synthetic inventory and mocked services",physical_safari:"untested"}),status:"running",evidence};
  try {
    await close();fixture=individualIssueFixture();card.configuration=copy(fixture.base.configuration);card.settingsDraft=copy(card.configuration.settings);calls.length=0;publish();await settle();await open();
    const settings=JSON.stringify(card.configuration.settings);
    check(find("#detail-title").textContent===fixture.entity.name,"Title names only the actual entity");
    check(find("#detail-label").hidden,"Redundant Open issue eyebrow is hidden");
    check(body().innerText.includes("Temperature below minimum")&&body().innerText.includes("68 °F")&&body().innerText.includes("80 °F"),"Issue leads with measured temperature and violated bound");
    check(!/Limited in Home Assistant|Check the current state/.test(body().innerText),"Vague instructions are absent");
    const details=find('[data-disclosure="issue-details"]');
    check(!details.open&&details.querySelector('[data-entity]')&&details.querySelector('[data-source-link]'),"Optional destinations start under collapsed Details");
    check(!find('[data-acknowledge]').closest("details")&&!find('[data-shelf]').closest("details"),"Acknowledge and Pause are immediately visible");
    check(!find('[data-definition-action="open-policy"]').closest("details"),"Editing the policy remains directly available");
    check(mutations().length===0,"Opening the issue never mutates settings or controls");
    evidence.push("Actual source title; measured condition first; Acknowledge, Pause and policy link visible; optional destinations collapsed; no mutation on opening.");
    await click('[data-disclosure="issue-details"] > summary');check(body().innerText.includes("Required duration")&&body().innerText.includes("1 hour")&&!body().innerText.includes("Alert after"),"Duration describes qualification without promising notification timing");condition("high");await settle();
    check(find('[data-disclosure="issue-details"]').open,"Details stays open when captured evidence changes");
    check(body().innerText.includes("Temperature above maximum")&&body().innerText.includes("86 °F"),"High reading replaces the previous low condition");
    condition("missing");await settle();
    check(body().innerText.includes("Waiting for a temperature reading")&&!/68 °F|86 °F|back within limits/i.test(body().innerText),"Evidence gap shows no stale measurement or recovery");
    condition("recovered");await settle();check(body().innerText.includes("Temperature back within limits"),"Usable recovery evidence is described truthfully");
    condition("stalled");await settle();check(body().innerText.includes("not reaching the target")&&body().innerText.includes("72 °F"),"Stalled thermostat describes its actual target");
    condition("worsening");await settle();check(body().innerText.includes("moving away from the target")&&body().innerText.includes("66 °F"),"Worsening thermostat describes its current reading");
    condition("low");await settle();
    evidence.push("Captured low, high, missing reading, recovery, thermostat stalled and worsening refresh in place; Details expansion survives.");
    openedEntity=null;await click('[data-entity]',body());check(openedEntity===fixture.entity.entity_id,"Home Assistant detail uses the actual entity ID");
    await open();await click('[data-disclosure="issue-details"] > summary');await click('[data-source-link]',body());
    check(card.page==="sources"&&card.sourcesSelection==="source:"+ENTITY_ID,"Monitoring opens the canonical sensor");
    await open();await click('[data-definition-action="open-policy"]',body());
    check(card.page==="policies"&&card.definitionSelection.id==="home-temperature","Policy link opens the policy that owns this issue");
    await click('[data-workspace-return]');check(card.dialog.open&&card.detail.episodeId===ISSUE_ID,"Back returns to the same issue");
    check(JSON.stringify(card.configuration.settings)===settings&&mutations().length===0,"Optional navigation leaves saved policy settings unchanged");
    secondCheck();await settle();await open("second-temperature-issue");
    check(find('[data-definition-action="open-policy"]',body()).dataset.definitionId==="second-temperature"&&body().innerText.includes("75 °F"),"Overlapping check preserves its own policy and evidence");
    await click('[data-definition-action="open-policy"]',body());check(card.definitionSelection.id==="second-temperature","Second check edits its own policy");
    await click('[data-workspace-return]');check(card.detail.episodeId==="second-temperature-issue","Back retains the second issue identity");
    evidence.push("Actual Home Assistant entity, canonical Monitoring destination, policy editor and Back, and independent overlapping check identity remain reachable.");
    await open();await click('[data-acknowledge]');await click('[data-tool="close"]',card.tools.dialog);
    check(mutations().length===0,"Cancelling acknowledgment sends no mutation");
    await open();await click('[data-acknowledge]');await click('[type="submit"]',card.tools.body);
    check(mutations().length===1&&mutations()[0].service_data.episode_id===ISSUE_ID,"Acknowledgment targets only the selected issue");
    await open();check(body().innerText.includes("Acknowledged")&&!body().querySelector('[data-acknowledge]'),"Confirmed acknowledgment is visible on reopening");
    await click('[data-shelf]');check(find('[type="submit"]',card.tools.body).disabled,"Pause requires an end time");
    await click('[data-tool="close"]',card.tools.dialog);check(mutations().length===1,"Cancelling Pause changes nothing");
    await open();await click('[data-shelf]');await input('[name="untilLocal"]',endTime(),card.tools.body);await click('[type="submit"]',card.tools.body);
    check(mutations().length===2&&mutations().at(-1).service_data.episode_id===ISSUE_ID,"Saved pause targets only the selected issue");
    await open();const pause=fixture.base.current.data.inventory.operator_controls[0],expiry=new Date(pause.until).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});check(find(".problem-controls .active-controls",body()).innerText.includes("Notifications paused")&&body().innerText.includes("Until "+expiry)&&pause.until===mutations().at(-1).service_data.until,"Saved pause expiry remains visible");
    await click('[data-cancel-control]');await click('[data-tool="close"]',card.tools.dialog);check(mutations().length===2,"Cancelling resume preserves the pause");
    await open();await click('[data-cancel-control]');await click('[type="submit"]',card.tools.body);
    check(mutations().length===3&&fixture.base.current.data.inventory.operator_controls.length===0,"Confirming resume ends the selected pause");
    await open();check(!body().querySelector('[data-cancel-control]'),"Reopened issue confirms notifications are resumed");
    check(fixture.base.current.data.policy.episodes.length===1&&fixture.base.current.data.inventory.episodes.length===2,"Attention changes preserve both issues and affect one acknowledgment");
    check(!calls.some(request=>request.type==="homeostatic/save_settings"),"Attention controls never change monitoring policies");
    const bounds=card.dialog.getBoundingClientRect();check(bounds.left>=0&&bounds.right<=innerWidth+1&&body().scrollWidth<=body().clientWidth+1,"Issue dialog fits the current viewport without horizontal overflow");
    evidence.push("Acknowledgment cancel/confirm, Pause invalid/cancel/save and Resume cancel/confirm through rendered controls; selected issue only; persisted mocked controls verified on reopening; no policy saves; no horizontal overflow.");
    receipt.status="pass";result.textContent="Individual issue checks passed";
  } catch(error) {receipt.status="fail";receipt.error=error.message;result.textContent="Failed: "+error.message;}
  recordResult(receipt,"issues.individual",receipt.status,receipt.error||evidence.join(" "));
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"individual-issue.html",receipt},location.origin);button.disabled=false;
}
document.querySelector("#run").onclick=run;
