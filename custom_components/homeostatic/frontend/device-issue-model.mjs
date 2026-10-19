import {inventoryRows,visibleEpisodes} from "./model.mjs?v=102";

const deviceKinds=new Set(["device","entity","battery","vacuum","ups","temperature_limit","thermostat"]);
const canonicalSource=(source,sources)=>source?.monitoring_source?sources.get(source.monitoring_source):source;

function owningDevice(episode,sources) {
  const ids=[...new Set([episode.anchor,...episode.recorded||[],...(episode.reasons||[]).map(finding=>finding.node_id)].filter(Boolean))];
  if(!ids.length)return null;
  let owner=null;
  for(const id of ids) {
    const source=canonicalSource(sources.get(id),sources),devices=source?.attributes?.device||[];
    if(!source||!deviceKinds.has(source.kind)||devices.length!==1||!devices[0])return null;
    if(owner&&owner!==devices[0])return null;
    owner=devices[0];
  }
  return owner;
}

/** Resolve the entire issue's current registry ownership, never names or impact. */
export function issueDeviceId(data,episode,sources=new Map(inventoryRows(data).map(source=>[source.node_id,source]))) {
  if(!episode)return null;
  return owningDevice(episode,sources);
}

/** Keep independent current findings wholly owned by one registry device together. */
export function relatedDeviceIssues(data,deviceId) {
  if(!deviceId)return [];
  const sources=new Map(inventoryRows(data).map(source=>[source.node_id,source]));
  const found=new Map();
  for(const episode of visibleEpisodes(data)) {
    if(!episode.episode_id||owningDevice(episode,sources)!==deviceId)continue;
    const source=sources.get(episode.anchor);
    if(source)found.set(episode.episode_id,{episode,source,canonicalSource:canonicalSource(source,sources)});
  }
  return [...found.values()].sort((a,b)=>(a.canonicalSource.kind==="device"?0:1)-(b.canonicalSource.kind==="device"?0:1)||a.canonicalSource.name.localeCompare(b.canonicalSource.name)||a.episode.episode_id.localeCompare(b.episode.episode_id));
}
