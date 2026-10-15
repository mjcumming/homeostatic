/** Contextual availability changes use the same saved policy exclusions as Policies. */
import {saveScopedConfiguration} from "./scoped-configuration.mjs?v=74";

const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const scope={kind:"source-availability"};
const policies=card=>card.configuration?.settings?.monitoring_policies||[];
const identity=source=>source?.monitoring_source||source?.node_id;
const rows=card=>[...(card.current?.data?.inventory?.catalog?.candidates||[]),...(card.current?.data?.inventory?.nodes||[])];
const pendingCatalog=card=>card.current?.data?.catalog_stale||card.current?.data?.catalog_loaded===false;

function entitySource(card,value) {
  const all=rows(card),selected=typeof value==="string"?all.find(item=>item.node_id===value):value;
  if(!selected||selected.kind!=="entity")return null;
  return all.find(item=>item.node_id===identity(selected)&&!item.monitoring_policy)||selected;
}

/** Describe actual current checks and explicitly saved exclusions for one entity. */
export function availabilityMonitoring(card,value) {
  const source=entitySource(card,value),sourceId=identity(source);
  if(!source)return {sourceId:null,activePolicies:[],excludedPolicies:[],canStop:false,canResume:false};
  const active=new Set();
  for(const check of [...rows(card),...(source.monitoring_checks||[])]) {
    const id=typeof check.monitoring_policy==="string"?check.monitoring_policy:check.monitoring_policy?.id;
    const direct=check.kind==="entity"&&identity(check)===sourceId;
    const member=check.kind==="device"&&source.entity_id&&check.availability_entities?.includes(source.entity_id);
    if(check.watched&&id&&(direct||member))active.add(id);
  }
  const available=policies(card).filter(policy=>policy.check==="availability");
  const activePolicies=available.filter(policy=>policy.enabled&&active.has(policy.id)&&!policy.excluded_sources?.includes(sourceId)).map(({id,name,enabled})=>({id,name,enabled}));
  const excludedPolicies=available.filter(policy=>policy.excluded_sources?.includes(sourceId)).map(({id,name,enabled})=>({id,name,enabled}));
  return {sourceId,activePolicies,excludedPolicies,canStop:activePolicies.length>0,canResume:excludedPolicies.length>0};
}

/** Freeze the exact affected saved policies before displaying confirmation. */
export function prepareAvailabilityChange(card,values,mode="stop") {
  if(!["stop","resume"].includes(mode))throw new Error("Choose whether to stop or resume availability monitoring.");
  if(card.current?.status!=="current")throw new Error("Reconnect before changing availability monitoring.");
  if(pendingCatalog(card))throw new Error("Wait for the source list to finish updating before changing availability monitoring.");
  if(typeof card.configuration?.revision!=="string")throw new Error("Read saved settings before changing availability monitoring.");
  const selected=[...new Map(values.map(value=>{
    const source=entitySource(card,value);
    if(!source)throw new Error("Choose entities whose availability monitoring should change.");
    return [identity(source),source];
  })).values()];
  const byPolicy=new Map();
  for(const source of selected) {
    const state=availabilityMonitoring(card,source),affected=mode==="stop"?state.activePolicies:state.excludedPolicies;
    for(const policy of affected) {
      if(!byPolicy.has(policy.id))byPolicy.set(policy.id,new Set());
      byPolicy.get(policy.id).add(state.sourceId);
    }
  }
  const changes=policies(card).filter(policy=>byPolicy.has(policy.id)).map(policy=>{
    const sourceIds=[...byPolicy.get(policy.id)].sort(),after=copy(policy);
    const excluded=mode==="stop"?[...new Set([...(policy.excluded_sources||[]),...sourceIds])].sort():(policy.excluded_sources||[]).filter(id=>!sourceIds.includes(id));
    if(excluded.length)after.excluded_sources=excluded;else delete after.excluded_sources;
    return {id:policy.id,name:policy.name,enabled:policy.enabled,sourceIds,before:copy(policy),after};
  });
  if(!changes.length)throw new Error(mode==="stop"?"No saved availability policy is currently monitoring the selected entities.":"The selected entities have no availability exclusions to remove.");
  const affectedIds=new Set(changes.flatMap(change=>change.sourceIds));
  const sources=selected.filter(source=>affectedIds.has(identity(source))).map(source=>({id:identity(source),name:source.name,entityId:source.entity_id}));
  return {revision:card.configuration.revision,catalogRevision:card.current.data?.catalog_revision,mode,sourceIds:sources.map(source=>source.id).sort(),sources,changes,
    summary:mode==="stop"?"Stops individual availability checks and device availability contributions in the named policies. Other checks and Home Assistant entities stay enabled.":"Removes these entities’ explicit availability exclusions from the named policies. Each policy’s existing selection, enabled state and eligibility still apply."};
}

/** Apply exactly the reviewed exclusions and retain an inverse after confirmed reload. */
export async function applyAvailabilityChange(card,plan) {
  card.availabilityError=null;card.availabilityNotice=null;
  if(card.current?.status!=="current"||pendingCatalog(card)||card.scopedBusy||card.settingsBusy||card.configBusy) {
    card.availabilityError="Wait for the current operation and connection before changing availability monitoring.";
    card.render?.();return false;
  }
  const saved=await saveScopedConfiguration(card,scope,plan);
  if(!saved) {
    card.availabilityError=card.scopedError||"Availability monitoring was not changed. Read current saved settings before trying again.";
    card.render?.();return false;
  }
  const confirmed=plan.changes.every(change=>same(policies(card).find(policy=>policy.id===change.id),change.after));
  if(!confirmed) {
    card.availabilityError="Saved monitoring changed again. Review current policies before continuing.";
    card.render?.();return false;
  }
  card.availabilityUndo={...copy(plan),revision:card.configuration.revision,changes:plan.changes.map(change=>({...copy(change),before:copy(change.after),after:copy(change.before)}))};
  card.availabilityNotice=plan.mode==="stop"?"Availability monitoring stopped. This does not mean the issue recovered.":"Availability exclusions removed. Existing policy scope and eligibility apply.";
  card.render?.();return true;
}

/** Reverse only the last confirmed operation when its affected policies still match. */
export async function undoAvailabilityChange(card) {
  const previous=card.availabilityUndo;
  if(!previous)return false;
  const saved=await applyAvailabilityChange(card,{...copy(previous),revision:card.configuration?.revision,catalogRevision:card.current?.data?.catalog_revision,mode:"undo"});
  if(saved) {
    card.availabilityUndo=null;card.availabilityNotice="Availability monitoring change undone.";card.render?.();
  }
  return saved;
}
