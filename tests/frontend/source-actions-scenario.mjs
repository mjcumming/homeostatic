import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {initializeScopedConfiguration,rebaseScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs?v=85";
import {sourceDetailsFixture,DEVICE_ID,ENTITY_ID,UPDATED_AT} from "./source-details-fixture.mjs";
import {emptyReceipt,recordResult,receiptSummary} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,result=document.querySelector("#result");
const copy=value=>structuredClone(value),base=sourceDetailsFixture("device",["unavailable","unknown","off"]);
const candidates=base.current.data.inventory.catalog.candidates,entities=candidates.filter(item=>item.kind==="entity"),members=base.sourceDetail.members;
const initial={...base.configuration.settings,notifications:false,timings:{settle:30},consumer:null,
  notification_definitions:{methods:{phone:{name:"Phone",mode:"fixed",destinations:[]}},profiles:{}},
  monitoring_policies:[...base.configuration.settings.monitoring_policies,{id:"temperature",name:"Temperature",check:"temperature_limit",enabled:true,match:{kind:["entity"]},parameters:{},notifications:[]}]};
let saved,revision,calls,failNext,receipt,activePath,rejectPendingSave,withSibling=false;
const configuration=()=>({revision:String(revision),settings:copy(saved)});
const policy=id=>saved.monitoring_policies.find(item=>item.id===id);
const exclusion=(id,source)=>policy(id).excluded_sources?.includes(source);
const saves=()=>calls.filter(item=>item.type==="homeostatic/save_settings");
function inventory() {
  const data=copy(base.current.data),device=candidates.find(item=>item.node_id===DEVICE_ID);
  const selected=entities.filter(item=>!exclusion("devices",item.node_id));
  data.catalog_revision=String(revision);data.updated_at=UPDATED_AT;
  data.inventory.attention_controls_supported=true;
  data.inventory.nodes=[...copy(candidates),...entities.filter(item=>!exclusion("entities",item.node_id)).map(item=>({...item,node_id:`monitoring:entities:${item.node_id}`,monitoring_source:item.node_id,monitoring_policy:"entities",watched:true})),
    ...(selected.length?[{...device,node_id:`monitoring:devices:${DEVICE_ID}`,monitoring_source:DEVICE_ID,monitoring_policy:"devices",watched:true,availability_entities:selected.map(item=>item.entity_id)}]:[])];
  data.inventory.episodes=exclusion("entities",ENTITY_ID)?[]:[{episode_id:"shared",anchor:"entry:lyric",recorded:["entry:lyric",`monitoring:entities:${ENTITY_ID}`],reasons:[{node_id:`monitoring:entities:${ENTITY_ID}`,message:"Room temperature is unavailable",status:"warn",reason:"unavailable"}],opened_at:UPDATED_AT}];
  if(withSibling) {
    const source={...copy(entities[0]),node_id:"entity:unrelated",entity_id:"sensor.unrelated_reading",name:"Other unavailable reading"};
    const check={...source,node_id:"monitoring:entities:entity:unrelated",monitoring_source:source.node_id,monitoring_policy:"entities",watched:true};
    const finding={node_id:check.node_id,message:"Other reading is unavailable",status:"warn",reason:"unavailable"};
    data.inventory.catalog.candidates.push(source);data.inventory.nodes.push(source,check);
    data.inventory.entity_status={...data.inventory.entity_status,[check.node_id]:{current:finding}};
    data.inventory.episodes.push({episode_id:"unrelated",anchor:check.node_id,recorded:[check.node_id],reasons:[finding],opened_at:UPDATED_AT});
  }
  return data;
}
function detail(id) {
  const selected=id===DEVICE_ID?members.filter(item=>!exclusion("devices",item.node_id)):members.filter(item=>item.node_id===id);
  return {...copy(base.sourceDetail),nodeId:id,members:copy(selected),total:selected.length,
    unavailable_count:selected.filter(item=>item.state==="unavailable").length,unknown_count:0,
    device_availability:id===DEVICE_ID?{status:"available",basis:"entities",reason:"available_entity"}:null};
}
card._hass={user:{is_admin:true},config:{time_zone:"America/Chicago"},states:Object.fromEntries(members.map(member=>[member.entity_id,{state:member.state,attributes:{restored:member.restored}}])),localize:()=>null,async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/source")return detail(request.node_id);
  if(request.type==="homeostatic/node")return {source:inventory().inventory.nodes.find(item=>item.node_id===request.node_id),explanation:{findings:inventory().inventory.episodes[0]?.reasons||[]},readiness:{answer:"blocked",nodes:[]},impact:{nodes:[]},integration_evidence:{current:{status:"pass",reason:"loaded"}}};
  if(request.type==="homeostatic/save_settings") {
    if(failNext){const error=failNext;failNext=null;if(error.deferred)await new Promise((_,reject)=>{rejectPendingSave=()=>reject(error);});if(error.applied){saved=copy(request.settings);revision++;card.current={status:"current",data:inventory()};}throw error;}
    if(request.revision!==String(revision))throw {code:"stale_configuration",message:"Saved settings changed"};
    saved=copy(request.settings);revision++;card.current={status:"current",data:inventory()};return {saved:true};
  }
  throw Error(`Unexpected request in isolated scenario: ${request.type}`);
}};
root.addEventListener("click",event=>{if(event.target.closest("a[href]"))event.preventDefault();});
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const check=(value,message)=>{if(!value)throw Error(message);};
async function settle() {
  for(let index=0;index<40;index++){await frame();if(!card.settingsBusy&&!card.sourceDetail?.loading)return;}
  throw Error("Source action did not settle");
}
function click(selector) {
  const target=root.querySelector(selector);check(target,`Missing ${selector}`);check(!target.disabled,`Disabled ${selector}`);
  check(target.getClientRects().length,`Hidden ${selector}`);target.click();
}
function disclose(selector) {const target=root.querySelector(selector);check(target,`Missing ${selector}`);if(!target.open)click(`${selector} > summary`);}
function choose(id) {card.sourcesSelection=`source:${id}`;card.sourcesMobileDetail=true;card.sourceDetail=detail(id);card.render();}
function reset(includeSibling=false) {
  if(card.dialog.open)card.dialog.close();
  saved=copy(initial);revision=1;calls=[];failNext=null;rejectPendingSave=null;withSibling=includeSibling;
  delete card._hass.states["sensor.unrelated_reading"];
  if(withSibling)card._hass.states["sensor.unrelated_reading"]={state:"unavailable",attributes:{}};
  Object.assign(card,{configuration:configuration(),settingsDraft:copy(saved),scopedConfiguration:null,availabilityPlan:null,issueAvailabilityPlan:null,issueAvailabilityEpisode:null,detail:null,issueGroupsExpanded:new Set(),issueGroupLimits:new Map(),availabilitySelected:null,availabilityError:null,availabilityContext:null,sourcePoliciesSelection:null,sourcesExcludedOnly:false,sourcesQuery:"",sourcesExpanded:new Set(base.sourcesExpanded),current:{status:"current",data:inventory()},page:"sources"});
  initializeScopedConfiguration(card);choose(ENTITY_ID);
}
/** Device-owned issues sit behind the device's View in Open issues; open those as a notification link would. */
function openExact(id) {
  if(root.querySelector(`[data-episode="${id}"]`))click(`[data-episode="${id}"]`);else card.openDetail({episodeId:id});
}
const listed=id=>root.querySelector(`.issue-group [data-ui-key="issue:${id}"]`);
async function openIssueReview() {
  reset(true);card.page="issues";card.render();await settle();
  click('[data-issue-group]');await settle();
  openExact("shared");await settle();
  check(card.dialog.open&&card.detail.episodeId==="shared","The actual issue row opens its own removal review");
  click('.dialog-body [data-issue-availability="remove"][data-issue-id="shared"]');
}
function report() {document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"source-actions.html",receipt},location.origin);}
function pass(id,evidence) {recordResult(receipt,id,"pass",evidence);report();}
function start(id) {activePath=id;}
document.querySelector("#width").onchange=event=>card.style.width=`${event.target.value}px`;
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
document.querySelector("#device").onclick=()=>choose(DEVICE_ID);
document.querySelector("#entity").onclick=()=>choose(ENTITY_ID);
document.documentElement.dataset.theme="dark";
reset();
document.querySelector("#run").onclick=async()=>{
  const button=document.querySelector("#run");button.disabled=true;
  result.textContent="Running source action checks…";
  receipt=emptyReceipt({fixture:"source-actions.html",browser:navigator.userAgent,build:"working tree",transport:"synthetic settings and source replies; no live calls"});
  try {
    start("issues.availability-batch");reset(true);card.page="issues";card.render();await settle();
    check(!root.querySelector('.issue-group [data-issue-availability],.issue-group .issue-availability,.issue-monitoring-feedback'),"Collapsed queue has no removal control, count or review");
    click('[data-issue-group]');await settle();
    check(!root.querySelector('.issue-group [data-issue-availability],.issue-group .issue-availability,.issue-monitoring-feedback'),"Expanded queue has no removal control, count or review");
    check(listed("shared")&&listed("unrelated"),"The same integration contains another unavailable issue");
    openExact("shared");await settle();
    check(card.dialog.open&&card.detail.episodeId==="shared","The actual issue row opens the exact current issue");
    check(root.querySelector('.dialog-body .issue-availability')?.dataset.issueAvailabilityOwner==="shared","Removal belongs to the opened issue dialog");
    const stopIssue=root.querySelector('.dialog-body [data-issue-availability="remove"]');
    check(stopIssue.textContent==="Stop monitoring…"&&stopIssue.classList.contains("button")&&!stopIssue.classList.contains("link"),"Opened issue uses an outlined Stop monitoring… button");
    click('.dialog-body [data-issue-availability="remove"][data-issue-id="shared"]');await settle();
    check(root.activeElement?.dataset.issueAvailability==="confirm","Issue confirmation receives focus");
    check(!root.querySelector('.dialog-body .source-availability-confirm details')&&root.querySelector('.dialog-body .source-availability-confirm li'),"The review lists its entities without another disclosure");
    check(card.issueAvailabilityEpisode==="shared"&&card.issueAvailabilityPlan.sourceIds.join(",")===ENTITY_ID,"Review includes only this issue's unavailable entity");
    click('.dialog-body [data-issue-availability="cancel"][data-issue-id="shared"]');
    check(saves().length===0&&card.dialog.open&&!card.issueAvailabilityPlan,"Cancel keeps the issue open without saving");
    click('.dialog-body [data-issue-availability="remove"][data-issue-id="shared"]');
    click('.dialog-body [data-issue-availability="confirm"][data-issue-id="shared"]');await settle();
    check(saves().length===1&&exclusion("entities",ENTITY_ID)&&exclusion("devices",ENTITY_ID),"Issue action removes both availability contributions in one save");
    check(!exclusion("entities",entities[1].node_id)&&!exclusion("devices",entities[2].node_id)&&!exclusion("entities","entity:unrelated")&&!exclusion("devices","entity:unrelated"),"Unknown, off and unrelated unavailable siblings remain monitored");
    check(!card.dialog.open&&!card.detail&&!card.issueAvailabilityPlan,"Saved removal closes the exact issue and clears its review");
    check(!listed("shared")&&listed("unrelated"),"Only the removed issue disappears from this integration");
    check(!card.main.querySelector('[data-issue-availability],.issue-monitoring-feedback')&&!card.main.textContent.includes("Changes saved."),"The completed change leaves no queue feedback or Undo");
    click('.nav [data-page="history"]');await settle();
    check(root.querySelector('h1').textContent==="History"&&!root.querySelector('.workspace-tabs'),"History opens its own page");
    check(root.querySelector('.nav [aria-current="page"]').dataset.page==="history","History is the selected top-level tab");
    click('.nav [data-page="problems"]');await settle();
    check(exclusion("entities",ENTITY_ID)&&exclusion("devices",ENTITY_ID)&&saves().length===1&&saved.notifications===false,"Navigation preserves the completed policy save and notification setting");
    await openIssueReview();card.current.data.catalog_revision="changed-issue-catalog";
    click('.dialog-body [data-issue-availability="confirm"][data-issue-id="shared"]');await settle();
    check(saves().length===0&&JSON.stringify(saved)===JSON.stringify(initial),"A stale issue review never saves monitoring");
    check(card.dialog.open&&card.detail.episodeId==="shared"&&!card.issueAvailabilityPlan&&root.querySelector('.dialog-body [role="alert"]').textContent.includes("changed"),"Changed catalog feedback stays inside this issue and requires a fresh review");
    click('.dialog-body [data-issue-availability="remove"][data-issue-id="shared"]');
    check(card.issueAvailabilityPlan.catalogRevision==="changed-issue-catalog","Reopening reviews the current catalog");
    click('.dialog-body [data-issue-availability="cancel"][data-issue-id="shared"]');check(saves().length===0,"Cancelling the refreshed issue review still does not save");

    await openIssueReview();const failedIssuePlan=card.issueAvailabilityPlan;failNext={code:"invalid_settings",message:"Synthetic issue save rejection"};
    click('.dialog-body [data-issue-availability="confirm"][data-issue-id="shared"]');await settle();
    check(saves().length===1&&JSON.stringify(saved)===JSON.stringify(initial),"Rejected issue save leaves monitoring unchanged");
    check(card.dialog.open&&card.detail.episodeId==="shared"&&card.issueAvailabilityPlan===failedIssuePlan&&root.querySelector('.dialog-body [role="alert"]').textContent.includes("Synthetic issue save rejection"),"Failed save keeps the exact review and error in its issue dialog");
    await frame();check(saves().length===1,"A failed issue save never retries automatically");
    click('.dialog-body [data-issue-availability="confirm"][data-issue-id="shared"]');await settle();
    check(saves().length===2&&exclusion("entities",ENTITY_ID)&&exclusion("devices",ENTITY_ID)&&!exclusion("entities","entity:unrelated")&&!card.dialog.open,"Only explicit confirmation retries the exact issue save and then closes quietly");

    await openIssueReview();failNext={code:"invalid_settings",message:"Synthetic late issue failure",deferred:true};
    click('.dialog-body [data-issue-availability="confirm"][data-issue-id="shared"]');await frame();
    check(saves().length===1&&card.settingsBusy&&typeof rejectPendingSave==="function","The issue save remains explicitly pending");
    click('[data-action="close"]');await frame();
    check(!card.dialog.open&&!card.issueAvailabilityPlan&&!card.issueAvailabilityEpisode,"Close discards the pending dialog's review");
    openExact("unrelated");await frame();
    check(card.dialog.open&&card.detail.episodeId==="unrelated","Another actual issue row can open while the previous save finishes");
    const reject=rejectPendingSave;rejectPendingSave=null;reject();await settle();
    check(saves().length===1&&JSON.stringify(saved)===JSON.stringify(initial),"A late rejected save never applies or retries");
    check(card.dialog.open&&card.detail.episodeId==="unrelated"&&!card.issueAvailabilityPlan&&!card.issueAvailabilityEpisode&&!card.dialog.textContent.includes("Synthetic late issue failure"),"Late failure neither replaces nor adds an error to the new issue dialog");
    check(!card.main.querySelector('.issue-monitoring-feedback')&&!card.main.textContent.includes("Synthetic late issue failure"),"Late issue failure never becomes queue feedback");
    click('[data-action="close"]');await frame();
    pass(activePath,"Collapsed and expanded queues have no removal action or count. An actual shared-issue row opens its own review; Cancel keeps the dialog open, confirmation saves exactly its entity across both availability policies, then closes quietly. Unknown/off and unrelated unavailable siblings remain monitored; History navigation preserves the save and notifications stay off. Stale issue catalogs block writes and require a fresh review; rejected saves remain in the exact dialog and retry only after explicit confirmation. Closing a pending review and opening another issue isolates a late failure without a retry or leaked feedback.");

    reset();await settle();
    start("sources.availability");
    card.settingsDraft.monitoring_policies.find(item=>item.id==="temperature").name="Pending temperature";
    card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
    check(root.querySelector('[data-availability-action="stop"]').textContent==="Stop monitoring…","Entity monitoring uses the Stop monitoring… label");
    click('[data-availability-action="stop"]');
    check(root.querySelector(".source-availability-confirm").textContent.includes("Devices")&&root.querySelector(".source-availability-confirm").textContent.includes("Entities"),"Both availability roles must be reviewed");
    check(root.activeElement?.dataset.availabilityAction==="confirm","Confirmation receives keyboard focus");
    click('[data-availability-action="cancel"]');check(saves().length===0,"Cancel must not save");
    click('[data-availability-action="stop"]');click('[data-availability-action="confirm"]');await settle();
    check(saves().length===1&&exclusion("entities",ENTITY_ID)&&exclusion("devices",ENTITY_ID),"One save excludes exactly the entity in both policies");
    const availability=root.querySelector(".source-entity-condition").textContent;
    check(availability==="Home Assistant reports this entity as unavailable","Unmonitor must not reinterpret unavailable");
    check(policy("temperature").name==="Temperature"&&card.settingsDraft.monitoring_policies.find(item=>item.id==="temperature").name==="Pending temperature","Unrelated policy draft survives unsaved");
    check(saved.notification_definitions.methods.phone.name==="Phone"&&card.settingsDraft.notification_definitions.methods.phone.name==="Pending phone","Unrelated delivery draft survives unsaved");
    choose(DEVICE_ID);await settle();choose(ENTITY_ID);await settle();
    click('[data-availability-action="resume"]');click('[data-availability-action="confirm"]');await settle();
    check(!exclusion("entities",ENTITY_ID)&&!exclusion("devices",ENTITY_ID),"Resume persisted after reopening");
    check(!root.querySelector('[data-availability-action="undo"]'),"A completed source save has no Undo control");
    pass(activePath,"Actual Stop, Cancel, confirm, reopen and Resume controls, with no saved-action Undo; exact two-policy exclusions; unchanged unavailable state and unrelated unsaved policy/method drafts.");

    start("sources.availability-batch");reset();choose(DEVICE_ID);await settle();
    click('[data-availability-action="select"]');
    const healthySelection=root.querySelector('[data-availability-select="'+entities[1].node_id+'"]');
    check(healthySelection?.getClientRects().length&&!healthySelection.closest("details"),"Select entities directly reveals healthy member checkboxes");
    click(`[data-availability-select="${ENTITY_ID}"]`);click(`[data-availability-select="${entities[1].node_id}"]`);
    check(root.querySelector('[data-availability-action="stop-selected"]').textContent==="Stop monitoring…","Selected members use the Stop monitoring… label");
    click('[data-availability-action="stop-selected"]');check(root.querySelector('[data-availability-action="confirm"]').textContent==="Stop monitoring","Confirmation uses the Stop monitoring label");click('[data-availability-action="confirm"]');await settle();
    check(saves().length===1&&policy("devices").excluded_sources.length===2&&policy("entities").excluded_sources.length===2,"Batch persists only the selected entities");
    check(!exclusion("devices",entities[2].node_id),"Unselected off-valued sibling remains monitored");
    click('[data-availability-action="select"]');
    check(root.querySelector(".source-excluded-members")?.getClientRects().length,"Select entities directly reveals excluded members for resumption");
    const excludedSelection=root.querySelector('[data-availability-select="'+ENTITY_ID+'"]');
    check(excludedSelection?.getClientRects().length&&!excludedSelection.closest("details"),"Excluded member checkboxes need no additional disclosure");
    click(`[data-availability-select="${ENTITY_ID}"]`);click('[data-availability-action="resume-selected"]');click('[data-availability-action="confirm"]');await settle();
    check(!exclusion("devices",ENTITY_ID)&&exclusion("devices",entities[1].node_id),"Batch resume removes only selected exclusions");
    if(root.querySelector('[data-action="back-sources"]').getClientRects().length)click('[data-action="back-sources"]');click('[data-sources-filters]');click('[data-sources-excluded]');
    check(!root.querySelector(`[data-sources-select="source:${ENTITY_ID}"]`)&&root.querySelector(`[data-sources-select="source:${entities[1].node_id}"]`),"Exclusion filter reaches the remaining excluded entity");
    pass(activePath,"Device checkboxes select exactly two entities for one save; omitted excluded members remain reachable for selective resumption; exclusion filter retains only excluded branches.");

    start("sources.availability-conflicts");reset();await settle();
    click('[data-availability-action="stop"]');card.settingsDraft.monitoring_policies.find(item=>item.id==="entities").name="Pending affected draft";
    click('[data-availability-action="confirm"]');await settle();check(saves().length===0&&root.querySelector('[role="alert"]').textContent.includes("draft"),"Affected drafts block the entire save");
    reset();await settle();click('[data-availability-action="stop"]');revision++;saved.notifications=true;rebaseScopedConfiguration(card,configuration());
    click('[data-availability-action="confirm"]');await settle();check(saves().length===0&&root.querySelector('[role="alert"]').textContent.includes("changed"),"Stale review must not overwrite settings");
    reset();await settle();click('[data-availability-action="stop"]');card.current.data.catalog_revision="new-catalog";
    click('[data-availability-action="confirm"]');await settle();check(saves().length===0&&!root.querySelector('[data-availability-action="confirm"]'),"Changed catalog clears the stale review without a write");
    reset();await settle();click('[data-availability-action="stop"]');card.current.status="disconnected";card.render();
    check(card.main.inert&&saves().length===0,"Disconnected source controls are read-only");card.current.status="current";card.render();
    click('[data-availability-action="cancel"]');check(saves().length===0,"Reconnection retains cancellable review without a write");
    reset();await settle();click('[data-availability-action="stop"]');failNext={code:"invalid_settings",message:"Synthetic save rejection"};
    click('[data-availability-action="confirm"]');await settle();check(!exclusion("devices",ENTITY_ID)&&root.querySelector('[role="alert"]').textContent.includes("Synthetic save rejection"),"Failed save leaves saved scope unchanged");
    click('[data-availability-action="confirm"]');await settle();check(exclusion("devices",ENTITY_ID)&&saves().length===2,"Only deliberate retry saves");
    reset();await settle();click('[data-availability-action="stop"]');failNext={message:"Synthetic response lost",applied:true};
    click('[data-availability-action="confirm"]');await settle();check(exclusion("devices",ENTITY_ID)&&!root.querySelector('[data-availability-action="undo"]'),"Uncertain response has no saved-action Undo");
    check(saves().length===1,"Uncertain response never automatically retries");
    click('[data-availability-action="refresh"]');await settle();
    check(saves().length===1&&root.querySelector('[data-availability-action="resume"]'),"Reading newer saved state exposes Resume without a duplicate uncertain save");
    pass(activePath,"Actual controls block affected drafts, stale settings and changed catalogs; disconnected controls are read-only; rejected saves accept deliberate retry; lost applied-save response has no automatic retry or false success and refresh prevents a duplicate write.");

    start("sources.contextual-issue-controls");reset();await settle();
    check(!root.querySelector('.config-detail [data-device-response]'),"Entity details never control notifications for a broader issue");
    check(root.querySelector('.source-related-issues').textContent.includes("issue involving 2 sources"),"Related issue states its broader scope");
    check(root.querySelector('.source-related-issues').textContent.includes("Room temperature is unavailable"),"Related issue names its reported condition before opening it");
    click('.source-related-issues [data-episode="shared"]');await settle();
    check(card.dialog.open&&card.detail.episodeId==="shared","View issue opens the exact related issue");
    const response=root.querySelector('.dialog-body [data-issue-response="shared"]');
    check(response?.querySelector('[data-device-response="acknowledge"]')?.textContent==="Acknowledge issue","Acknowledgment label identifies the issue");
    check(response.querySelector('[data-device-response="pause"]')?.textContent==="Pause notifications…","Pause label identifies notifications");
    click('.dialog-body [data-device-response="pause"]');await settle();
    check(root.querySelector('.dialog-body [data-device-pause-duration]'),"Pause offers its durations in the issue view");
    click('.dialog-body [data-device-response="cancel-pause"]');await settle();
    check(!root.querySelector('.dialog-body [data-device-pause-duration]')&&root.querySelector('.dialog-body [data-device-response="pause"]'),"Cancelling the pause returns to the issue actions");
    check(!calls.some(item=>!["homeostatic/source","homeostatic/node"].includes(item.type)),"Opening and cancelling issue controls does not mutate state");
    pass(activePath,"Entity details show broader issue scope and View issue without local acknowledgment or pause. Opened the exact shared issue, checked the Acknowledge issue and Pause notifications… labels, and opened and cancelled the pause durations without sending an action request.");

    start("sources.monitoring-policies");reset();await settle();
    const policySettings=JSON.stringify(saved);
    card.settingsDraft.monitoring_policies.find(item=>item.id==="temperature").name="Pending temperature";
    card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
    const policyDrafts=JSON.stringify(card.settingsDraft);
    check(root.querySelectorAll('.source-policy-links [data-source-policies="open"]').length===1&&!root.querySelector('.config-detail [data-definition-id]'),"One contextual policy action replaces inline policy editing");
    click('[data-source-policies="open"]');await settle();
    check(root.querySelector('.source-policy-dialog')?.open,"Monitoring policies opens a native dialog");
    check(root.querySelector('.source-policy-dialog .source-policy-entity')?.textContent===entities[0].name,"Policy context names the exact selected entity");
    const policyRows=[...root.querySelectorAll('.source-policy-dialog .source-policy')];
    check(policyRows.length===2&&policyRows.some(row=>row.textContent.includes("Checks this entity's availability individually"))&&policyRows.some(row=>row.textContent.includes("Uses this entity to assess 3rd Floor Sensor")),"Individual monitoring and device evidence roles remain distinct");
    const deviceEdit=root.querySelector('.source-policy-dialog [data-definition-id="devices"]');deviceEdit.focus();
    card.render();await settle();
    check(root.querySelector('.source-policy-dialog')?.open&&root.activeElement?.dataset.definitionId==="devices","Live updates preserve the open dialog and focused contributing policy");
    click('[data-source-policies="close"]');await settle();
    check(!root.querySelector('.source-policy-dialog')&&root.activeElement?.dataset.sourcePolicies==="open","Close returns focus to Monitoring policies");
    click('[data-source-policies="open"]');await settle();
    root.querySelector('.source-policy-dialog').dispatchEvent(new Event("cancel",{cancelable:true}));await settle();
    check(!root.querySelector('.source-policy-dialog')&&root.activeElement?.dataset.sourcePolicies==="open","Native cancellation restores the trigger and selected entity");
    for(const policyId of ["entities","devices"]) {
      click('[data-source-policies="open"]');await settle();
      click(`.source-policy-dialog [data-definition-id="${policyId}"]`);await settle();
      check(card.page==="policies"&&card.definitionSelection?.id===policyId&&!root.querySelector('.source-policy-dialog'),"Edit opens the exact policy and closes contextual policies");
      check(root.querySelector('[data-workspace-return]')?.textContent==="Back to source","Policy editing keeps its contextual return route");
      const returned=card.navigation.enabled?new Promise(resolve=>window.addEventListener("popstate",resolve,{once:true})):Promise.resolve();
      click('[data-workspace-return]');await returned;await settle();
      check(card.page==="sources"&&card.sourcesSelection===`source:${ENTITY_ID}`&&root.querySelector('#sources-detail-title')?.textContent===entities[0].name,"Returning from policy restores the exact selected entity");
    }
    card.sourceDetail.monitoring_policies=Array.from({length:24},(_,index)=>({id:`long-policy-${index}`,name:`Additional policy ${index+1} with a full descriptive name for the selected equipment`}));
    card.render();click('[data-source-policies="open"]');await settle();
    root.querySelector('.source-policy-dialog [data-source-policies="close"]').focus();
    const scrolledDialog=root.querySelector('.source-policy-dialog');scrolledDialog.scrollTop=120;
    const dialogScroll=scrolledDialog.scrollTop;check(dialogScroll>0,"Many contributing policies remain scrollable");
    card.render();await settle();
    check(root.querySelector('.source-policy-dialog').scrollTop===dialogScroll&&root.activeElement?.dataset.sourcePolicies==="close","Live rendering preserves long-dialog scroll and focused dismissal");
    click('[data-source-policies="close"]');delete card.sourceDetail.monitoring_policies;card.render();
    click('[data-source-policies="open"]');await settle();
    const monitoringNodes=card.current.data.inventory.nodes;
    card.current.data.inventory.nodes=monitoringNodes.filter(item=>!item.monitoring_policy);card.render();await settle();
    check(root.querySelector('.source-policy-dialog')?.open&&root.querySelector('.source-policy-dialog').textContent.includes("No policies currently monitor this entity")&&!root.querySelector('[data-source-policies="open"]'),"An open dialog stays dismissible when its last contributor disappears");
    click('[data-source-policies="close"]');await settle();
    check(root.activeElement?.id==="sources-detail-title","Closing a dialog without its trigger focuses the selected entity heading");
    card.current.data.inventory.nodes=monitoringNodes;card.render();
    check(JSON.stringify(saved)===policySettings&&JSON.stringify(card.settingsDraft)===policyDrafts&&saves().length===0,"Policy navigation preserves saved monitoring and unrelated policy/method drafts");
    pass(activePath,"One rendered Monitoring policies action opens both contribution roles for the selected entity. Close and native cancel-event wiring restore focus; a live render preserves dialog, edit focus and a long list's scroll. Both Edit policy actions open the exact editor and Back to source restores selected identity. Loss of the last contributor keeps the dialog dismissible and Close focuses the entity heading. Saved settings and unrelated policy/method drafts remain unchanged. Native keyboard activation and Escape require the accompanying browser check.");

    start("sources.compact-layout");reset();await settle();
    check(!root.querySelector('.source-monitoring-explanation,.source-technical'),"Entity details need no disclosure or technical block");
    check(root.querySelector('.source-policy-links [data-source-policies="open"]').getClientRects().length,"Monitoring policies is directly visible");
    const action=root.querySelector('[data-availability-action="stop"]');action.focus();card.render();await settle();
    check(root.activeElement?.dataset.availabilityAction==="stop","Live render retains focus on the entity action");
    for(const width of [320,390,1200])for(const theme of ["light","dark"]) {
      card.style.width=`${width}px`;document.documentElement.dataset.theme=theme;await frame();
      check(card.scrollWidth<=card.clientWidth+1,`No host overflow at ${width}px ${theme}`);
      check(root.querySelector('.shell').scrollWidth<=card.clientWidth+1,`No content overflow at ${width}px ${theme}`);
      const action=root.querySelector('[data-availability-action="stop"]');check(action.getBoundingClientRect().height>=44,"Action touch target at least 44px");
      click('[data-availability-action="stop"]');check(root.activeElement?.dataset.availabilityAction==="confirm","Focus reaches confirm at each width");click('[data-availability-action="cancel"]');
      click('[data-source-policies="open"]');await settle();
      const policyDialog=root.querySelector('.source-policy-dialog');
      check(policyDialog.open&&policyDialog.scrollWidth<=policyDialog.clientWidth+1,`Policy dialog fits ${width}px ${theme}`);
      check(root.querySelector('.source-policy-dialog [data-source-policies="close"]').getClientRects().length,"Dialog dismissal remains reachable");
      click('[data-source-policies="close"]');await settle();
      check(root.activeElement?.dataset.sourcePolicies==="open","Dialog closing restores focus at each width");
    }
    card.style.width=`${document.querySelector("#width").value}px`;document.documentElement.dataset.theme=document.querySelector("#theme").value;reset();await settle();
    pass(activePath,"Visible entity actions retain focus through rerender without Details; Stop review/Cancel and Monitoring policies open/close work at 320, 390 and 1200 CSS pixels in light and dark. Dialog closing restores trigger focus; no required horizontal scrolling; primary action meets 44px touch target. Physical Safari untested.");
    result.textContent=`PASS: ${receiptSummary(receipt).pass} source action paths; other inventory paths remain untested by this fixture.`;
  }catch(error){recordResult(receipt,activePath,"fail",error.message);document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);result.textContent=`FAIL: ${activePath}: ${error.message}`;}
  finally{button.disabled=false;report();}
};
if(new URLSearchParams(location.search).has("run"))document.querySelector("#run").click();
