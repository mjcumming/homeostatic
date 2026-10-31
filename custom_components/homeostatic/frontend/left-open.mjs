import {escapeHtml as esc} from "./model.mjs?v=115";

const attr=(id,field)=>`data-definition-kind="policies" data-definition-id="${esc(id)}" data-definition-field="parameters:${esc(field)}"`;
const field=(id,key,label,value,type="text",extra="")=>`<label class="installation-field"><span>${label}</span><input ${attr(id,key)} type="${type}" value="${esc(value??"")}" ${extra}></label>`;
const choice=(value,label,current)=>`<option value="${esc(value)}"${value===current?" selected":""}>${esc(label)}</option>`;
const timeText=value=>value||"the end of monitoring hours";

export function leftOpenValidation(policy) {
  const p=policy.parameters||{};
  if(!Number.isInteger(p.duration_seconds)||p.duration_seconds<0||p.duration_seconds>31536000)return {field:"duration_seconds",message:"Choose an open duration from 0 to 365 days, in whole seconds."};
  if(Boolean(p.start)!==Boolean(p.end)||p.start&&p.start===p.end)return {field:"end",message:"Choose different start and end times, or monitor Always."};
  if(p.use_temperature) {
    if(!p.temperature_source)return {field:"temperature_source",message:"Choose an outdoor temperature source."};
    if(p.minimum==null&&p.maximum==null)return {field:"minimum",message:"Enter a Below limit, an Above limit, or both."};
    for(const key of ["minimum","maximum"])if(p[key]!=null&&(typeof p[key]!=="number"||!Number.isFinite(p[key])))return {field:key,message:"Enter a finite temperature."};
    if(p.minimum!=null&&p.maximum!=null&&p.minimum>p.maximum)return {field:"maximum",message:"Above must be greater than or equal to Below."};
  }
  return null;
}

export function leftOpenSummary(policy) {
  const p=policy.parameters||{};
  if(p.duration_seconds==null)return "Choose the allowed open duration before enabling this policy.";
  const duration=p.duration_seconds,unit=duration&&duration%3600===0?"hour":duration%60===0?"minute":"second",amount=duration/(unit==="hour"?3600:unit==="minute"?60:1),count=`${amount} ${unit}${amount===1?"":"s"}`;
  const limits=[p.minimum!=null?`below ${p.minimum}${p.unit}`:"",p.maximum!=null?`above ${p.maximum}${p.unit}`:""].filter(Boolean).join(" or ");
  return `Open an issue when a selected opening stays open ${p.duration_seconds?`for ${count}`:"without waiting"}${p.use_temperature?` while outdoor temperature is ${limits||"outside your limits"}`:""}${p.start?`, from ${p.start} to ${p.end}`:""}.`;
}

export function leftOpenFields(card,policy) {
  const {id,parameters:p}=policy;
  const invalid=key=>card.editors.policyValidation?.id===id&&card.editors.policyValidation.field===key?`aria-invalid="true" aria-describedby="policy-error-${esc(id)}"`:"";
  const daily=Boolean(p.start||p.end);
  const candidates=card.current?.data?.inventory?.catalog?.candidates||[];
  const eligible=candidates.filter(source=>!source.disabled&&source.kind==="entity"&&(source.attributes?.domain?.includes("weather")||source.attributes?.domain?.includes("sensor")&&source.attributes?.device_class?.includes("temperature")));
  const options=new Map(eligible.map(source=>[source.attributes.entity?.[0],source.name]).filter(([ref])=>ref));
  const saved=p.temperature_source;
  if(saved&&!options.has(saved))options.set(saved,"Saved temperature source — currently unavailable");
  const timezone=card._hass?.config?.time_zone||card.editors.configuration.settings.notification_definitions?.timezone||"Home Assistant time zone";
  const temperature=p.use_temperature?`<div class="left-open-temperature"><label class="installation-field"><span>Outdoor temperature source</span><select ${attr(id,"temperature_source")} ${invalid("temperature_source")}>${choice("","Choose a temperature source…",saved||"")}${[...options].sort((a,b)=>a[1].localeCompare(b[1])).map(([value,name])=>choice(value,name,saved)).join("")}</select></label><div class="policy-temperature-unit">${`<label class="installation-field"><span>Temperature unit</span><select ${attr(id,"unit")}>${["°F","°C","K"].map(unit=>choice(unit,unit,p.unit||"°F")).join("")}</select></label>`}</div><div class="policy-limits">${field(id,"minimum","Below (optional)",p.minimum,"number",`step="any" ${invalid("minimum")}`)}${field(id,"maximum","Above (optional)",p.maximum,"number",`step="any" ${invalid("maximum")}`)}</div><p class="small policy-help">A temperature within your limits resets an unfinished countdown. Temperature changes cannot end an open issue.</p></div>`:"";
  return `<fieldset class="left-open-hours"><legend>Monitoring hours</legend>${[["always","Always"],["daily","During these hours each day"]].map(([value,label])=>`<label class="left-open-hours-choice"><input type="radio" name="left-open-hours-${esc(id)}" ${attr(id,"monitoring_hours")} data-definition-value="${value}" value="${value}"${(daily?"daily":"always")===value?" checked":""}><span>${label}</span></label>`).join("")}${daily?`<div class="policy-limits left-open-times">${field(id,"start","Start",p.start,"time",`required ${invalid("start")}`)}${field(id,"end","End",p.end,"time",`required ${invalid("end")}`)}</div><p class="small policy-help">Home Assistant time zone: ${esc(timezone)}. Each window starts a fresh countdown.</p>`:""}</fieldset><div class="left-open-temperature-choice"><label class="installation-toggle"><input type="checkbox" ${attr(id,"use_temperature")}${p.use_temperature?" checked":""}>Use outdoor temperature</label>${temperature}</div>`;
}

export function leftOpenProblem(source,status) {
  if(source?.kind!=="left_open")return null;
  const observation=status?.current,e=observation?.evidence||{},reason=observation?.reason;
  const names={left_open:"Door or window left open",left_open_waiting:"Waiting for the allowed open interval",left_open_closed:"Opening reported closed",left_open_outside_hours:"Outside monitoring hours",left_open_temperature_in_range:"Outdoor temperature within limits",left_open_contact_missing:"Waiting for opening state",left_open_temperature_missing:"Waiting for outdoor temperature"};
  return {headline:names[reason]||"Waiting for opening information",summary:observation?.message||"No current opening report is available.",nextStep:reason==="left_open"?"Inspect and close this opening.":"",tone:reason==="left_open"?"failure":observation?.status==="unknown"?"uncertain":"neutral",progress:reason==="left_open"?"Needs attention":reason==="left_open_waiting"?"Waiting":"",detail:e.window_end?`Monitoring and notifications end at ${new Date(e.window_end).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}.`:"",currentReason:reason};
}

export function sourceOpenings(source,detail) {
  const checks=detail.opening_checks||[];
  if(!checks.length)return "";
  return `<section class="source-section"><h3>Left-open monitoring</h3>${checks.map(check=>{
    const problem=leftOpenProblem({kind:"left_open"},{current:check.observation});
    return `<article class="source-temperature-check"><h4>${esc(check.policy_name)}</h4>${source.kind==="device"?`<p>${esc(check.source_name)}</p>`:""}<p><strong>${esc(problem.headline)}</strong></p><p>${esc(problem.summary)}</p>${problem.detail?`<p class="small">${esc(problem.detail)}</p>`:""}</article>`;
  }).join("")}</section>`;
}

export const leftOpenEndText=policy=>policy.parameters?.end?`Closing an opening ends its issue. At ${timeText(policy.parameters.end)}, monitoring ends and all alerts and reminders stop.`:"Closing an opening ends its issue.";
