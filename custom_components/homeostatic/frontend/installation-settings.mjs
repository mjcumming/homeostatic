import {escapeHtml as esc} from "./model.mjs?v=104";
import {editReusable, namedNotifications, scopedEditorFooter} from "./reusable-editors.mjs?v=104";


export const TIMINGS = [
  ["Recovery", "settle", "Wait for related failures", "Allow dependencies that are still uncertain to settle before opening a separate problem."],
  ["Detection", "unknown_hold", "Wait for unknown evidence", "Wait this long before a check treats missing or uncertain evidence as stale."],
  ["Detection", "retry_hold", "Report setup problems after", ""],
  ["Recovery", "clear_hold", "Clear recovered issues after", ""],
  ["Recovery", "rejoin_grace", "Allow reconnecting devices", "Give a dependent source time to recover when its dependency returns."],
  ["Startup", "startup_grace", "Wait after Home Assistant starts", "Hold new issues and notifications during startup."],
  ["Startup", "startup_quiet_max", "Maximum startup wait", "Stop extending startup quiet time after this limit."],
  ["Notifications", "batch", "Standard notification batching", "Wait before combining standard notification requests."],
];

const timingField=(path,label,seconds,help="")=>{
  const scale=path.endsWith(".batch")||seconds%60!==0?1:60;
  const unit=scale===60?"min":"sec";
  return `<div class="timing-row">${field(path,label,seconds/scale,"number",help,`min="0" step="1" required data-setting-scale="${scale}" aria-label="${esc(label)} ${unit}"`)}<span class="timing-unit">${unit}</span></div>`;
};
const field = (path,label,value,type="text",help="",attributes="") => `<label class="installation-field"><span><strong>${esc(label)}</strong>${help?`<small>${esc(help)}</small>`:""}</span><input type="${type}" data-setting-path="${esc(path)}" value="${esc(value??"")}" ${attributes}></label>`;

export function installationSettings(card) {
  const notificationsPage=card.page==="notifications";
  const intro=`<div class="intro"><h1>${notificationsPage?"Notifications":"Settings"}</h1></div>`;
  if(!card.configuration||!card.settingsDraft)return `${intro}<section class="panel body"><p role="${card.configError?"alert":"status"}">${esc(card.configError||"Loading settings…")}</p>${card.configError?'<button type="button" class="button" data-action="load-configuration">Retry loading settings</button>':""}</section>`;
  if(notificationsPage) {
    const selection=card.definitionSelection;
    const active=["methods","profiles"].includes(selection?.kind)&&card.settingsDraft.notification_definitions?.[selection.kind]?.[selection.id];
    return `${active?"":intro}<section class="panel installation-content notifications-content${active?" has-method-editor":""}"><fieldset class="installation-editor notifications-body"${card.settingsBusy||card.configBusy?' disabled':''}>${namedNotifications(card)}${card.settingsError?`<p class="config-error" role="alert">${esc(card.settingsError)}</p>`:""}</fieldset></section>`;
  }
  const draft=card.settingsDraft;
  const renderRows=rows=>rows.map(([,key,label,help])=>timingField(`timings.${key}`,label,draft.timings[key],help)).join("");
  const commonKeys=["retry_hold","clear_hold","startup_grace"];
  const body=`<h2>Timing</h2><p class="sub">These waits apply throughout Homeostatic. Zero removes a wait.</p>${renderRows(commonKeys.map(key=>TIMINGS.find(([,name])=>name===key)))}<details class="source-section" data-ui-key="settings-advanced-timing"><summary>Advanced timing</summary>${renderRows(TIMINGS.filter(([,key])=>!commonKeys.includes(key)))}</details>`;
  return `${intro}<section class="panel installation-content timing-settings"><fieldset class="installation-editor"${card.settingsBusy?' disabled':''}>${body}</fieldset>${card.settingsError?`<p class="config-error" role="alert">${esc(card.settingsError)}</p>`:''}${scopedEditorFooter(card,{kind:"settings"},"Save settings")}</section>`;
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
