import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=83";
import {prepareAvailabilityChange, applyAvailabilityChange, availabilityConfirmation} from "./source-monitoring.mjs?v=83";

const identity=source=>source?.monitoring_source||source?.node_id;
const unavailable=state=>state?.state==="unavailable"&&!state.attributes?.restored;
const blocked=card=>card.current.status!=="current"||card.current.data.catalog_stale||card.current.data.catalog_loaded===false||!card.configuration?.settings||card.settingsBusy||card.configBusy||card.scopedBusy;

/** Select current unavailable evidence in these issues, never historical or dependent members. */
export function issueAvailabilitySources(card,episodes) {
  const rows=inventoryRows(card.current.data),nodes=new Map(rows.map(source=>[source.node_id,source]));
  const entities=new Map(rows.filter(source=>source.kind==="entity"&&!source.monitoring_policy).map(source=>[source.entity_id,source]));
  const policies=new Map((card.configuration?.settings?.monitoring_policies||[]).filter(policy=>policy.enabled&&policy.check==="availability").map(policy=>[policy.id,new Set(policy.excluded_sources||[])]));
  const ids=new Set(episodes.flatMap(episode=>[episode.anchor,...(episode.reasons||[]).map(finding=>finding.node_id)])),selected=new Map();
  for(const id of ids) {
    const check=nodes.get(id),policy=policies.get(typeof check?.monitoring_policy==="string"?check.monitoring_policy:check?.monitoring_policy?.id);
    if(!policy||!check.watched||!["entity","device"].includes(check.kind))continue;
    const current=card.current.data.inventory.entity_status?.[id]?.current;
    const captured=["warn","fail"].includes(current?.status)&&current.reason===(check.kind==="device"?"all_unavailable":"unavailable");
    const members=check.kind==="device"?check.availability_entities||[]:[check.entity_id];
    for(const entityId of members) {
      const source=entities.get(entityId),state=card._hass?.states?.[entityId];
      if(!source||source.disabled||policy.has(identity(source))||!(state?unavailable(state):captured))continue;
      selected.set(identity(source),source);
    }
  }
  return [...selected.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

const openedEpisode=card=>card.dialog?.open&&card.detail?.episodeId
  ?card.current.data?.inventory?.episodes?.find(episode=>episode.episode_id===card.detail.episodeId):null;
const reviewContext=id=>`issue:${id}`;

function availabilityControls(card,episode) {
  if(!card.dialog?.open||card.detail?.episodeId!==episode.episode_id)return "";
  const current=openedEpisode(card);
  const plan=card.issueAvailabilityEpisode===episode.episode_id?card.issueAvailabilityPlan:null;
  const error=(card.availabilityContext===reviewContext(episode.episode_id)?card.availabilityError:null)
    ||(!current&&plan&&!card.scopedBusy?"This issue is no longer current. Close this dialog to review the updated issue list.":null);
  const action=(mode,label)=>`<button type="button" class="${mode==="remove"?"link":"button"}${mode==="confirm"?" primary":""}" data-issue-availability="${mode}" data-issue-id="${esc(episode.episode_id)}"${(mode==="cancel"?card.scopedBusy||card.settingsBusy:blocked(card)||mode==="confirm"&&!current)?' disabled':''}>${label}</button>`;
  const content=plan?availabilityConfirmation(plan,(mode,label)=>action(mode,mode==="confirm"&&card.scopedBusy?"Saving…":label))
    :current&&issueAvailabilitySources(card,[current]).length?action("remove","Remove from availability monitoring…"):"";
  return `${content}${error?`<p role="alert">${esc(error)}</p>${card.scopedConfiguration?.needsRefresh?action("refresh","Refresh saved monitoring"):""}`:""}`;
}

/** Keep the exact monitoring decision inside its opened issue. */
export function issueAvailabilityAction(card,episode) {
  return `<div class="issue-availability" data-issue-availability-owner="${esc(episode.episode_id)}">${availabilityControls(card,episode)}</div>`;
}

/** Update modal controls during saves without fetching issue evidence again. */
export function renderIssueAvailability(card) {
  const host=card.dialog?.querySelector?.(".issue-availability"),id=card.detail?.episodeId;
  if(!card.dialog?.open||!host||!id||host.dataset.issueAvailabilityOwner!==id)return;
  const episode=openedEpisode(card)||{episode_id:id};
  const content=availabilityControls(card,episode);
  if(host.innerHTML===content)return;
  const state=card.capturePageState?.(host);
  host.innerHTML=content;
  if(state)card.restorePageState(state,host);
}

/** An unsaved review belongs only to the dialog where it was opened. */
export function resetIssueAvailability(card) {
  card.issueAvailabilityPlan=null;
  card.issueAvailabilityEpisode=null;
  if(card.availabilityContext?.startsWith("issue:")) {
    card.availabilityContext=null;
    card.availabilityError=null;
  }
}

function focusAvailability(card) {
  const host=card.dialog?.querySelector?.(".issue-availability");
  host?.querySelector('[role="alert"], .source-availability-confirm')?.scrollIntoView?.({block:"nearest"});
  host?.querySelector(card.issueAvailabilityPlan?'[data-issue-availability="confirm"]':'[data-issue-availability="remove"]')?.focus({preventScroll:true});
}

/** Route this issue's reviewed entities through the guarded policy save. */
export function editIssueAvailability(card,event) {
  const button=event.target.closest?.("[data-issue-availability]");
  if(!button)return false;
  const episode=openedEpisode(card),action=button.dataset.issueAvailability,id=card.detail?.episodeId;
  if(!card.dialog?.open||!id||button.dataset.issueId!==id||action==="remove"&&!episode)return true;
  if(action==="cancel"?card.scopedBusy||card.settingsBusy:blocked(card))return true;
  const context=reviewContext(id);
  if(action!=="remove"&&card.issueAvailabilityEpisode!==id)return true;
  card.availabilityContext=context;card.availabilityError=null;
  if(action==="remove") {
    card.issueAvailabilityEpisode=id;
    card.issueAvailabilityPlan=null;
    try {card.issueAvailabilityPlan=prepareAvailabilityChange(card,issueAvailabilitySources(card,[episode]));}
    catch(error){card.availabilityError=error.message;}
  }else if(action==="cancel")resetIssueAvailability(card);
  else if(action==="refresh") {
    card.loadConfiguration().then(()=>{
      if(!card.dialog.open||card.detail?.episodeId!==id||card.availabilityContext!==context)return;
      card.issueAvailabilityPlan=null;
      if(card.configError)card.availabilityError=card.configError;
      else resetIssueAvailability(card);
      card.render();focusAvailability(card);
      if(!card.configError&&!openedEpisode(card))card.loadDetail?.();
    });
    return true;
  }else if(action==="confirm") {
    const plan=card.issueAvailabilityPlan;
    if(!plan)return true;
    const currentIds=episode?issueAvailabilitySources(card,[episode]).map(identity).sort():[];
    if(JSON.stringify(currentIds)!==JSON.stringify(plan.sourceIds)) {
      card.issueAvailabilityPlan=null;
      card.availabilityError="Availability changed. Review the current entities before removing monitoring.";
      card.render();focusAvailability(card);return true;
    }
    applyAvailabilityChange(card,plan).then(saved=>{
      if(!card.dialog.open||card.detail?.episodeId!==id||card.issueAvailabilityPlan!==plan)return;
      if(saved) {
        resetIssueAvailability(card);card.detail=null;card.dialog.close();card.render();
        card.shadowRoot?.querySelector("[data-issue-search]")?.focus({preventScroll:true});
        return;
      }
      if(plan.revision!==card.configuration?.revision||plan.catalogRevision!==card.current.data?.catalog_revision)card.issueAvailabilityPlan=null;
      card.render();focusAvailability(card);
    }).catch(error=>{
      if(!card.dialog.open||card.detail?.episodeId!==id||card.issueAvailabilityPlan!==plan)return;
      card.availabilityError=error.message||"Could not change monitoring.";
      card.render();focusAvailability(card);
    });
    return true;
  }
  card.render();focusAvailability(card);
  if(action==="cancel"&&!episode)card.loadDetail?.();
  return true;
}
