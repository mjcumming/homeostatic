import {escapeHtml as esc} from "./model.mjs?v=74";
import {editReusable, namedNotifications, scopedEditorFooter} from "./reusable-editors.mjs?v=74";


export const TIMINGS = [
  ["Recovery", "settle", "Wait for related failures", "Allow dependencies that are still uncertain to settle before opening a separate problem."],
  ["Detection", "unknown_hold", "Wait for unknown evidence", "Wait this long before a check treats missing or uncertain evidence as stale."],
  ["Detection", "retry_hold", "Wait before reporting setup retries", "Wait this long before reporting an integration that is retrying setup."],
  ["Recovery", "clear_hold", "Confirm recovery", "Require passing availability evidence for this long before clearing its check."],
  ["Recovery", "rejoin_grace", "Allow reconnecting devices", "Give a dependent source time to recover when its dependency returns."],
  ["Startup", "startup_grace", "Wait after startup", "After Home Assistant starts, open no new issues and hold notifications for at least this long. Saving a change here doesn't start it."],
  ["Startup", "startup_quiet_max", "Maximum startup wait", "Stop extending startup quiet time after this limit."],
  ["Grouping", "coalesce_count", "Group related problems", "Minimum number of related problems to combine."],
  ["Grouping", "coalesce_window", "Grouping window", "Look for related problems opened within this time."],
  ["Notifications", "batch", "Standard alert batching", "Wait before combining standard notification requests."],
];

const timingField=(path,label,seconds,help="",count=false)=>{
  const scale=count||path.endsWith(".batch")||seconds%60!==0?1:60;
  const unit=count?"failures":scale===60?"min":"sec";
  return `<div class="timing-row">${field(path,label,seconds/scale,"number",help,`min="${count?2:0}" step="1" required data-setting-scale="${scale}" aria-label="${esc(label)} ${unit}"`)}<span class="timing-unit">${unit}</span></div>`;
};
const field = (path,label,value,type="text",help="",attributes="") => `<label class="installation-field"><span><strong>${esc(label)}</strong>${help?`<small>${esc(help)}</small>`:""}</span><input type="${type}" data-setting-path="${esc(path)}" value="${esc(value??"")}" ${attributes}></label>`;

export function installationSettings(card) {
  const notificationsPage=card.page==="notifications";
  const intro=`<div class="intro"><h1>${notificationsPage?"Notifications":"Settings"}</h1></div>`;
  if(!card.configuration||!card.settingsDraft)return `${intro}<section class="panel body"><p>${esc(card.configError||"Loading settings…")}</p><button type="button" class="button" data-action="load-configuration">Reload settings</button></section>`;
  if(notificationsPage) {
    const selection=card.definitionSelection;
    const active=["methods","profiles"].includes(selection?.kind)&&card.settingsDraft.notification_definitions?.[selection.kind]?.[selection.id];
    return `${active?"":intro}<section class="panel installation-content notifications-content${active?" has-method-editor":""}"><fieldset class="installation-editor notifications-body"${card.settingsBusy||card.configBusy?' disabled':''}>${namedNotifications(card)}${card.settingsError?`<p class="config-error" role="alert">${esc(card.settingsError)}</p>`:""}</fieldset></section>`;
  }
  const draft=card.settingsDraft,section=card.settingsSection==="grouping"?"grouping":"timing";
  const nav=`<nav class="installation-nav" aria-label="Installation settings">${[["timing","Timing"],["grouping","Problem grouping"]].map(([id,label])=>`<button type="button" data-settings-section="${id}" aria-current="${section===id?'page':'false'}">${label}</button>`).join("")}</nav>`;
  let body="";
  if(section==="timing"||section==="grouping") {
    const rows=TIMINGS.filter(([category,key])=>section==="grouping"?category==="Grouping":category!=="Grouping");
    body=`<h2>${section==="grouping"?"Problem grouping":"Timing"}</h2><p class="sub">${section==="grouping"?"Combine related failures when they share a dependency.":"Set the waits used for detection, recovery, startup, and notification requests. Zero removes a wait."}</p>`+[...new Set(rows.map(row=>row[0]))].map(group=>`<section class="installation-group"><h3>${group}</h3>${rows.filter(row=>row[0]===group).map(([,key,label,help])=>timingField(`timings.${key}`,label,draft.timings[key],help,key==="coalesce_count")).join("")}</section>`).join("");
  }
  return `${intro}<div class="installation-layout">${nav}<section class="panel installation-content"><fieldset class="installation-editor"${card.settingsBusy?' disabled':''}>${body}</fieldset>${card.settingsError?`<p class="config-error" role="alert">${esc(card.settingsError)}</p>`:''}${scopedEditorFooter(card,{kind:"settings"},"Save settings")}</section></div>`;
}

export function editInstallation(card,event) {
  if(editReusable(card,event))return true;
  const element=event.target,draft=card.settingsDraft;
  if(!draft||event.type==="click"||!element.dataset.settingPath?.startsWith("timings."))return false;
  if(element.checkValidity&&!element.checkValidity()) {
    card.settingsError="Complete the highlighted setting before saving.";
    element.reportValidity();return true;
  }
  const key=element.dataset.settingPath.slice(8);
  if(!TIMINGS.some(([,name])=>name===key))return false;
  draft.timings[key]=Number(element.value)*Number(element.dataset.settingScale||1);
  card.settingsError=null;card.scopedError=null;card.scopedNotice=null;
  card.render();return true;
}
