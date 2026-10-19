import {escapeHtml as esc} from "./model.mjs?v=100";
import {deviceEntityName} from "./device-entities.mjs?v=100";

export const isTemperatureCheck = source => ["temperature_limit","thermostat"].includes(source.kind);

function duration(seconds) {
  if (seconds === 0) return "0 seconds";
  for(const [size,name] of [[86400,"day"],[3600,"hour"],[60,"minute"],[1,"second"]]) {
    if(seconds%size===0)return `${seconds/size} ${name}${seconds/size===1?"":"s"}`;
  }
  return `${seconds} seconds`;
}

function temperature(value,unit) {
  if(typeof value!=="number"||!Number.isFinite(value))return "";
  return `${Number(value.toFixed(2))} ${unit}`;
}

function reading(evidence) {
  if(typeof evidence.temperature_celsius!=="number")return "";
  const unit=evidence.unit,celsius=evidence.temperature_celsius;
  const value=unit==="°F"?celsius*9/5+32:unit==="K"?celsius+273.15:celsius;
  return temperature(value,unit);
}

/** Keep independent temperature findings visible beside their actual equipment. */
export function sourceTemperature(source,detail) {
  const checks=detail.temperature_checks||[];
  if(!checks.length)return "";
  const linkedSources=new Set();
  const content=checks.map(check=>{
    const observation=check.observation,evidence=observation?.evidence||{};
    const waiting=["temperature_qualifying","thermostat_qualifying"].includes(observation?.reason);
    const status=waiting?"Waiting":!observation||observation.status==="unknown"?"Waiting for a temperature reading":observation.status==="warn"?"Temperature needs attention":"Within limits";
    const prefix=check.source_name+" · "+check.policy_name+": ";
    const message=observation?.message?.startsWith(prefix)?observation.message.slice(prefix.length):observation?.message;
    const values=[reading(evidence),typeof evidence.minimum==="number"?"Minimum "+temperature(evidence.minimum,evidence.unit):"",typeof evidence.maximum==="number"?"Maximum "+temperature(evidence.maximum,evidence.unit):""].filter(Boolean);
    const required=waiting&&typeof evidence.duration_seconds==="number"?`<p>Must remain outside the limits for ${esc(duration(evidence.duration_seconds))}.</p>`:"";
    const next=waiting&&check.next_deadline?`<p class="small">Next evaluation: ${esc(new Date(check.next_deadline).toLocaleString())}</p>`:"";
    const sensorName=source.kind==="device"?esc(deviceEntityName(check.source_name,source.name)):"";
    const sensor=source.kind==="device"?`<p>${linkedSources.has(check.source_id)?sensorName:`<button type="button" class="link" data-source-link="${esc(check.source_id)}">${sensorName}</button>`}</p>`:"";
    linkedSources.add(check.source_id);
    return `<article class="source-temperature-check" data-temperature-check="${esc(check.node_id)}"><h4>${esc(check.policy_name)}</h4>${sensor}<p><strong>${esc(status)}</strong>${message?` — ${esc(message)}`:""}</p>${values.length?`<p>${esc(values.join(" · "))}</p>`:""}${required}${next}</article>`;
  }).join("");
  return `<section class="source-section source-temperature"><h3>Temperature monitoring</h3>${content}</section>`;
}

/** Explain the captured temperature condition without treating an open issue as current evidence. */
export function temperatureProblem(source, status, captured = null, openProblem = true) {
  if (!source || !isTemperatureCheck(source)) return null;
  const observation = captured ? captured.observation : status?.current;
  const reason = observation?.reason;
  const headlines = {
    temperature_low:"Temperature below minimum", temperature_high:"Temperature above maximum",
    temperature_qualifying:"Waiting for the temperature limit duration",
    thermostat_stalled:"Temperature is not reaching the target", thermostat_worsening:"Temperature is moving away from the target",
    thermostat_qualifying:"Watching temperature progress",
    temperature_in_range:openProblem ? "Temperature back within limits" : "Temperature within limits",
    thermostat_in_margin:"Temperature within the target margin",
    thermostat_target_satisfied:"Updated target is satisfied",
  };
  const headline = headlines[reason] || "Waiting for a temperature reading";
  const prefix = source.name + ": ";
  const message = observation?.message || "";
  const summary = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const evidence = observation?.evidence || {};
  const known = Object.hasOwn(headlines,reason);
  const limits = source.kind === "temperature_limit" && known
    ? [typeof evidence.minimum === "number" ? "Minimum " + temperature(evidence.minimum,evidence.unit) : "",
      typeof evidence.maximum === "number" ? "Maximum " + temperature(evidence.maximum,evidence.unit) : ""].filter(Boolean) : [];
  const observed = known && typeof evidence.observed_seconds === "number" && Number.isFinite(evidence.observed_seconds) && evidence.observed_seconds >= 0
    ? (source.kind === "temperature_limit" ? "Observed outside limits for " : "Progress observed for ") + duration(Math.floor(evidence.observed_seconds)) : "";
  const required = known && typeof evidence.duration_seconds === "number" && Number.isFinite(evidence.duration_seconds)
    ? "Required duration: " + duration(evidence.duration_seconds) : "";
  return {headline,summary:summary || "No usable current temperature reading is available.",
    timing:observed,detail:[...limits,required].filter(Boolean).join(". "),currentReason:reason};
}
