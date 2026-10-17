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
  const data=fixture.base.current.data,first=fixture.base.configuration.settings.monitoring_policies.at(-1);
  const policy={...copy(first),id:"second-temperature",name:"Second temperature policy",parameters:{...first.parameters,minimum:75}};
  fixture.base.configuration.settings.monitoring_policies.push(policy);
  fixture.base.sourceDetail.monitoring_policies.push({id:policy.id,name:policy.name});
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
  if(request.type==="homeostatic/source") {
    check(request.node_id===ENTITY_ID,"Entity issue coverage is read from its canonical source");
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
    check(!body().querySelector('[data-disclosure="issue-details"]'),"Issue evidence has no Details expander");
    check(!body().innerText.includes("View in Monitoring"),"Issue has no circular generic Monitoring destination");
    const entityAction=find('[data-entity]',body()),deviceAction=find('a[href="/config/devices/device/third-floor"]',body());
    check(entityAction.textContent==="Open Entity"&&entityAction.classList.contains("primary"),"Open Entity is the primary action");
    check(deviceAction.textContent==="Open Device"&&deviceAction.classList.contains("button")&&!deviceAction.classList.contains("primary")&&entityAction.parentElement===deviceAction.parentElement,"Open Device is an adjacent outlined action");
    check(!find('[data-acknowledge]').closest("details")&&!find('[data-shelf]').closest("details"),"Acknowledge and Pause are immediately visible");
    check(!find('[data-definition-action="open-policy"]').closest("details"),"Editing the policy remains directly available");
    check(mutations().length===0,"Opening the issue never mutates settings or controls");
    check([...body().querySelectorAll('.issue-policy-links [data-definition-action="open-policy"]')].map(button=>button.dataset.definitionId).sort().join(",")==="devices,entities,home-temperature","Policies lists every policy covering the entity, including device availability");
    check(find('.issue-policy-links',body()).innerText.includes("Policies:")&&find('.issue-notification-links',body()).innerText.includes("None assigned"),"Configuration headings and empty notification assignments are explicit");
    coverageFailure=true;publish();await settle();
    check(body().innerText.includes("Policy and notification coverage is unavailable")&&!body().innerText.includes("None assigned"),"Unavailable coverage is distinct from no assignments");
    coverageFailure=false;await click('[data-action="retry-issue-configuration"]',body());
    check(find('.issue-notification-links',body()).innerText.includes("None assigned"),"Retry restores saved coverage without a mutation");
    evidence.push("Actual source title; flat measured condition; adjacent Open Entity and Open Device; Acknowledge and Pause; all covering policies; no generic Monitoring route or mutation.");
    check(body().innerText.includes("Required duration")&&body().innerText.includes("1 hour")&&!body().innerText.includes("Alert after"),"Duration describes qualification without promising notification timing");condition("high");await settle();
    check(!body().querySelector('[data-disclosure="issue-details"]'),"Evidence refresh keeps the flat layout");
    check(body().innerText.includes("Temperature above maximum")&&body().innerText.includes("86 °F"),"High reading replaces the previous low condition");
    condition("missing");await settle();
    check(body().innerText.includes("Waiting for a temperature reading")&&!/68 °F|86 °F|back within limits/i.test(body().innerText),"Evidence gap shows no stale measurement or recovery");
    condition("recovered");await settle();check(body().innerText.includes("Temperature back within limits"),"Usable recovery evidence is described truthfully");
    condition("stalled");await settle();check(body().innerText.includes("not reaching the target")&&body().innerText.includes("72 °F"),"Stalled thermostat describes its actual target");
    condition("worsening");await settle();check(body().innerText.includes("moving away from the target")&&body().innerText.includes("66 °F"),"Worsening thermostat describes its current reading");
    condition("low");await settle();
    evidence.push("Captured low, high, missing reading, recovery, thermostat stalled and worsening refresh in place with immediately visible duration.");
    const readsBefore=calls.filter(request=>request.type==="homeostatic/node").length;
    holdReads=true;maxActiveReads=0;publish();await settle();
    for(let index=0;index<5;index++)condition(index%2?"low":"high");
    await settle();
    check(heldReads.length===1&&maxActiveReads===1,"A burst keeps one issue read in flight");
    for(let index=0;index<4;index++){check(heldReads.length===1,"Only the next sequential read is pending");heldReads.shift()();await settle();}
    holdReads=false;
    check(activeReads===0&&heldReads.length===0&&maxActiveReads===1,"Issue evidence and coverage reads remain serialized");
    check(calls.filter(request=>request.type==="homeostatic/node").length===readsBefore+2,"A burst creates exactly one follow-up issue read");
    check(body().innerText.includes("Temperature above maximum")&&body().innerText.includes("86 °F"),"The final burst reading reaches the open dialog");
    condition("low");await settle();
    evidence.push("Delayed issue reads coalesce five updates into one follow-up, never overlap evidence/coverage requests, and display the latest measurement.");
    openedEntity=null;await click('[data-entity]',body());check(openedEntity===fixture.entity.entity_id,"Home Assistant detail uses the actual entity ID");
    await open();await click('[data-definition-action="open-policy"][data-definition-id="home-temperature"]',body());
    check(card.page==="policies"&&card.definitionSelection.id==="home-temperature","Policy link opens the policy that owns this issue");
    await click('[data-workspace-return]');check(card.dialog.open&&card.detail.episodeId===ISSUE_ID,"Back returns to the same issue");
    check(JSON.stringify(card.configuration.settings)===settings&&mutations().length===0,"Optional navigation leaves saved policy settings unchanged");
    secondCheck();await settle();await open("second-temperature-issue");
    check(body().querySelector('[data-definition-action="open-policy"][data-definition-id="second-temperature"]')&&body().innerText.includes("75 °F"),"Overlapping check preserves its own policy and evidence");
    await click('[data-definition-action="open-policy"][data-definition-id="second-temperature"]',body());check(card.definitionSelection.id==="second-temperature","Second check edits its own policy");
    await click('[data-workspace-return]');check(card.detail.episodeId==="second-temperature-issue","Back retains the second issue identity");
    evidence.push("Actual Home Assistant entity, exact policy editor and Back, and independent overlapping check identity remain reachable.");
    const savedSettings=fixture.base.configuration.settings;
    savedSettings.notification_definitions={profiles:{morning:{name:"Morning summary",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:[]},immediate:{name:"Immediate",timing:{mode:"immediate"},methods:["empty-fixed"]}},methods:{"empty-fixed":{name:"Unconfigured method",mode:"fixed",destinations:[]}}};
    savedSettings.monitoring_policies.find(policy=>policy.id==="devices").notifications=[{id:"morning-device",profile:"morning"}];
    savedSettings.monitoring_policies.find(policy=>policy.id==="entities").notifications=[{id:"morning-entity",profile:"morning"},{id:"immediate-entity",profile:"immediate"}];
    savedSettings.monitoring_policies.find(policy=>policy.id==="home-temperature").notifications=[{id:"custom-temperature",timing:{mode:"immediate"},methods:[]}];
    card.configuration=copy(fixture.base.configuration);card.settingsDraft=copy(savedSettings);publish();await settle();await open();
    const notificationSection=find('.issue-notification-links',body());
    check(notificationSection.innerText.includes("Notifications:")&&notificationSection.innerText.includes("Notifications off"),"Notifications heading preserves global sending-off status");
    check(notificationSection.innerText.includes("No delivery method selected"),"Named notification without destinations is explicitly unconfigured");
    check(notificationSection.innerText.includes("Delivery method needs destinations"),"Fixed method with no destination remains explicitly unconfigured");
    check([...notificationSection.querySelectorAll('[data-definition-action="open-notification"]')].map(button=>button.dataset.definitionId).sort().join(",")==="immediate,morning","Named notifications cover all entity policies and are deduplicated");
    check([...notificationSection.querySelectorAll('[data-definition-action="open-notification"]')].every(button=>button.classList.contains("button")&&button.dataset.definitionKind==="profiles"),"Named notifications use outlined buttons with exact profile identities");
    await click('.issue-notification-links [data-definition-action="open-notification"][data-definition-id="morning"]',body());
    check(card.page==="notifications"&&card.definitionSelection.id==="morning"&&card.definitionSelection.kind==="profiles","Named notification opens its editor");
    await input('[data-definition-field="name"]',"Morning draft");
    await click('[data-workspace-return]');check(card.dialog.open&&card.detail.episodeId===ISSUE_ID,"Notification Back returns to the exact issue with its draft retained");
    check(find('.issue-notification-links',body()).innerText.includes("Morning summary")&&!find('.issue-notification-links',body()).innerText.includes("Morning draft"),"Issue links describe saved coverage while the editor draft is unsaved");
    await click('.issue-notification-links [data-definition-action="open-policy"][data-definition-id="home-temperature"]',body());
    check(card.page==="policies"&&card.definitionSelection.id==="home-temperature","Custom notification opens its owning policy");
    await input('[data-definition-field="name"]',"Temperature draft");
    await click('[data-workspace-return]');
    await click('.issue-notification-links [data-definition-action="open-notification"][data-definition-id="morning"]',body());
    check(find('[data-definition-field="name"]').value==="Morning draft","Independent notification draft survives policy navigation");
    await click('[data-workspace-return]');
    check(card.settingsDraft.monitoring_policies.find(policy=>policy.id==="home-temperature").name==="Temperature draft"&&JSON.stringify(card.configuration.settings)===JSON.stringify(savedSettings)&&mutations().length===0,"Policy and notification drafts survive Back without a save");
    const sourceAttributes=copy(fixture.source.attributes),entityAttributes=copy(fixture.entity.attributes);
    delete fixture.source.attributes.device;delete fixture.entity.attributes.device;publish();await settle();
    check(!body().querySelector('a[href^="/config/devices/device/"]')&&body().querySelector('[data-entity]'),"Entity without a device keeps Open Entity and omits Open Device");
    fixture.source.attributes=sourceAttributes;fixture.entity.attributes=entityAttributes;publish();await settle();
    evidence.push("All entity policy notification assignments, named-profile deduplication, global-off and no-assignment states, Custom notification policy route, editor Back, independent draft preservation and entity without device verified without saves.");
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
