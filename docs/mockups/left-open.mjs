import {styles} from "../../custom_components/homeostatic/frontend/styles.mjs";

const sources = [
  {id:"front", name:"Front door", area:"Entry · Ground floor"},
  {id:"patio", name:"Patio door", area:"Kitchen · Ground floor"},
  {id:"kitchen", name:"Kitchen window", area:"Kitchen · Ground floor"},
  {id:"bedroom", name:"Bedroom window", area:"Bedroom · Upstairs"},
];
const temperatureSources = [
  {id:"probe", name:"Garden temperature", detail:"Garden · Temperature sensor", fahrenheit:43},
  {id:"weather", name:"Home weather", detail:"Current outdoor temperature", fahrenheit:45},
];
const initialPolicy = {name:"Overnight openings", enabled:true, sources:["kitchen","patio"], durationSeconds:600, hours:"daily", start:"22:00", end:"07:00", useTemperature:true, temperatureSource:"probe", unit:"°F", below:50, above:null, notification:"acknowledge"};
const notifications = {
  acknowledge:{name:"Immediate with acknowledgment", mode:"acknowledge", reminder:30, destination:"Household phones"},
  immediate:{name:"Immediate", mode:"immediate", reminder:30, destination:"Household phones"},
  morning:{name:"Morning summary", mode:"report", reminder:30, destination:"Household phones"},
};
let saved = structuredClone(initialPolicy);
let draft = {...structuredClone(initialPolicy), durationSeconds:300};
let durationUnit = "minutes", search = "", sending = false, view = "editor", errors = {}, selectedNotification = "acknowledge", notificationDraft = null;
const host = document.querySelector("left-open-preview"), root = host.attachShadow({mode:"open"});
const esc = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const checked = value => value ? " checked" : "";
const option = (id,label,current) => `<option value="${esc(id)}"${id===current?" selected":""}>${esc(label)}</option>`;
const dirty = () => JSON.stringify(draft)!==JSON.stringify(saved);
const formatTime = value => {const [hours,minutes]=value.split(":").map(Number); return `${hours%12||12}:${String(minutes).padStart(2,"0")} ${hours<12?"AM":"PM"}`;};
const durationScale = () => ({seconds:1,minutes:60,hours:3600}[durationUnit]);
const durationText = () => draft.durationSeconds===0 ? "without waiting" : `for ${draft.durationSeconds%3600===0?draft.durationSeconds/3600+" hour"+(draft.durationSeconds===3600?"":"s"):draft.durationSeconds%60===0?draft.durationSeconds/60+" minute"+(draft.durationSeconds===60?"":"s"):draft.durationSeconds+" seconds"}`;
const temperatureText = () => [draft.below!==null?`below ${draft.below}${draft.unit}`:"",draft.above!==null?`above ${draft.above}${draft.unit}`:""].filter(Boolean).join(" or ");
const ruleText = () => `Open an issue when a selected door or window stays open ${durationText()}${draft.useTemperature?` while outdoor temperature is ${temperatureText()||"outside your limits"}`:""}${draft.hours==="daily"?`, between ${formatTime(draft.start)} and ${formatTime(draft.end)}`:""}.`;
const notificationWhen = item => item.mode==="acknowledge"?`Immediately; repeat every ${item.reminder} minutes until acknowledged`:item.mode==="report"?"Daily at 8:00 AM":"Immediately, including overnight";
const status = message => {document.querySelector("#preview-status").textContent=message;};

const localStyles = `
  :host{--hs-blue:#007299;--hs-muted:#526674;--hs-border:#dce4e9;--hs-card:#fff;--primary-text-color:#182a34;--secondary-text-color:#526674;--secondary-background-color:#edf2f5;--primary-color:#007299;--error-color:#b3261e;color:var(--primary-text-color);font:16px/1.5 Roboto,Arial,sans-serif}
  :host([dark]){--hs-blue:#57c5ef;--hs-muted:#b2bec9;--hs-border:#41505c;--hs-card:#18232d;--primary-text-color:#e4e8ec;--secondary-text-color:#b2bec9;--secondary-background-color:#263744;--primary-color:#57c5ef;--error-color:#ffb4ab;color-scheme:dark}
  *,*::before,*::after{box-sizing:border-box} .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0} [hidden]{display:none!important} button,input,select{font:inherit;color:inherit} button{cursor:pointer} button:disabled{opacity:.55;cursor:default}
  input,select{background:var(--hs-card);border:1px solid var(--hs-border);border-radius:6px;padding:9px 12px;accent-color:var(--hs-blue);caret-color:var(--hs-blue)} input[type=checkbox]{padding:0;width:20px;height:20px;flex:none} :focus-visible{outline:2px solid var(--hs-blue);outline-offset:3px} ::selection{background:var(--hs-blue);color:var(--hs-card)}
  .app-header{background:var(--hs-card);border-bottom:1px solid var(--hs-border);position:sticky;top:0;z-index:5} .app-title-row{display:flex;align-items:center;gap:28px;padding:18px 24px 10px;flex-wrap:wrap} .app-title{font-size:20px;font-weight:500} .global-switch{display:flex;align-items:center;gap:10px;font-size:14px;min-height:44px}.method-switch input{width:44px;height:26px}.app-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:0 16px}.app-tabs button{background:none;border:0;border-bottom:3px solid transparent;border-radius:6px 6px 0 0;padding:12px 16px;min-height:48px;font-size:15px}.app-tabs button[aria-current=page]{border-bottom-color:var(--hs-blue);background:color-mix(in srgb,var(--hs-blue) 11%,var(--hs-card));font-weight:600}.app-tabs button:hover{background:var(--secondary-background-color)}
  main{max-width:812px;margin:24px auto;padding:0 12px}.paper{background:var(--hs-card);border:1px solid var(--hs-border);border-radius:12px;padding:24px}.definition-editor{border:0;padding:0}.unified-policy-editor{max-width:none}.unified-policy-editor>header{margin-bottom:24px}.unified-policy-editor>header>div{flex-basis:260px}.unified-policy-editor>header h1{font-size:24px;font-weight:500}.small{font-size:13px;color:var(--hs-muted)}p{margin:8px 0 0}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--hs-border);border-radius:6px;padding:8px 16px;background:var(--hs-card);color:inherit;font-size:14px;text-decoration:none}.button:hover{background:var(--secondary-background-color)}.button.primary{background:var(--hs-blue);color:var(--hs-card);border-color:var(--hs-blue);font-weight:500}.text-button{background:none;border:0;color:var(--hs-blue);padding:8px 0;min-height:44px;text-align:left;font-size:14px}.text-button:hover{text-decoration:underline;text-underline-offset:3px}.return{margin-bottom:12px}
  .policy-section h2{font-size:16px;font-weight:500;margin:0 0 16px}.policy-section{border-top:1px solid var(--hs-border);padding-top:20px;margin-top:24px}.source-toolbar{display:flex;align-items:center;gap:16px}.source-toolbar input{width:100%;min-height:44px;min-width:0}.source-toolbar span{white-space:nowrap;font-size:13px;color:var(--hs-muted)}.source-selection-list{margin:12px 0 0}.contact-row{display:flex;gap:14px;align-items:center;min-height:58px;border-bottom:1px solid var(--hs-border);padding:9px 0;cursor:pointer}.contact-row:last-child{border:0}.contact-copy{display:grid;gap:2px}.contact-copy small{font-size:13px;color:var(--hs-muted)}.empty-search{padding:16px 0;color:var(--hs-muted)}
  .condition-duration{margin:0;max-width:372px;grid-template-columns:repeat(2,minmax(0,1fr))}.condition-block{margin-top:24px}.condition-block h3{font-size:14px;font-weight:500;margin:0 0 10px}.condition-block>.installation-field{max-width:372px}.hours-grid{display:grid;grid-template-columns:1fr 1fr;max-width:372px;gap:12px;margin-top:16px}.hours-note{font-size:13px;color:var(--hs-muted);margin-top:8px}.temperature-toggle{display:flex;align-items:center;gap:12px;min-height:44px;cursor:pointer}.temperature-fields{margin-top:12px}.temperature-fields>.installation-field{max-width:480px}.temperature-limits{display:grid;grid-template-columns:1fr 1fr 100px;gap:12px;margin-top:16px;max-width:480px}.temperature-note{font-size:13px;color:var(--hs-muted);max-width:65ch;margin-top:10px}.policy-rule{border:0;border-radius:6px;padding:14px 16px;background:var(--secondary-background-color);font-size:14px;margin-top:24px;line-height:1.6}.rule-end{margin-top:6px}.notification-row{padding-bottom:12px}.policy-notification-status{font-size:14px;margin-bottom:16px}.policy-notification-facts{font-size:14px;margin-top:10px}.policy-notification-facts>div{grid-template-columns:60px 1fr}.policy-notification-controls .installation-field{max-width:420px!important}.notification-actions{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:10px}.notification-cutoff{font-size:13px;color:var(--hs-muted)}
  #save-footer{min-height:96px}#save-footer:empty{min-height:0}.sticky-save{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(786px,calc(100% - 26px));z-index:6;background:var(--hs-card);border:1px solid var(--hs-border);border-bottom:0;margin:0;padding:14px 24px 18px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;gap:12px}.sticky-save .actions{display:flex;gap:8px}.field-error{font-size:13px;color:var(--error-color);margin-top:6px}.form-error{color:var(--error-color);font-size:14px;margin-bottom:16px}.installation-field [aria-invalid=true]{border-color:var(--error-color)!important}.policy-list h1,.shared-editor h1,.behavior h1{font-size:24px;font-weight:500;margin:0 0 16px}.list-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 0;border-bottom:1px solid var(--hs-border)}.list-row h2{font-size:16px;font-weight:500;margin:0}.list-row p{font-size:14px;color:var(--hs-muted)}.shared-editor .installation-field{display:grid;gap:8px;margin:20px 0;max-width:480px}.shared-editor input,.shared-editor select{min-height:44px;width:100%}.shared-editor .actions{margin-top:24px;display:flex;gap:8px}.shared-editor>p{max-width:65ch}
  .behavior{max-width:760px}.behavior>p{max-width:65ch}.example-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.example-summary{margin:24px 0 0;padding:16px 0;border-block:1px solid var(--hs-border)}.example-summary h2{font-size:18px;margin:0 0 8px;font-weight:500}.example-summary dl{display:grid;grid-template-columns:140px 1fr;gap:8px 16px;margin:16px 0}.example-summary dt{color:var(--hs-muted);font-size:14px}.example-summary dd{margin:0}.example-timeline{padding:0;list-style:none;margin:0}.example-timeline li{display:grid;grid-template-columns:100px 1fr;gap:16px;padding:14px 0;border-bottom:1px solid var(--hs-border);font-size:14px}.example-timeline time{font-variant-numeric:tabular-nums;color:var(--hs-muted)}.example-timeline li:last-child{border:0}.behavior .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
  @media(max-width:600px){main{margin:16px auto;padding:0 12px}.paper{padding:20px}.app-title-row{padding:12px 16px 6px;gap:8px 24px}.app-tabs{padding:0 8px;gap:0}.app-tabs button{padding:10px 12px;font-size:14px}#save-footer{min-height:112px}.sticky-save{margin:0;padding:12px 16px 16px;flex-wrap:wrap;gap:8px}.sticky-save>.small{font-size:12px}.sticky-save .actions{margin-left:auto}.sticky-save .button{padding-inline:12px}.policy-identity{grid-template-columns:1fr;gap:14px}.unified-policy-editor>header{gap:8px;margin-bottom:20px}.unified-policy-editor>header>div{flex-basis:100%}.unified-policy-editor>header h1{font-size:22px}.source-toolbar{gap:10px}.temperature-limits{grid-template-columns:1fr 1fr}.temperature-limits>.installation-field:last-child{grid-column:1/-1;max-width:120px}.policy-notification-controls{flex-wrap:wrap;gap:8px}.policy-notification-controls .installation-field{flex-basis:100%}.policy-notification-controls>.button{margin-left:auto}.notification-actions{align-items:flex-start;flex-wrap:wrap;gap:0}.list-row{align-items:flex-start;flex-wrap:wrap}.example-summary dl{grid-template-columns:104px 1fr}.example-timeline li{grid-template-columns:76px 1fr;gap:12px}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
`;

function field(id,label,value,type="text",extra="") {
  return `<label class="installation-field" for="${id}"><span>${label}</span><input id="${id}" data-field="${id}" type="${type}" value="${esc(value)}" ${extra}${errors[id]?` aria-invalid="true" aria-describedby="error-${id}"`:""}>${errors[id]?`<span class="field-error" id="error-${id}">${errors[id]}</span>`:""}</label>`;
}
function sourceRows() {
  const visible=sources.filter(source=>`${source.name} ${source.area}`.toLowerCase().includes(search.toLowerCase()));
  return visible.map(source=>`<li><label class="contact-row"><input type="checkbox" data-source="${source.id}"${checked(draft.sources.includes(source.id))}><span class="contact-copy"><span>${source.name}</span><small>${source.area}</small></span></label></li>`).join("")||'<li class="empty-search">No matching openings. Try another name or area.</li>';
}
function editor() {
  const assigned=notifications[draft.notification];
  const reading=temperatureSources.find(source=>source.id===draft.temperatureSource);
  const temperature=reading?draft.unit==="°F"?reading.fahrenheit:Math.round((reading.fahrenheit-32)*5/9*10)/10:null;
  return `<button class="text-button return" data-action="policy-list">Back to policies</button><div class="paper"><form id="policy-form" class="definition-editor installation-editor unified-policy-editor" novalidate>
    <header><div><h1 id="policy-heading">${esc(draft.name||"Left open policy")}</h1><p class="small">Changes take effect when you save.</p></div><label class="method-switch policy-enabled"><input id="enabled" data-field="enabled" type="checkbox" role="switch" aria-label="Policy enabled"${checked(draft.enabled)}><span>Policy enabled</span></label></header>
    <div id="form-error" class="form-error" role="alert"${Object.keys(errors).length?"":" hidden"}>Check the highlighted settings before saving.</div>
    <div class="policy-identity">${field("name","Policy name",draft.name,"text","required")}<div class="policy-type"><span>Monitoring type</span><strong>Left open</strong></div></div>
    <section class="policy-section" aria-labelledby="sources-heading"><h2 id="sources-heading">Doors and windows</h2><div class="source-toolbar"><input id="source-search" type="search" aria-label="Search doors and windows" placeholder="Search by name or area" value="${esc(search)}"><span id="source-count">${draft.sources.length} selected</span></div><ul class="source-selection-list">${sourceRows()}</ul><p class="small">Only these openings are included. New openings require selection.</p>${errors.sources?`<p class="field-error" role="alert">${errors.sources}</p>`:""}</section>
    <section class="policy-section" aria-labelledby="conditions-heading"><h2 id="conditions-heading">When it becomes a problem</h2>
      <div class="policy-duration condition-duration">${field("duration","Open for at least",draft.durationSeconds/durationScale(),"number",'min="0" step="any" required')}<label class="installation-field" for="duration-unit"><span>Duration unit</span><select id="duration-unit" data-field="duration-unit">${option("minutes","Minutes",durationUnit)}${option("hours","Hours",durationUnit)}${option("seconds","Seconds",durationUnit)}</select></label></div>
      <div class="condition-block"><h3>Monitoring hours</h3><label class="installation-field" for="hours"><span class="visually-hidden">When to monitor</span><select id="hours" data-field="hours">${option("always","Always",draft.hours)}${option("daily","During these hours each day",draft.hours)}</select></label><div id="hours-fields"${draft.hours==="daily"?"":" hidden"}><div class="hours-grid">${field("start","Start",draft.start,"time","required")}${field("end","End",draft.end,"time","required")}</div><p class="hours-note">Home Assistant time zone: America/Chicago.</p><p class="hours-note" id="hours-help">An opening already open at ${formatTime(draft.start)} starts a fresh countdown.</p></div></div>
      <div class="condition-block"><label class="temperature-toggle"><input id="useTemperature" data-field="useTemperature" type="checkbox"${checked(draft.useTemperature)}><span>Use outdoor temperature</span></label><div class="temperature-fields" id="temperature-fields"${draft.useTemperature?"":" hidden"}><label class="installation-field" for="temperatureSource"><span>Outdoor temperature source</span><select id="temperatureSource" data-field="temperatureSource">${temperatureSources.map(source=>option(source.id,source.name,draft.temperatureSource)).join("")}</select></label><p class="small" id="temperature-reading">${reading.detail}. Example reading: ${temperature}${draft.unit}.</p><div class="temperature-limits">${field("below","Below (optional)",draft.below,"number",'step="any"')}${field("above","Above (optional)",draft.above,"number",'step="any"')}<label class="installation-field" for="unit"><span>Unit</span><select id="unit" data-field="unit">${option("°F","°F",draft.unit)}${option("°C","°C",draft.unit)}</select></label></div><p class="temperature-note">A temperature within your limits resets an unfinished countdown. Temperature changes cannot end an open issue.</p></div></div>
      <div class="policy-rule" aria-label="Policy summary"><p id="rule-text">${esc(ruleText())}</p><p class="rule-end" id="rule-end">${draft.hours==="daily"?`Closing an opening ends its issue. At ${formatTime(draft.end)}, monitoring ends and all alerts and reminders stop.`:"Closing an opening ends its issue."}</p></div>
    </section>
    <section class="policy-section" aria-labelledby="notification-heading"><h2 id="notification-heading">Notifications</h2><p class="policy-notification-status" id="notification-status">${sending?"Notifications are on in this preview.":"Notifications are turned off globally. Issues still appear in Open issues."}</p>
      ${assigned?`<div class="notification-row"><div class="policy-notification-controls"><label class="installation-field" for="notification"><span>Notification</span><select id="notification" data-field="notification">${Object.entries(notifications).map(([id,item])=>option(id,item.name,draft.notification)).join("")}</select></label><button class="button" type="button" data-action="remove-notification">Remove</button></div><dl class="policy-notification-facts"><div><dt>When</dt><dd>${notificationWhen(assigned)}</dd></div><div><dt>Send to</dt><dd>${esc(assigned.destination)}</dd></div></dl><div class="notification-actions"><button class="text-button" type="button" data-action="edit-notification">Edit notification</button>${draft.hours==="daily"?`<span class="notification-cutoff">This policy stops sending at ${formatTime(draft.end)}.</span>`:""}</div></div>`:`<div class="policy-notification-empty"><strong>No notifications</strong><p>Issues still appear in Open issues.</p></div><label class="installation-field" for="add-notification" style="margin-top:16px;max-width:420px"><span>Add notification</span><select id="add-notification" data-field="add-notification"><option value="">Choose a notification…</option>${Object.entries(notifications).map(([id,item])=>option(id,item.name,"")).join("")}</select></label>`}
    </section><div id="save-footer">${footer()}</div>
  </form></div>`;
}
function footer() {
  return dirty()?'<footer class="sticky-save"><span class="small">Unsaved changes</span><div class="actions"><button type="button" class="button" data-action="discard">Discard changes</button><button type="submit" class="button primary" form="policy-form">Save policy</button></div></footer>':"";
}
function policyList() {
  return `<section class="paper policy-list"><h1>Monitoring policies</h1><article class="list-row"><div><h2>${esc(saved.name)} <span class="small">${saved.enabled?"On":"Off"}</span></h2><p>Left open · ${saved.sources.length} selected openings</p><p>${saved.hours==="daily"?`${formatTime(saved.start)} to ${formatTime(saved.end)}`:"Always"}${dirty()?" · Unsaved changes":""}</p></div><button class="button" data-action="edit-policy">Edit policy</button></article></section>`;
}
function notificationList() {
  return `<section class="paper policy-list"><h1>Notifications</h1>${Object.entries(notifications).map(([id,item])=>`<article class="list-row"><div><h2>${esc(item.name)}</h2><p>${notificationWhen(item)}</p><p>${esc(item.destination)}</p></div><button class="button" data-action="open-shared" data-notification="${id}">Edit notification</button></article>`).join("")}</section>`;
}
function sharedEditor() {
  const item=notificationDraft;
  return `<button class="text-button return" data-action="return-policy">Back to ${esc(draft.name)}</button><section class="paper shared-editor"><h1>${esc(item.name)}</h1><p class="small">Shared notification · Used by ${esc(saved.name)}</p><p>Save here to change this notification wherever it is assigned. The policy draft stays separate.</p><form id="shared-form"><label class="installation-field"><span>Notification name</span><input id="shared-name" value="${esc(item.name)}" required></label><label class="installation-field"><span>When to notify</span><select id="shared-mode">${option("acknowledge","Immediately, with acknowledgment",item.mode)}${option("immediate","Immediately",item.mode)}${option("report","Daily at 8:00 AM",item.mode)}</select></label>${item.mode==="acknowledge"?`<label class="installation-field"><span>Remind every (minutes)</span><input id="shared-reminder" type="number" min="1" step="1" value="${item.reminder}" required></label>`:""}<label class="installation-field"><span>Delivery method</span><select id="shared-destination">${option("Household phones","Household phones",item.destination)}${option("Kitchen speaker","Kitchen speaker",item.destination)}</select></label><div class="actions"><button type="button" class="button" data-action="return-policy">Cancel</button><button class="button primary" type="submit">Save notification</button></div></form></section>`;
}
const exampleSteps = [
  {time:"10:00 PM", title:"A fresh countdown starts", temperature:"43°F", issue:"Waiting · 0 of 5 minutes", notifications:"None yet", text:"The patio door was already open. Earlier open time does not count."},
  {time:"10:05 PM", title:"The opening needs attention", temperature:"43°F", issue:"Patio door left open", notifications:"Alert requested; reminders eligible", text:"The door stayed open for five minutes during monitoring hours, with temperature below 50°F."},
  {time:"11:00 PM", title:"Warmer weather leaves the issue open", temperature:"55°F", issue:"Patio door left open", notifications:"Reminders remain eligible", text:"Temperature can start a countdown. It cannot end this established issue."},
  {time:"7:00 AM", title:"Monitoring ends. Notifications stop.", temperature:"55°F", issue:"Ended · Monitoring window ended", notifications:"None · Pending requests cancelled", text:"The door is still reported open. History records the window ending without claiming it closed."},
  {time:"10:00 PM", title:"The next window starts fresh", temperature:"43°F", issue:"Waiting · 0 of 5 minutes", notifications:"None yet", text:"A full new countdown is required. Acknowledgment from the previous window does not carry over."},
];
let exampleStep=0;
function behavior() {
  const item=exampleSteps[exampleStep];
  return `<section class="paper behavior"><h1>Try the monitoring window</h1><p class="small">Illustrative behavior · Patio door, five-minute wait, 10:00 PM–7:00 AM, below 50°F. Notifications enabled for this example.</p><div class="example-summary" role="status"><h2>${item.title}</h2><p>${item.text}</p><dl><dt>Time</dt><dd>${item.time}</dd><dt>Door</dt><dd>Reported open</dd><dt>Outside</dt><dd>${item.temperature}</dd><dt>Issue</dt><dd>${item.issue}</dd><dt>Notifications</dt><dd>${item.notifications}</dd></dl></div><div class="actions"><button class="button" data-action="example-previous"${exampleStep===0?" disabled":""}>Previous</button><button class="button primary" data-action="example-next"${exampleStep===exampleSteps.length-1?" disabled":""}>${exampleStep===0?"After five minutes":exampleStep===1?"Temperature rises":exampleStep===2?"End monitoring hours":exampleStep===3?"Next monitoring window":"Example complete"}</button><button class="text-button" data-action="example-reset">Start again</button></div><h2 style="font-size:16px;font-weight:500;margin:28px 0 8px">The whole example</h2><ol class="example-timeline">${exampleSteps.map((step,index)=>`<li${index===exampleStep?' aria-current="step"':""}><time>${step.time}</time><span>${step.title}</span></li>`).join("")}</ol></section>`;
}
function readOnlyView(page) {
  if(page==="Monitoring")return `<section class="paper policy-list"><h1>Monitoring</h1>${sources.map(source=>`<article class="list-row"><div><h2>${source.name}</h2><p>${source.area}</p><p>${saved.sources.includes(source.id)?"Left open · Overnight openings":"Not monitored by this policy"}</p></div></article>`).join("")}</section>`;
  return `<section class="paper policy-list"><h1>${page}</h1><p class="small">Example content for this design preview.</p><article class="list-row"><div><h2>${page==="History"?"Patio door · Monitoring window ended":"Patio door left open"}</h2><p>${page==="History"?"7:00 AM · No closure reported":"Kitchen · Reported open for five minutes"}</p></div><button class="button" data-action="edit-policy">Edit policy</button></article></section>`;
}
function render() {
  const focus=root.activeElement?.id, start=root.activeElement?.selectionStart, end=root.activeElement?.selectionEnd;
  const currentTab=view==="shared"||view==="notifications"?"Notifications":["Open issues","Monitoring","History"].includes(view)?view:"Policies";
  root.innerHTML=`<style>${styles}${localStyles}</style>${view==="behavior"?`<main>${behavior()}</main>`:`<header class="app-header"><div class="app-title-row"><span class="app-title">Homeostatic</span><label class="method-switch global-switch"><span>Notifications</span><input id="global-sending" type="checkbox" role="switch" aria-label="Global notifications"${checked(sending)}><span>${sending?"On":"Off"}</span></label></div><nav class="app-tabs" aria-label="Homeostatic pages">${["Open issues","Monitoring","Policies","Notifications","History"].map(name=>`<button type="button" data-page="${name}"${currentTab===name?' aria-current="page"':""}>${name}</button>`).join("")}</nav></header><main>${view==="editor"?editor():view==="list"?policyList():view==="notifications"?notificationList():view==="shared"?sharedEditor():readOnlyView(view)}</main>`}`;
  const replacement=focus?root.getElementById(focus):null;
  if(replacement){replacement.focus({preventScroll:true});if(typeof start==="number"&&["text","search"].includes(replacement.type))replacement.setSelectionRange(start,end);}
}
function update() {
  if(view!=="editor")return;
  root.querySelector("#policy-heading").textContent=draft.name||"Left open policy";
  root.querySelector("#source-count").textContent=`${draft.sources.length} selected`;
  root.querySelector("#rule-text").textContent=ruleText();
  root.querySelector("#rule-end").textContent=draft.hours==="daily"?`Closing an opening ends its issue. At ${formatTime(draft.end)}, monitoring ends and all alerts and reminders stop.`:"Closing an opening ends its issue.";
  root.querySelector("#save-footer").innerHTML=footer();
}
function validate() {
  errors={};
  if(!draft.name.trim())errors.name="Enter a policy name.";
  if(!draft.sources.length)errors.sources="Select at least one door or window.";
  if(!Number.isInteger(draft.durationSeconds)||draft.durationSeconds<0||draft.durationSeconds>31536000)errors.duration="Use a duration from 0 to 365 days, in whole seconds.";
  if(draft.hours==="daily"&&(!draft.start||!draft.end||draft.start===draft.end))errors.end="Choose different start and end times, or monitor Always.";
  if(draft.useTemperature){
    if(draft.below===null&&draft.above===null)errors.below="Enter a Below limit, an Above limit, or both.";
    if(draft.below!==null&&!Number.isFinite(draft.below))errors.below="Enter a numeric temperature.";
    if(draft.above!==null&&!Number.isFinite(draft.above))errors.above="Enter a numeric temperature.";
    if(draft.below!==null&&draft.above!==null&&draft.below>draft.above)errors.above="Above must be greater than or equal to Below.";
  }
  return Object.keys(errors).length===0;
}
root.addEventListener("input",event=>{
  const element=event.target, key=element.dataset.field;
  if(element.id==="source-search"){search=element.value;root.querySelector(".source-selection-list").innerHTML=sourceRows();return;}
  if(key==="name")draft.name=element.value;
  if(key==="duration")draft.durationSeconds=element.value===""?NaN:Math.round(Number(element.value)*durationScale()*1000000)/1000000;
  if(["below","above"].includes(key))draft[key]=element.value===""?null:Number(element.value);
  if(["start","end"].includes(key))draft[key]=element.value;
  if(["name","duration","below","above","start","end"].includes(key))update();
});
root.addEventListener("change",event=>{
  const element=event.target, key=element.dataset.field;
  if(element.id==="global-sending"){sending=element.checked;render();status(`Global notifications ${sending?"on":"off"} in the preview only.`);return;}
  if(element.dataset.source){const selected=new Set(draft.sources);element.checked?selected.add(element.dataset.source):selected.delete(element.dataset.source);draft.sources=[...selected].sort();update();return;}
  if(["enabled","useTemperature"].includes(key))draft[key]=element.checked;
  if(["hours","temperatureSource","notification"].includes(key))draft[key]=element.value;
  if(key==="duration-unit")durationUnit=element.value;
  if(key==="add-notification"&&element.value)draft.notification=element.value;
  if(key==="unit"){const convert=value=>value===null?null:Math.round((element.value==="°C"?(value-32)*5/9:value*9/5+32)*100)/100;draft.below=convert(draft.below);draft.above=convert(draft.above);draft.unit=element.value;}
  if(element.id==="shared-mode"){notificationDraft.name=root.querySelector("#shared-name").value;notificationDraft.destination=root.querySelector("#shared-destination").value;if(root.querySelector("#shared-reminder"))notificationDraft.reminder=Number(root.querySelector("#shared-reminder").value);notificationDraft.mode=element.value;render();return;}
  if(key&&!['name','duration','below','above','start','end'].includes(key))render();
  if(["start","end"].includes(key))render();
});
root.addEventListener("submit",event=>{
  event.preventDefault();
  if(event.target.id==="shared-form"){
    const form=event.target;if(!form.reportValidity())return;
    notificationDraft.name=root.querySelector("#shared-name").value;
    notificationDraft.reminder=Number(root.querySelector("#shared-reminder")?.value||30);
    notificationDraft.destination=root.querySelector("#shared-destination").value;
    notifications[selectedNotification]=structuredClone(notificationDraft);view="editor";render();status("Notification saved in this preview. The policy draft is still separate.");return;
  }
  if(!validate()){render();const first=Object.keys(errors)[0];(root.getElementById(first)||root.querySelector("[data-source]")).focus();status("Check the highlighted settings. Your draft is still here.");return;}
  saved=structuredClone(draft);render();status("Policy saved in this preview. No Home Assistant settings changed.");
});
root.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!button)return;
  if(button.dataset.page){view=button.dataset.page==="Policies"?"list":button.dataset.page==="Notifications"?"notifications":button.dataset.page;render();window.scrollTo({top:0});return;}
  const action=button.dataset.action;
  if(action==="policy-list")view="list";
  if(action==="edit-policy"||action==="return-policy")view="editor";
  if(action==="remove-notification"){draft.notification="";render();return;}
  if(action==="discard"){draft=structuredClone(saved);errors={};render();status("Changes discarded in this preview.");return;}
  if(action==="edit-notification"||action==="open-shared"){selectedNotification=button.dataset.notification||draft.notification;notificationDraft=structuredClone(notifications[selectedNotification]);view="shared";}
  if(action==="example-next")exampleStep=Math.min(exampleSteps.length-1,exampleStep+1);
  if(action==="example-previous")exampleStep=Math.max(0,exampleStep-1);
  if(action==="example-reset")exampleStep=0;
  if(action){render();if(!action.startsWith("example"))window.scrollTo({top:0});}
});
document.querySelector("#dark-theme").addEventListener("change",event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";host.toggleAttribute("dark",event.target.checked);});
document.querySelectorAll("[data-preview]").forEach(button=>button.addEventListener("click",()=>{view=button.dataset.preview;document.querySelectorAll("[data-preview]").forEach(other=>other.setAttribute("aria-pressed",String(other===button)));render();window.scrollTo({top:0});}));
window.leftOpenMockup={snapshot:()=>({draft:structuredClone(draft),saved:structuredClone(saved),dirty:dirty(),view,exampleStep,notifications:structuredClone(notifications)})};
render();
