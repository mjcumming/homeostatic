import {escapeHtml as esc} from "./model.mjs?v=90";

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

/** Explain current evidence and link configuration to its owning editor. */
export function upsSourceSummary(card,source,status,hasEpisode) {
  const problem=upsProblem(source,status,hasEpisode);
  const bindings=Object.fromEntries(source.ups_entities||[]);
  const runtime=Number.isFinite(problem.runtime)?"":source.ups_disabled_entities?.includes(bindings.runtime)?`Enable ${bindings.runtime} in Home Assistant to read runtime`:bindings.runtime?"Runtime reading unavailable":"Runtime monitoring is not supported by the discovered entities";
  const link=source.attributes?.device?.[0]?`/config/devices/device/${encodeURIComponent(source.attributes.device[0])}`:null;
  return `<section class="source-condition"><h3>${esc(problem.headline)}</h3><p>${esc(problem.mode)}</p>${problem.readings?`<p>${esc(problem.readings)}</p>`:""}${runtime?`<p class="small">${esc(runtime)}</p>`:""}<p>${source.watched?"Monitoring is on":"Not monitored"}</p></section>${link?`<div class="source-actions"><a class="link" href="${esc(link)}">Open device in Home Assistant</a></div>`:""}`;
}
