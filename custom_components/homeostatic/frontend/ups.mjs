import {escapeHtml as esc, sourceMap} from "./model.mjs?v=70";

export const UPS_CHECK_NAMES = {
  ups_power:"Backup power", ups_reserve:"Low reserve",
  ups_battery_replacement:"Battery replacement", ups_fault:"UPS fault",
};

/** Describe reported UPS conditions without inferring household power wiring. */
export function upsProblem(source,status,hasEpisode=true) {
  if(source?.kind!=="ups")return null;
  const observation=status?.ups||status;
  const reason=status?.current?.reason||observation?.reason;
  const evidence=observation?.evidence||{};
  const readings=evidence.readings||{};
  const mode=evidence.power_mode;
  const normal=observation?.status==="pass";
  const headline=hasEpisode&&normal?"Confirming recovery":status?.current?.message||observation?.message||"UPS evidence needs review";
  const numbers=[];
  if(Number.isFinite(readings.charge))numbers.push(`${Math.round(readings.charge)}% battery`);
  if(Number.isFinite(readings.runtime))numbers.push(`estimated runtime ${Math.round(readings.runtime*10)/10} minutes`);
  const nextStep=source.check_id==="ups_battery_replacement"?"Check the UPS battery replacement instructions.":source.check_id==="ups_fault"?"Check the UPS panel and its reported fault.":source.check_id==="ups_reserve"&&mode==="backup"?"Check remaining reserve and prepare the affected equipment for a controlled shutdown.":source.check_id==="ups_reserve"?"Check charging and reserve recovery.":"Check the UPS mains input and remaining reserve.";
  const recovery={ups_power:"Ends when mains operation is confirmed.",ups_reserve:"Ends when every monitored reserve signal reaches its recovery threshold and the UPS low warning clears.",ups_battery_replacement:"Ends when the UPS replacement warning clears.",ups_fault:"Ends when every monitored fault signal reports normal."}[source.check_id];
  const device=source.attributes?.device?.[0];
  return {headline,context:"UPS",tone:normal?(hasEpisode?"recovering":"neutral"):reason==="ups_evidence_missing"?"uncertain":"failure",currentReason:reason,nextStep,deviceUrl:device?`/config/devices/device/${encodeURIComponent(device)}`:null,summary:[numbers.join(" · "),recovery].filter(Boolean).join(" "),
    readings:numbers.join(" · "),mode:mode==="backup"?"Running on backup power":mode==="mains"?"Mains power reported":"Power mode unknown",
    runtime:readings.runtime,condition:UPS_CHECK_NAMES[source.check_id]||"UPS condition"};
}

/** Group presentation while retaining condition-specific issue controls. */
export function groupedUpsIssues(data,episodes,renderIssue) {
  const sources=sourceMap(data),groups=new Map(),items=[];
  for(const episode of episodes) {
    const source=sources.get(episode.anchor);
    if(source?.kind!=="ups"){items.push({episode});continue;}
    const device=source.attributes?.device?.[0]||source.node_id;
    if(!groups.has(device)){const group={device,name:source.ups_name||source.name,episodes:[]};groups.set(device,group);items.push(group);}
    groups.get(device).episodes.push(episode);
  }
  const priority=episode=>{
    const observed=data.inventory.ups_status?.[episode.anchor];
    if(observed?.status==="pass")return 5;
    if(observed?.status==="unknown")return 4;
    const reason=observed?.reason;
    const check=sources.get(episode.anchor)?.check_id;
    return check==="ups_fault"||reason==="ups_reserve_critical"?0:check==="ups_power"?1:check==="ups_reserve"?2:3;
  };
  return items.map(item=>{
    if(item.episode)return renderIssue(item.episode);
    const ordered=[...item.episodes].sort((a,b)=>priority(a)-priority(b)||a.opened_at.localeCompare(b.opened_at));
    const lead=ordered[0],source=sources.get(lead.anchor),problem=upsProblem(source,data.inventory.ups_status?.[lead.anchor]);
    const others=ordered.slice(1).map(episode=>{const condition=UPS_CHECK_NAMES[sources.get(episode.anchor)?.check_id],status=data.inventory.ups_status?.[episode.anchor]?.status;return condition?condition+(status==="pass"?" · confirming recovery":status==="unknown"?" · current evidence missing":""):null;}).filter(Boolean);
    return `<article class="ups-issue-group" data-ui-key="ups:${esc(item.device)}"><header><h3>${esc(item.name)}</h3><span class="small">${ordered.length} open ${ordered.length===1?"issue":"issues"}</span></header><p><strong>${esc(problem.headline)}</strong></p>${problem.readings?`<p>${esc(problem.readings)}</p>`:""}${others.length?`<p class="small">${esc(others.join(" · "))}</p>`:""}<details data-ui-key="ups-conditions:${esc(item.device)}"><summary>View issues</summary>${ordered.map(renderIssue).join("")}</details></article>`;
  }).join("");
}

/** Explain current evidence and link configuration to its owning editor. */
export function upsSourceSummary(card,source,status,hasEpisode) {
  const problem=upsProblem(source,status,hasEpisode);
  const bindings=Object.fromEntries(source.ups_entities||[]);
  const runtime=Number.isFinite(problem.runtime)?"":source.ups_disabled_entities?.includes(bindings.runtime)?`Enable ${bindings.runtime} in Home Assistant to read runtime`:bindings.runtime?"Runtime reading unavailable":"Runtime monitoring is not supported by the discovered entities";
  const link=source.attributes?.device?.[0]?`/config/devices/device/${encodeURIComponent(source.attributes.device[0])}`:null;
  return `<section class="source-condition"><h3>${esc(problem.headline)}</h3><p>${esc(problem.mode)}</p>${problem.readings?`<p>${esc(problem.readings)}</p>`:""}${runtime?`<p class="small">${esc(runtime)}</p>`:""}<p>${source.watched?"Monitoring is on":"Not monitored"}</p></section><div class="source-actions"><button type="button" class="link" data-page="policies">View monitoring policies</button>${link?`<a class="link" href="${esc(link)}">Open device in Home Assistant</a>`:""}</div>`;
}
