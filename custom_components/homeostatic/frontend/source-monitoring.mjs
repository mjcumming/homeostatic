/** Contextual availability changes use the same saved policy exclusions as Policies. */
import {saveScopedConfiguration} from "./scoped-configuration.mjs?v=95";
import {escapeHtml as esc} from "./model.mjs?v=95";

const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const scope={kind:"source-availability"};
const policies=card=>card.configuration?.settings?.monitoring_policies||[];
const identity=source=>source?.monitoring_source||source?.node_id;
const rows=card=>[...(card.current?.data?.inventory?.catalog?.candidates||[]),...(card.current?.data?.inventory?.nodes||[])];
const pendingCatalog=card=>card.current?.data?.catalog_stale||card.current?.data?.catalog_loaded===false;

function monitoringIndex(card,values=[]) {
  const all=rows(card),byId=new Map(),canonical=new Map(),direct=new Map(),members=new Map();
  const add=(map,key,id)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(id);};
  for(const source of all) {
    if(!byId.has(source.node_id))byId.set(source.node_id,source);
    if(!source.monitoring_policy&&!canonical.has(source.node_id))canonical.set(source.node_id,source);
  }
  const checks=[...all,...all.flatMap(source=>source.monitoring_checks||[]),...values.flatMap(value=>typeof value==="object"?value?.monitoring_checks||[]:[])];
  for(const check of checks) {
    const id=typeof check.monitoring_policy==="string"?check.monitoring_policy:check.monitoring_policy?.id;
    if(!check.watched||!id)continue;
    if(check.kind==="entity")add(direct,identity(check),id);
    if(check.kind==="device")for(const entityId of check.availability_entities||[])add(members,entityId,id);
  }
  const available=policies(card).filter(policy=>policy.check==="availability").map(policy=>({...policy,excluded:new Set(policy.excluded_sources||[]),label:{id:policy.id,name:policy.name,enabled:policy.enabled}}));
  return {byId,canonical,direct,members,available};
}

function entitySource(index,value) {
  const selected=typeof value==="string"?index.byId.get(value):value;
  if(!selected||selected.kind!=="entity")return null;
  return index.canonical.get(identity(selected))||selected;
}

function monitoringState(index,value) {
  const source=entitySource(index,value),sourceId=identity(source);
  if(!source)return {sourceId:null,activePolicies:[],excludedPolicies:[],canStop:false,canResume:false};
  const active=new Set([...(index.direct.get(sourceId)||[]),...(index.members.get(source.entity_id)||[])]);
  const activePolicies=index.available.filter(policy=>policy.enabled&&active.has(policy.id)&&!policy.excluded.has(sourceId)).map(policy=>policy.label);
  const excludedPolicies=index.available.filter(policy=>policy.excluded.has(sourceId)).map(policy=>policy.label);
  return {sourceId,activePolicies,excludedPolicies,canStop:activePolicies.length>0,canResume:excludedPolicies.length>0};
}

/** Describe actual current checks and explicitly saved exclusions for one entity. */
export function availabilityMonitoring(card,value) {
  return monitoringState(monitoringIndex(card,[value]),value);
}

/** Keep the exact affected entities visible beside the confirmation. */
export function availabilityConfirmation(plan,action) {
  const count=plan.sources.length,noun=count===1?"entity":"entities",stopping=plan.mode==="stop";
  const heading=stopping?`Stop monitoring ${count===1?"this entity":`these ${count} entities`}?`:`Resume availability monitoring for ${count} ${noun}?`;
  const explanation=stopping?`Stop availability monitoring for ${count===1?"this entity":"these entities"}. Other checks stay enabled.`:"Remove availability exclusions. Existing policy selections still apply.";
  return `<section class="source-availability-confirm" aria-label="Change availability monitoring"><h3>${heading}</h3><p>${explanation}</p><ul>${plan.sources.map(item=>`<li>${esc(item.name)}${item.entityId?` <span class="small">${esc(item.entityId)}</span>`:""}</li>`).join("")}</ul><div class="actions">${action("confirm",stopping?"Stop Monitoring":"Resume availability monitoring")}${action("cancel","Cancel")}</div></section>`;
}

/** Freeze the exact affected saved policies before displaying confirmation. */
export function prepareAvailabilityChange(card,values,mode="stop") {
  if(!["stop","resume"].includes(mode))throw new Error("Choose whether to stop or resume availability monitoring.");
  const operation=mode==="stop"?"stopping":"resuming";
  if(card.current?.status!=="current")throw new Error(`Reconnect before ${operation} monitoring.`);
  if(pendingCatalog(card))throw new Error(`Wait for the source list to finish updating before ${operation} monitoring.`);
  if(typeof card.configuration?.revision!=="string")throw new Error(`Read saved settings before ${operation} monitoring.`);
  const index=monitoringIndex(card,values);
  const selected=[...new Map(values.map(value=>{
    const source=entitySource(index,value);
    if(!source)throw new Error(`Choose entities before ${operation} monitoring.`);
    return [identity(source),source];
  })).values()];
  const byPolicy=new Map();
  for(const source of selected) {
    const state=monitoringState(index,source),affected=mode==="stop"?state.activePolicies:state.excludedPolicies;
    for(const policy of affected) {
      if(!byPolicy.has(policy.id))byPolicy.set(policy.id,new Set());
      byPolicy.get(policy.id).add(state.sourceId);
    }
  }
  const changes=policies(card).filter(policy=>byPolicy.has(policy.id)).map(policy=>{
    const selectedIds=byPolicy.get(policy.id),sourceIds=[...selectedIds].sort(),after=copy(policy);
    const excluded=mode==="stop"?[...new Set([...(policy.excluded_sources||[]),...sourceIds])].sort():(policy.excluded_sources||[]).filter(id=>!selectedIds.has(id));
    if(excluded.length)after.excluded_sources=excluded;else delete after.excluded_sources;
    return {id:policy.id,name:policy.name,enabled:policy.enabled,sourceIds,before:copy(policy),after};
  });
  if(!changes.length)throw new Error(mode==="stop"?"No saved availability policy is currently monitoring the selected entities.":"The selected entities have no availability exclusions to remove.");
  const affectedIds=new Set(changes.flatMap(change=>change.sourceIds));
  const sources=selected.filter(source=>affectedIds.has(identity(source))).map(source=>({id:identity(source),name:source.name,entityId:source.entity_id}));
  return {revision:card.configuration.revision,catalogRevision:card.current.data?.catalog_revision,mode,sourceIds:sources.map(source=>source.id).sort(),sources,changes,
    summary:mode==="stop"?"Stops individual availability checks and device availability contributions in the named policies. Other checks and Home Assistant entities stay enabled.":"Removes these entities’ explicit availability exclusions from the named policies. Each policy’s existing selection, enabled state and eligibility still apply."};
}

/** Apply exactly the reviewed exclusions after confirming the saved result. */
export async function applyAvailabilityChange(card,plan) {
  card.availabilityError=null;
  if(card.current?.status!=="current"||pendingCatalog(card)||card.scopedBusy||card.settingsBusy||card.configBusy) {
    card.availabilityError=`Wait for the current operation and connection before ${plan.mode==="stop"?"stopping":"resuming"} monitoring.`;
    card.render?.();return false;
  }
  const saved=await saveScopedConfiguration(card,scope,plan);
  if(!saved) {
    card.availabilityError=card.scopedError||`Could not ${plan.mode==="stop"?"stop":"resume"} monitoring. Read current saved settings before trying again.`;
    card.render?.();return false;
  }
  const confirmed=plan.changes.every(change=>same(policies(card).find(policy=>policy.id===change.id),change.after));
  if(!confirmed) {
    card.availabilityError="Saved monitoring changed again. Review current policies before continuing.";
    card.render?.();return false;
  }
  card.render?.();return true;
}
