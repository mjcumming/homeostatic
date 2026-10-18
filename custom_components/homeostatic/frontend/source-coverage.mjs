const emptyCoverage = () => ({monitored:false,direct:false,device:false,labels:[]});
const labelOrder = ["Availability","Entities not provided","Temperature","Thermostat","Battery","Vacuum","UPS","Repairs","Automation","Reported condition","Monitoring"];

function checkLabel(check) {
  if(check.kind==="entity_not_provided")return "Entities not provided";
  if(check.kind==="situation")return "Reported condition";
  return ({availability:"Availability",temperature_limit:"Temperature",thermostat:"Thermostat",battery:"Battery",vacuum:"Vacuum",repair:"Repairs",broken_automation:"Automation",situation:"Reported condition",ups:"UPS"})[check.kind==="ups"?"ups":check.check_id] || ({entity:"Availability",integration:"Availability",temperature_limit:"Temperature",thermostat:"Thermostat",battery:"Battery",vacuum:"Vacuum",repair:"Repairs",broken_automation:"Automation",situation:"Reported condition"})[check.kind] || "Monitoring";
}

function include(map,id,label,{direct=false,device=false,policy=null}={}) {
  if(!id)return;
  if(!map.has(id))map.set(id,{direct:false,device:false,labels:new Set(),policies:new Set()});
  const coverage=map.get(id);
  coverage.direct ||= direct;
  coverage.device ||= device;
  coverage.labels.add(label);
  if(policy)coverage.policies.add(policy);
}

/** Associate actual checks with their sources and explicitly named evidence inputs. */
export function sourceCoverageIndex(data) {
  const inventory=data?.inventory||{};
  const rows=new Map((inventory.catalog?.candidates||[]).map(source=>[source.node_id,source]));
  for(const source of inventory.nodes||[])rows.set(source.node_id,source);
  const disabledSources=new Set([...rows.values()].filter(source=>source.disabled).map(source=>source.node_id));
  const disabledEntities=new Set([...rows.values()].filter(source=>source.kind==="entity"&&source.disabled&&source.entity_id).map(source=>source.entity_id));
  const bySource=new Map(),byEntity=new Map();
  const devices=new Map([...rows.values()].filter(source=>source.kind==="device"&&!source.monitoring_policy).flatMap(source=>(source.attributes?.device||[]).map(id=>[id,source])));
  const checks=[...rows.values()].flatMap(source=>source.disabled?[]:source.monitoring_checks?.length?source.monitoring_checks:[source]);
  for(const check of checks) {
    const sourceId=check.monitoring_source||check.node_id;
    if(check.kind==="device"||!check.watched||check.disabled||disabledSources.has(sourceId)||disabledEntities.has(check.entity_id))continue;
    const label=checkLabel(check);
    const policy=typeof check.monitoring_policy==="string"?check.monitoring_policy:check.monitoring_policy?.id;
    include(bySource,sourceId,label,{direct:true,policy});
    include(bySource,check.node_id,label,{direct:true,policy});
    if(check.kind!=="integration") {
      for(const id of check.attributes?.device||[]) {
        const device=devices.get(id);
        if(device&&!device.disabled)include(bySource,device.node_id,label,{policy});
      }
    }
    if(check.entity_id&&!check.ups_disabled_entities?.includes(check.entity_id))include(byEntity,check.entity_id,label,{direct:true,policy});
    if(check.kind==="battery") {
      for(const entityId of [check.battery_level_entity,check.battery_warning_entity,check.battery_charging_entity]) {
        if(!disabledEntities.has(entityId))include(byEntity,entityId,"Battery",{policy});
      }
    }
    if(check.kind==="ups") {
      const disabled=new Set(check.ups_disabled_entities||[]);
      for(const [,entityId] of check.ups_entities||[]) {
        if(!disabled.has(entityId)&&!disabledEntities.has(entityId))include(byEntity,entityId,"UPS",{policy});
      }
    }
  }
  return {bySource,byEntity};
}

function coverageEntries(source,index) {
  if(!source||source.disabled)return [];
  const entries=[source.node_id,source.monitoring_source,...source.source_aliases||[]].map(id=>index.bySource.get(id)).filter(Boolean);
  if(source.kind==="entity"&&source.entity_id) {
    const entity=index.byEntity.get(source.entity_id);
    if(entity)entries.push(entity);
  }
  return entries;
}

/** Return policies contributing actual checks or named evidence inputs to this source. */
export function sourceCoveragePolicies(source,index) {
  return [...new Set(coverageEntries(source,index).flatMap(entry=>[...entry.policies]))].sort();
}

/** Describe current coverage; auxiliary evidence can be covered without its own check. */
export function sourceCoverage(source,index) {
  if(!source||source.disabled)return emptyCoverage();
  const entries=coverageEntries(source,index);
  const labels=[...new Set(entries.flatMap(entry=>[...entry.labels]))].sort((a,b)=>labelOrder.indexOf(a)-labelOrder.indexOf(b));
  return {monitored:labels.length>0,direct:entries.some(entry=>entry.direct),device:entries.some(entry=>entry.device),labels};
}
