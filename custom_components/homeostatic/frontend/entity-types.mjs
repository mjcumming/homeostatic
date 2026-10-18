/** Metadata selections remain rules for current and future entities. */
const DOMAIN_NAMES={alarm_control_panel:"Alarm panels",binary_sensor:"Binary sensors",button:"Buttons",camera:"Cameras",climate:"Thermostats",cover:"Covers",fan:"Fans",light:"Lights",lock:"Locks",media_player:"Media players",sensor:"Sensors",switch:"Switches",vacuum:"Vacuums"};
const BINARY_CLASSES={battery:"Battery",battery_charging:"Battery charging",carbon_monoxide:"Carbon monoxide",cold:"Cold",connectivity:"Connectivity",door:"Door",garage_door:"Garage door",gas:"Gas",heat:"Heat",light:"Light",lock:"Lock",moisture:"Moisture",motion:"Motion",moving:"Moving",occupancy:"Occupancy",opening:"Opening",plug:"Plug",power:"Power",presence:"Presence",problem:"Problem",running:"Running",safety:"Safety",smoke:"Smoke",sound:"Sound",tamper:"Tamper",update:"Update",vibration:"Vibration",window:"Window"};
const human=value=>value.replaceAll("_"," ").replace(/^./,letter=>letter.toUpperCase());
export const metadataSelectionField=mode=>mode==="types_except"?"match_none":"match_any";
export function selectedEntityTypes(policy,mode) {
  return (policy[metadataSelectionField(mode)]||[]).flatMap(match=>(match.domain||[]).flatMap(domain=>match.device_class?.length?match.device_class.map(deviceClass=>`${domain}:${deviceClass}`):[domain]));
}
export function entityTypeMatches(values) {
  return values.map(value=>{const [domain,deviceClass]=value.split(":");return {domain:[domain],...(deviceClass?{device_class:[deviceClass]}:{})};});
}
export function entityTypeChoices(sources,selected=[]) {
  const ids=new Set([...Object.keys(DOMAIN_NAMES),...Object.keys(BINARY_CLASSES).map(value=>`binary_sensor:${value}`),...selected]);
  for(const source of sources)for(const domain of source.attributes?.domain||[]) {
    ids.add(domain);
    for(const deviceClass of source.attributes?.device_class||[])ids.add(`${domain}:${deviceClass}`);
  }
  return [...ids].map(id=>{
    const [domain,deviceClass]=id.split(":");
    return {id,name:deviceClass?`${domain==="binary_sensor"?BINARY_CLASSES[deviceClass]||human(deviceClass):human(deviceClass)} · ${DOMAIN_NAMES[domain]||human(domain)}`:`All ${DOMAIN_NAMES[domain]?.toLocaleLowerCase()||human(domain)}`,group:deviceClass?"By device class":"By entity type"};
  }).sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name));
}
