import {notProvidedProblem} from "./entity-not-provided.mjs?v=102";
import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=102";
import {callAction} from "./history-controls.mjs?v=102";
import {relatedDeviceIssues} from "./device-issue-model.mjs?v=102";
import {deviceEntitySummary} from "./device-entities.mjs?v=102";
import {sourceCoverageIndex,sourceCoverage} from "./source-coverage.mjs?v=102";
import {issueConfiguration, issuePolicyChoices} from "./issue-configuration.mjs?v=102";
import {issueAvailabilityAction, issueAvailabilityNeedsCatalog, renderIssueAvailability} from "./issue-monitoring.mjs?v=102";
import {batteryProblem,entityProblem,vacuumProblem} from "./problem.mjs?v=102";
import {temperatureProblem} from "./source-temperature.mjs?v=102";
import {upsProblem} from "./ups.mjs?v=102";
import {retainedProblem} from "./check-presentation.mjs?v=102";

const date=value=>new Date(value).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const issueId=item=>item.episode.episode_id;
const currentEntries=card=>card.current.data?relatedDeviceIssues(card.current.data,card.detail?.deviceId):[];
const canAct=card=>card.current.status==="current"&&card._hass?.user?.is_admin&&card.current.data?.inventory.attention_controls_supported&&!card.scopedBusy&&!card.settingsBusy;
const stateFor=(card,entries)=>{
  let state=card.deviceIssues;
  if(!state||state.selection!==card.detail)state=card.deviceIssues={selection:card.detail,selected:new Set(entries.map(issueId)),results:new Map(),busy:false,form:null};
  const current=new Set(entries.map(issueId));
  for(const id of state.selected)if(!current.has(id))state.selected.delete(id);
  return state;
};

/** Keep a current single target direct; several issues retain explicit selection. */
export function selectedDeviceIssueIds(card,entries=currentEntries(card)) {
  const state=stateFor(card,entries);
  return entries.length===1?entries.map(issueId):entries.filter(item=>state.selected.has(issueId(item))).map(issueId);
}

function issueName(item) {
  return item.canonicalSource?.name||item.source.name;
}

function issueProblem(card,item) {
  const data=card.current.data,source=item.source;
  const status=data.inventory.entity_status?.[source.node_id]||{current:item.episode.reasons?.find(finding=>finding.node_id===source.node_id)};
  const problem=notProvidedProblem(source,status)??temperatureProblem(source,status)??upsProblem(source,data.inventory.ups_status?.[source.node_id]||status)??
    batteryProblem(source,status)??vacuumProblem(source,status,data.areas||[]);
  const current=problem??entityProblem(source,status,null,data.areas||[],key=>card._hass?.localize?.(key));
  const retained=retainedProblem(current,status,item.episode.reasons);
  return retained?{...retained,currentDetail:retained!==current?current.headline:null}:{headline:status.current?.message||"Current evidence missing"};
}

function issueState(card,item,state) {
  const id=issueId(item),saved=state.results.get(id),notes=[];
  const local=saved?.snapshot===card.current.data?saved:null;
  const acknowledged=local?.acknowledged||card.current.data.policy?.episodes?.find(row=>row.episode_id===id)?.acknowledgment;
  if(acknowledged)notes.push("Acknowledged");
  const pauses=(card.current.data.inventory.operator_controls||[]).filter(row=>row.action==="shelve"&&row.target===id);
  const until=[local?.until,...pauses.map(row=>row.until)].filter(value=>value&&new Date(value).getTime()>Date.now()).sort().at(-1);
  if(until)notes.push(`Notifications paused until ${date(until)}`);
  return `${notes.length?`<span class="small device-issue-state">${esc(notes.join(" · "))}</span>`:""}${saved?.error?`<span class="device-issue-error" role="alert">${esc(saved.error)}</span>`:""}`;
}

function actionArea(card,entries,state) {
  const ids=selectedDeviceIssueIds(card,entries),locked=!canAct(card)||state.busy;
  if(state.form) {
    const count=state.form.ids.length;
    return `<form class="device-issue-pause" aria-label="Pause notifications"><h3>Pause notifications</h3><p>For ${count===1?"this issue":`${count} selected issues`} and every recipient, including urgent notifications. Issues stay open.</p><label>Pause for<select data-device-pause-duration${locked?" disabled":""}><option value="1"${state.form.hours===1?" selected":""}>1 hour</option><option value="4"${state.form.hours===4?" selected":""}>4 hours</option><option value="24"${state.form.hours===24?" selected":""}>24 hours</option></select></label><p class="small">Existing pauses can only be extended.</p><div class="actions"><button type="button" class="button primary" data-device-response="apply-pause"${locked?" disabled":""}>${state.busy?"Pausing…":"Apply pause"}</button><button type="button" class="button" data-device-response="cancel-pause"${state.busy?" disabled":""}>Cancel</button></div></form>`;
  }
  const allAcknowledged=ids.length&&ids.every(id=>state.results.get(id)?.snapshot===card.current.data&&state.results.get(id)?.acknowledged||card.current.data.policy?.episodes?.find(row=>row.episode_id===id)?.acknowledgment);
  return `<div class="actions device-issue-actions"><button type="button" class="button" data-device-response="acknowledge"${locked||!ids.length||allAcknowledged?" disabled":""}>${state.busy?"Saving…":allAcknowledged?"Acknowledged":"Acknowledge"}</button><button type="button" class="button" data-device-response="pause"${locked||!ids.length?" disabled":""}>Pause</button></div>${!ids.length&&entries.length?'<p class="small">Select an issue to acknowledge or pause.</p>':""}`;
}

/** Render one device's current findings inside the shared response dialog. */
export function renderDeviceIssues(card,result=card.deviceIssueContext) {
  const close=card.dialog?.querySelector('[data-action="close"]');
  if(close)close.disabled=Boolean(card.deviceIssues?.selection===card.detail&&card.deviceIssues?.busy);
  if(!card.detail?.deviceId||!result||!card.current.data)return;
  card.deviceIssueContext=result;
  const entries=currentEntries(card),state=stateFor(card,entries),multiple=entries.length>1;
  const body=card.dialog.querySelector(".dialog-body"),label=card.shadowRoot.querySelector("#detail-label");
  card.shadowRoot.querySelector("#detail-title").textContent=result.source.name;
  label.textContent="Device";label.hidden=false;
  const monitored=(result.members||[]).some(member=>sourceCoverage({node_id:member.node_id,entity_id:member.entity_id,kind:"entity"},sourceCoverageIndex(card.current.data)).monitored);
  const summary=deviceEntitySummary(result,{monitored});
  const selected=selectedDeviceIssueIds(card,entries);
  const uniformUnavailable=summary.total>0&&summary.unavailable===summary.total&&entries.every(item=>item.source.check_id==="availability"&&["unavailable","all_unavailable"].includes(issueProblem(card,item).currentReason));
  const evidence=item=>{
    const problem=issueProblem(card,item);
    const condition=uniformUnavailable?"":`<span class="small">${esc(problem.headline)}</span>`;
    const detail=[problem.currentDetail,problem.reported,problem.timing,problem.detail].filter(Boolean);
    if(["temperature_limit","thermostat","ups"].includes(item.source.kind)&&problem.summary)detail.unshift(problem.summary);
    return condition+[...new Set(detail)].map(text=>`<span class="small">${esc(text)}</span>`).join("");
  };
  const row=item=>{
    const id=issueId(item),name=issueName(item);
    const duplicates=entries.filter(other=>other.canonicalSource.node_id===item.canonicalSource.node_id).length>1;
    const policy=typeof item.source.monitoring_policy==="object"?item.source.monitoring_policy?.name:card.configuration?.settings?.monitoring_policies?.find(policy=>policy.id===item.source.monitoring_policy)?.name;
    return `<label class="device-issue-choice"><input type="checkbox" data-device-issue-select="${esc(id)}"${state.selected.has(id)?" checked":""}${state.busy||state.form?" disabled":""}><span><strong>${esc(name)}</strong>${duplicates&&policy?`<span class="small">${esc(policy)}</span>`:""}${evidence(item)}${issueState(card,item,state)}</span></label>`;
  };
  const deviceLevel=item=>["device","battery","ups"].includes(item.canonicalSource.kind);
  const devices=entries.filter(deviceLevel),entities=entries.filter(item=>!deviceLevel(item));
  const selection=multiple?`<fieldset class="device-issue-selection"><legend class="sr-only">Device issues</legend><div class="device-issue-select-all"><label><input type="checkbox" data-device-issues-all${selected.length===entries.length?" checked":""}${state.busy||state.form?" disabled":""}>All issues</label><span class="small" role="status">${selected.length} of ${entries.length} selected</span></div>${devices.map(row).join("")}${entities.length?`<div class="device-issue-entities"><p class="small">Entities on this device</p>${entities.map(row).join("")}</div>`:""}</fieldset>`:entries.length?`<div class="device-issue-single">${entries[0].source.kind!=="device"?`<h3>${esc(issueName(entries[0]))}</h3>`:""}${evidence(entries[0])}${issueState(card,entries[0],state)}</div>`:'<p role="status">No related issues remain open.</p>';
  const coverage=issuePolicyChoices(card,[result.source,...entries.map(item=>item.source)],result.monitoring_policies||[]);
  const namedUnavailable=new Set(entries.filter(item=>item.source.kind==="entity"&&item.source.check_id==="availability"&&issueProblem(card,item).currentReason==="unavailable").map(item=>item.canonicalSource.entity_id));
  const gaps=(result.members||[]).filter(member=>member.restored||member.state==="missing"||member.state==="unavailable"&&!namedUnavailable.has(member.entity_id));
  const readings=gaps.length?`<ul class="source-device-members device-availability-readings">${gaps.map(member=>{
    const reason=member.restored?"Not currently provided by its integration":member.state==="missing"?"No current state from Home Assistant":"Home Assistant reports this entity as unavailable";
    const name=member.entity_id?`<a href="/developer-tools/state?entity_id=${encodeURIComponent(member.entity_id)}">${esc(member.name)}</a>`:esc(member.name);
    return `<li class="source-device-member"><span>${name}</span><span class="source-device-member-state">${esc(reason)}</span></li>`;
  }).join("")}</ul>`:"";
  const content=`<section class="detail problem-brief"><h3>${esc(summary.label)}</h3>${readings}<div class="actions"><a class="button" href="/config/devices/device/${encodeURIComponent(card.detail.deviceId)}">Open device</a></div></section><section class="device-issues" aria-label="Device issues">${selection}${entries.length||state.form?actionArea(card,entries,state):""}${state.message?`<p role="status">${esc(state.message)}</p>`:""}</section>${issueAvailabilityAction(card,null)}${issueConfiguration(card,coverage)}`;
  const pageState=card.capturePageState(body);
  body.innerHTML=content;card.restorePageState(pageState,body);
  const master=body.querySelector("[data-device-issues-all]");
  if(master)master.indeterminate=selected.length>0&&selected.length<entries.length;
  card.renderedDetailContent=content;
}

/** Read only the device's established source evidence; issue identity comes from inventory. */
export async function readDeviceIssues(card,current) {
  const selection=card.detail;
  const findSource=()=>inventoryRows(card.current.data).find(row=>row.kind==="device"&&row.attributes?.device?.includes(selection.deviceId)&&!row.monitoring_policy);
  let source=findSource();
  if(card.current.data.schema_version===3&&(!card.current.data.catalog_loaded||card.current.data.catalog_stale)) {
    const loading=card.store?.ensureCatalog();
    if(!source){await loading;if(!current())return;source=findSource();}
  }
  if(!source)throw Error("Device details are not currently available. Reopen the view after monitoring refreshes.");
  const context=await card._hass.callWS({type:"homeostatic/source",node_id:source.node_id});
  if(!current())return;
  // The summary counts all members; its explanation must reach beyond page one too.
  let offset=context.next_offset;
  while(offset!==null&&offset!==undefined) {
    const page=await card._hass.callWS({type:"homeostatic/source",node_id:source.node_id,offset});
    if(!current())return;
    context.members.push(...page.members);
    offset=page.next_offset;
  }
  if(!current())return;
  if(currentEntries(card).some(item=>issueAvailabilityNeedsCatalog(card,item.episode)))card.store?.ensureCatalog();
  renderDeviceIssues(card,{...context,source});
}

/** Freeze exact IDs once; partial recovery/failure never substitutes another issue. */
export async function applyDeviceIssueAction(card,action,ids,until=null) {
  const entries=currentEntries(card),state=stateFor(card,entries);
  if(state.busy||!canAct(card)||!ids.length)return;
  const captured=[...new Set(ids)],names=new Map(entries.map(item=>[issueId(item),issueName(item)]));
  state.busy=true;state.message="";renderDeviceIssues(card);
  let saved=0,failed=0;
  for(const id of captured) {
    if(!canAct(card)||!currentEntries(card).some(item=>issueId(item)===id)) {
      state.results.set(id,{...state.results.get(id),error:"No longer current or monitoring disconnected; no request sent."});failed++;continue;
    }
    try {
      const response=await callAction(card._hass,action,action==="acknowledge"?{episode_id:id}:{episode_id:id,until,reason:""});
      if(action==="acknowledge"?!response.acknowledgment:!response.control)throw Error("No saved result was returned.");
      const result={...state.results.get(id),snapshot:card.current.data,error:null};
      if(action==="acknowledge")result.acknowledged=response.acknowledgment;
      else result.until=response.control.until;
      state.results.set(id,result);saved++;
    }catch(error){state.results.set(id,{...state.results.get(id),error:`${error?.message||"Result unconfirmed."} Check current state before retrying.`});failed++;}
  }
  state.busy=false;state.form=null;
  const failures=captured.filter(id=>state.results.get(id)?.error).map(id=>names.get(id)||"Ended issue");
  state.message=`${saved} ${saved===1?"issue":"issues"} ${action==="acknowledge"?"acknowledged":"paused"}.${failed?` ${failed} not confirmed: ${failures.join(", ")}. Review their results before retrying.`:""}`;
  if(card.detail===state.selection){renderDeviceIssues(card);card.dialog.querySelector(`[data-device-response="${action==="acknowledge"?"pause":"acknowledge"}"]`)?.focus({preventScroll:true});}
}

/** Handle only the combined dialog; individual routes keep their existing exact target. */
export function editDeviceIssues(card,event) {
  const target=event.target.closest?.("[data-device-issue-select], [data-device-issues-all], [data-device-response], [data-device-pause-duration]");
  if(!target||!card.detail?.deviceId)return false;
  const entries=currentEntries(card),state=stateFor(card,entries);
  if(state.busy)return true;
  if(target.matches("input")) {
    if(event.type!=="change"||state.form)return true;
    if(target.hasAttribute("data-device-issues-all"))state.selected=new Set(target.checked?entries.map(issueId):[]);
    else if(target.checked)state.selected.add(target.dataset.deviceIssueSelect);else state.selected.delete(target.dataset.deviceIssueSelect);
    state.message="";renderDeviceIssues(card);return true;
  }
  if(target.hasAttribute("data-device-pause-duration")) {
    if(event.type==="change"&&state.form)state.form.hours=Number(target.value);
    return true;
  }
  if(event.type!=="click"||target.disabled)return true;
  const action=target.dataset.deviceResponse;
  if(action==="acknowledge")void applyDeviceIssueAction(card,"acknowledge",selectedDeviceIssueIds(card,entries));
  else if(action==="pause")state.form={ids:selectedDeviceIssueIds(card,entries),hours:1};
  else if(action==="cancel-pause")state.form=null;
  else if(action==="apply-pause"&&state.form)void applyDeviceIssueAction(card,"shelve",state.form.ids,new Date(Date.now()+state.form.hours*3600000).toISOString());
  renderDeviceIssues(card);renderIssueAvailability(card);return true;
}
