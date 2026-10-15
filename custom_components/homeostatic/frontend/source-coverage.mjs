const emptyCoverage = () => ({monitored:false,direct:false,device:false,labels:[]});
const labelOrder = ["Availability","Device availability","Temperature","Thermostat","Battery","Vacuum","UPS","Repairs","Automation","Reported condition","Monitoring"];

function checkLabel(check) {
  if(check.kind==="situation")return "Reported condition";
  if(check.kind==="device"&&(!check.check_id||check.check_id==="availability"))return "Device availability";
  return ({availability:"Availability",temperature_limit:"Temperature",thermostat:"Thermostat",battery:"Battery",vacuum:"Vacuum",repair:"Repairs",broken_automation:"Automation",situation:"Reported condition",ups:"UPS"})[check.kind==="ups"?"ups":check.check_id] || ({entity:"Availability",integration:"Availability",temperature_limit:"Temperature",thermostat:"Thermostat",battery:"Battery",vacuum:"Vacuum",repair:"Repairs",broken_automation:"Automation",situation:"Reported condition"})[check.kind] || "Monitoring";
}

function include(map,id,label,{direct=false,device=false}={}) {
  if(!id)return;
  if(!map.has(id))map.set(id,{direct:false,device:false,labels:new Set()});
  const coverage=map.get(id);
  coverage.direct ||= direct;
  coverage.device ||= device;
  coverage.labels.add(label);
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
    if(!check.watched||check.disabled||disabledSources.has(sourceId)||disabledEntities.has(check.entity_id))continue;
    const label=checkLabel(check);
    include(bySource,sourceId,label,{direct:true});
    include(bySource,check.node_id,label,{direct:true});
    if(["temperature_limit","thermostat"].includes(check.kind)) {
      for(const id of check.attributes?.device||[]) {
        const device=devices.get(id);
        if(device&&!device.disabled)include(bySource,device.node_id,label);
      }
    }
    if(check.entity_id&&!check.ups_disabled_entities?.includes(check.entity_id))include(byEntity,check.entity_id,label,{direct:true});
    if(check.kind==="device") {
      for(const entityId of check.availability_entities||[]) {
        if(!disabledEntities.has(entityId))include(byEntity,entityId,"Device availability",{device:true});
      }
    }
    if(check.kind==="battery") {
      for(const entityId of [check.battery_level_entity,check.battery_warning_entity,check.battery_charging_entity]) {
        if(!disabledEntities.has(entityId))include(byEntity,entityId,"Battery");
      }
    }
    if(check.kind==="ups") {
      const disabled=new Set(check.ups_disabled_entities||[]);
      for(const [,entityId] of check.ups_entities||[]) {
        if(!disabled.has(entityId)&&!disabledEntities.has(entityId))include(byEntity,entityId,"UPS");
      }
    }
  }
  return {bySource,byEntity};
}

/** Describe current coverage; auxiliary evidence can be covered without its own check. */
export function sourceCoverage(source,index) {
  if(!source||source.disabled)return emptyCoverage();
  const entries=[source.node_id,source.monitoring_source,...source.source_aliases||[]].map(id=>index.bySource.get(id)).filter(Boolean);
  if(source.kind==="entity"&&source.entity_id) {
    const entity=index.byEntity.get(source.entity_id);
    if(entity)entries.push(entity);
  }
  const labels=[...new Set(entries.flatMap(entry=>[...entry.labels]))].sort((a,b)=>labelOrder.indexOf(a)-labelOrder.indexOf(b));
  return {monitored:labels.length>0,direct:entries.some(entry=>entry.direct),device:entries.some(entry=>entry.device),labels};
}
