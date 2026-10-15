import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=82";
import {prepareAvailabilityChange, applyAvailabilityChange, availabilityConfirmation} from "./source-monitoring.mjs?v=82";

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

/** Keep the complete batch count beside its group, including collapsed issue rows. */
export function issueAvailabilityAction(card,group) {
  const sources=issueAvailabilitySources(card,group.episodes);
  card.issueAvailabilityGroups.set(group.key,sources);
  if(!sources.length)return "";
  const count=sources.length,label=count===1?"Remove this entity from availability monitoring…":"Remove these entities from availability monitoring…";
  return `<div class="body issue-availability"><p class="small">${count} unavailable ${count===1?"entity":"entities"}</p><button type="button" class="button" data-issue-availability="remove" data-monitoring-group="${esc(group.key)}"${blocked(card)?' disabled':''}>${label}</button></div>`;
}

/** Keep confirmation and unresolved errors reachable when issue groups change. */
export function issueAvailabilityFeedback(card) {
  const error=card.availabilityContext==="issues"?card.availabilityError:null;
  if(!card.issueAvailabilityPlan&&!error)return "";
  const action=(mode,label)=>`<button type="button" class="button${mode==="confirm"?" primary":""}" data-issue-availability="${mode}"${(mode==="cancel"?card.scopedBusy||card.settingsBusy:blocked(card))?' disabled':''}>${label}</button>`;
  return `<section class="body issue-monitoring-feedback" aria-label="Availability monitoring">${card.issueAvailabilityPlan?availabilityConfirmation(card.issueAvailabilityPlan,(mode,label)=>action(mode,mode==="confirm"&&card.scopedBusy?"Saving…":label)):""}${error?`<p role="alert">${esc(error)}</p>${card.scopedConfiguration?.needsRefresh?action("refresh","Refresh saved monitoring"):""}`:""}</section>`;
}

/** Route explicit batch actions through the existing guarded policy save. */
export function editIssueAvailability(card,event) {
  const button=event.target.closest?.("[data-issue-availability]");
  if(!button)return false;
  const action=button.dataset.issueAvailability;
  if(action==="cancel"?card.scopedBusy||card.settingsBusy:blocked(card))return true;
  card.availabilityContext="issues";card.availabilityError=null;
  if(action==="remove") {
    card.issueAvailabilityPlan=null;
    try {
      card.issueAvailabilityPlan=prepareAvailabilityChange(card,card.issueAvailabilityGroups.get(button.dataset.monitoringGroup)||[]);
    }catch(error){card.availabilityError=error.message;}
  }else if(action==="cancel")card.issueAvailabilityPlan=null;
  else if(action==="refresh") {
    card.loadConfiguration().then(()=>{
      if(card.configError)card.availabilityError=card.configError;
      else card.issueAvailabilityPlan=null;
      card.render();
    });
    return true;
  }else if(action==="confirm") {
    if(!card.issueAvailabilityPlan)return true;
    applyAvailabilityChange(card,card.issueAvailabilityPlan).then(saved=>{
      if(saved||card.issueAvailabilityPlan?.revision!==card.configuration?.revision||card.issueAvailabilityPlan?.catalogRevision!==card.current.data.catalog_revision)card.issueAvailabilityPlan=null;
      card.render();
      card.shadowRoot?.querySelector('[data-issue-availability="confirm"], [data-issue-availability="remove"]')?.focus({preventScroll:true});
    }).catch(error=>{card.availabilityError=error.message||"Could not change monitoring.";card.render();});
    return true;
  }
  card.render();
  card.shadowRoot?.querySelector(".issue-monitoring-feedback")?.scrollIntoView?.({block:"center"});
  card.shadowRoot?.querySelector(card.issueAvailabilityPlan?'[data-issue-availability="confirm"]':'[data-issue-availability="remove"]')?.focus({preventScroll:true});
  return true;
}
