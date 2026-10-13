import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=72";
import {monitoringScope, scopeChoice, ruleSummary} from "./configuration.mjs?v=72";
import {REPORTING, reportingChoices} from "./reporting.mjs?v=72";

const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const reportingLabel = id => REPORTING.find(row=>row[0]===id)?.[1] || id;
const policyLink = '<button type="button" class="link" data-page="policies">View policies</button>';
const choiceLabel = value => ({inherit:"Following monitoring policies",attach:"Explicitly monitored",exclude:"Not monitored by default",multiple:"Several direct policies apply"}[value]);
const familyDevices = node => node.children.flatMap(child=>child.source?.kind==="device"?[child]:child.children?child.children.filter(item=>item.source?.kind==="device"):[]);

/** Describe one integration's existing catalog scopes without creating rules. */
export function integrationScopes(node) {
  const match=node.domain?{integration_domain:[node.domain]}:{integration:[node.entries[0]?.entry_id]};
  const scope=(kind,kinds)=>({kind,id:node.domain||node.entries[0]?.entry_id,match:{...match,kind:kinds}});
  return {all:scope("integration_all",["integration","device","entity"]),connection:scope("entry",["integration"]),devices:scope("integration_devices",["device"])};
}

function editor(card,scope,id,title,options) {
  const current=scopeChoice(card.configDraft,scope);
  const index=card.configScopes.push(scope)-1;
  const body=current==="multiple"?`<p>Several direct policies apply. Review them before changing this choice.</p>${policyLink}`:
    `<fieldset class="source-choices"><legend>${esc(title)}</legend>${options.map(([value,label,help])=>`<label class="source-radio"><input type="radio" name="source-choice-${index}" data-scope-index="${index}" value="${value}"${current===value?' checked':''}><span><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`).join("")}</fieldset>`;
  return `<details class="source-setting-change" data-ui-key="${id}"><summary>Change<span class="source-setting-sr"> ${esc(title.toLowerCase())}</span></summary>${body}</details>`;
}

function monitoringRow(card,scope,id,title,help,count,options) {
  const current=scopeChoice(card.configDraft,scope),saved=scopeChoice(card.configuration.rules,scope);
  return `<div class="source-setting-row"><div><h4>${title}</h4><p class="small">${help}</p><strong>${count}</strong><p class="small">${esc(choiceLabel(saved))}</p>${current!==saved?`<p class="source-setting-pending">Unsaved choice: ${esc(options.find(row=>row[0]===current)?.[1]||choiceLabel(current))}. Review to see the result.</p>`:""}</div>${editor(card,scope,id,title,options)}</div>`;
}

/** Show actual monitoring outcomes before exposing their policy controls. */
export function integrationSettings(card,node) {
  if(card.configuration?.monitoring_policy_version===1)return `<section class="source-setting-section"><h3>Monitoring policies</h3><p>Policies select the integrations, devices, and entities to monitor. Edit a policy to change its sources or notifications.</p>${policyLink}</section>${sourceSettingsFooter(card)}`;
  const scopes=integrationScopes(node),allChoice=scopeChoice(card.configDraft,scopes.all);
  const off=allChoice==="exclude",changed=allChoice!==scopeChoice(card.configuration.rules,scopes.all);
  const index=card.configScopes.push(scopes.all)-1;
  const devices=familyDevices(node);
  const choices=devices.map(child=>({child,choice:scopeChoice(card.configDraft,monitoringScope("device_availability",child.device.id))})).filter(item=>item.choice!=="inherit"&&!(item.choice==="exclude"&&item.child.source.excluded_by?.length));
  const excluded=devices.filter(child=>child.source.excluded_by?.length);
  const busy=card.configBusy||card.settingsBusy;
  const connectionCount=`Currently ${node.entries.filter(entry=>entry.watched).length} of ${node.entries.length} connections monitored`;
  const deviceCount=`Currently ${devices.filter(child=>child.source.watched).length} of ${devices.length} devices monitored`;
  const master=node.entries.length?`<section class="source-setting-section"><label class="source-setting-master"><span><strong>Allow monitoring for this integration</strong><small>${changed?(off?"Will stop all checks after saving":"Saved monitoring choices can apply after saving"):off?"All checks stopped":"Saved monitoring choices can apply"}</small></span><input type="checkbox" role="switch" data-scope-index="${index}" data-integration-master${off?'':' checked'}${allChoice==="multiple"?' disabled':''}></label>${allChoice==="multiple"?`<p>Several direct policies control this integration.</p>${policyLink}`:""}${off?'<p>All connection, device and separate entity checks stop, including future sources. Individual choices are kept for when monitoring resumes.</p>':""}</section>`:"";
  const connectionOptions=[["inherit","Follow monitoring policies",connectionCount+"."],["attach","Monitor the connection","Watch for setup and sign-in problems."],["exclude","Do not monitor the connection","Devices and separate entity checks keep their own choices."]];
  const deviceOptions=[["inherit","Follow monitoring policies",deviceCount+"."],["attach","All devices, including new devices","Individual choices and exclusions still apply."],["exclude","Only devices I choose","New devices stay unmonitored until selected. Separate entity checks keep their own choices."]];
  const deviceChoice=scopeChoice(card.configDraft,scopes.devices);
  const list=(items,text)=>items.map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>${esc(text(child))}</small></button>`).join("");
  const monitoring=node.entries.length&&!off?`<section class="source-setting-section"><h3>What to monitor</h3><p class="small">Choose which Home Assistant reports become checks. The counts show what is monitored now; a choice that covers future sources takes effect when they appear.</p>${monitoringRow(card,scopes.connection,"integration-connection","Integration problems","Setup failures and sign-in problems reported by Home Assistant.",connectionCount,connectionOptions)}${monitoringRow(card,scopes.devices,"integration-devices","Device availability","Watch for selected entities becoming unavailable in Home Assistant.",deviceCount,deviceOptions)}${deviceChoice==="exclude"?'<p class="small">Open a device in Sources to choose whether to monitor it.</p>':""}${excluded.length?`<details class="source-setting-exceptions"><summary>${excluded.length} ${excluded.length===1?'device currently excluded':'devices currently excluded'}</summary>${list(excluded,()=>"Not monitored")}<p class="small">Saved exclusions continue to apply until you change them.</p></details>`:""}${choices.length?`<details class="source-setting-exceptions"><summary>${choices.length} individual monitoring ${choices.length===1?'choice':'choices'}</summary>${list(choices.map(item=>item.child),child=>choiceLabel(choices.find(item=>item.child===child).choice))}</details>`:""}</section>`:"";
  return `<div class="integration-settings"><fieldset class="source-settings-editor"${busy?' disabled':''}>${master}${monitoring}${integrationReporting(card,devices)}</fieldset>${sourceSettingsFooter(card)}</div>`;
}

/** Summarize assigned preferences without treating unsaved setup as active. */
export function integrationReporting(card,devices) {
  if(!card.settingsDraft||!devices.length)return "";
  if(card.settingsDraft.notification_definitions) {
    const definitions=card.settingsDraft.notification_definitions;
    const describe=rows=>rows.length?rows.map(row=>`${row.timing?.mode==="report"?`Summary at ${row.timing.at}`:row.timing?.mode==="acknowledge"?"Until acknowledged":"Immediately"} → ${row.methods.map(id=>definitions.methods[id]?.name||id).join(", ")}`).join("; "):"Dashboard only";
    return `<section class="source-setting-section"><h3>When to notify</h3><p>Household notifications are ${card.configuration.settings.notifications?"on":"off"}.</p><p class="small">Default notification rows apply to future devices. Each source can override them; named policies keep their own notification rows.</p><details><summary>Reporting for ${devices.length} devices</summary>${devices.map(child=>{const assignment=definitions.assignments[child.source.node_id]||{};return `<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>${esc(describe(assignment.checks?.availability||assignment.default||definitions.default))}</small></button>`;}).join("")}</details><button type="button" class="link" data-page="notifications">Manage delivery methods</button></section>`;
  }
  const choices=reportingChoices(card),saved=card.configuration.settings;
  const counts=new Map(),exceptions=[];
  for(const child of devices) {
    const assignment=choices.assignments[child.source.node_id]||{};
    const preference=assignment.checks?.availability||assignment.default||choices.default;
    counts.set(preference,(counts.get(preference)||0)+1);
    for(const [check,id] of Object.entries(assignment.checks||{}))exceptions.push({child,check,id});
  }
  const setup=!!card.settingsDraft.reporting,changed=!same(saved.reporting,card.settingsDraft.reporting);
  const summary=setup?[...counts].map(([id,count])=>`${count} ${reportingLabel(id)}`).join(" · "):"Using the existing notification policy";
  const activation=saved.notifications?"Household notifications are on.":"Household notifications are off.";
  const draftActivation=saved.notifications!==card.settingsDraft.notifications?`<p class="source-setting-pending">After saving, household notifications will be ${card.settingsDraft.notifications?'on':'off'}.</p>`:"";
  return `<section class="source-setting-section"><h3>When to notify</h3><p>Choose when device problems should reach someone.</p><p><strong>${activation}</strong></p>${draftActivation}<p class="small">Preferences apply to monitored devices when notifications are enabled.</p><div class="source-setting-row"><div><h4>Device preferences</h4><strong>${esc(summary)}</strong>${changed?'<p class="source-setting-pending">Unsaved reporting choices</p>':""}${!setup?'<p class="small">Choosing a preference prepares a replacement reporting setup with notifications off. Save to apply these choices.</p>':""}</div><details class="source-setting-change" data-ui-key="integration-reporting"><summary>Change<span class="source-setting-sr"> device reporting</span></summary><label class="source-reporting-select">Apply to these ${devices.length} devices<select data-reporting-bulk="${esc(JSON.stringify(devices.map(child=>child.source.node_id)))}"><option value="">Choose when to notify</option>${REPORTING.map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join("")}</select></label><p class="small">Applies to current devices. New devices use the household reporting default. Check-specific preferences are kept.</p><details class="source-setting-exceptions"><summary>What each reporting choice does</summary><dl>${REPORTING.map(([,name,help])=>`<dt>${esc(name)}</dt><dd>${esc(help)}</dd>`).join("")}</dl></details></details></div>${setup&&exceptions.length?`<details class="source-setting-exceptions"><summary>${exceptions.length} ${exceptions.length===1?'check has its':'checks have their'} own reporting preference</summary>${exceptions.map(({child,check,id})=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}<small>${esc(check==="availability"?"Availability":check==="condition"?"Configured situation":check)}</small></span><small>${esc(reportingLabel(id))}</small></button>`).join("")}<p class="small">Changing device defaults keeps these preferences.</p></details>`:""}<button type="button" class="link source-settings-destination" data-page="notifications">Manage report times and recipients</button></section>`;
}

/** Include the complete shared drafts in one revision-bound proposal. */
export function sourceSettingsProposal(card) {
  return {...structuredClone(card.settingsDraft),rules:structuredClone(card.configDraft)};
}

export function sourceSettingsReviewed(card) {
  const review=card.sourceSettingsReview;
  return review?.revision===card.configuration.revision&&same(review.proposal,sourceSettingsProposal(card))?review:null;
}

export function sourceSettingsFooter(card) {
  if(!card.settingsDraft)return "";
  const dirty=!same(card.configuration.rules,card.configDraft)||!same(card.configuration.settings,card.settingsDraft),busy=card.configBusy||card.settingsBusy;
  return `<footer class="source-settings-footer"><p class="small" role="status">${busy?'Saving changes…':dirty?'Unsaved changes':'All changes saved'}</p>${card.sourceSettingsError?`<p role="alert" class="config-error">${esc(card.sourceSettingsError)}</p>`:""}${card.sourceSettingsNotice?`<p role="status">${esc(card.sourceSettingsNotice)}</p>`:""}<div class="actions"><button type="button" class="button primary" data-action="save-source-settings"${busy||!dirty?' disabled':''}>Save changes</button>${dirty?`<button type="button" class="link" data-action="discard-source-settings"${busy?' disabled':''}>Discard changes</button>`:""}</div></footer>`;
}

export function settingsErrorMessage(error) {
  const message=typeof error==="string"?error:error?.message||error?.error?.message;
  if(message?.trim())return message;
  const code=error?.code||error?.error?.code;
  return code?`Could not save changes (${code}). Your edits are still here. Try again or reload the saved settings.`:"Could not reach Home Assistant to save changes. Your edits are still here. Check the connection and try again.";
}

/** Review the complete proposal without sending notifications or saving. */
export async function previewSourceSettings(card) {
  if(card.settingsBusy||card.configBusy||card.current.status!=="current")return;
  if([...(card.main.querySelectorAll?.(".installation-editor input, .installation-editor select")||[])].some(input=>!input.reportValidity()))return;
  const emptySelection=(card.settingsDraft.monitoring_policies||[]).find(policy=>Object.values(policy.match||{}).some(values=>Array.isArray(values)&&values.length===0));
  if(emptySelection){card.sourceSettingsError=`Choose at least one source, area, or label for ${emptySelection.name}, or choose All.`;card.render();return;}
  const proposal=sourceSettingsProposal(card),revision=card.configuration.revision;
  card.sourceSettingsReview=null;card.sourceSettingsError=null;card.sourceSettingsNotice=null;
  card.settingsBusy=true;card.render();
  try {
    const result=await card._hass.callWS({type:"homeostatic/preview_settings",revision,settings:proposal});
    card.sourceSettingsReview={revision,proposal,result};
  } catch(error) {card.sourceSettingsError=error?.message||"Could not review these settings.";}
  finally {card.settingsBusy=false;card.render();card.main.querySelector(".source-settings-preview")?.scrollIntoView({block:"nearest"});}
}

/** Save the complete draft once; validation and rollback remain server-side. */
export async function saveSourceSettings(card) {
  if(!card.settingsDraft||card.settingsBusy||card.configBusy||card.current.status!=="current")return;
  if(card.policyMethodEditor){card.sourceSettingsError="Use or cancel the delivery method before saving.";card.render();return;}
  if([...(card.main.querySelectorAll?.(".installation-editor input, .installation-editor select")||[])].some(input=>!input.reportValidity()))return;
  const emptySelection=(card.settingsDraft.monitoring_policies||[]).find(policy=>Object.values(policy.match||{}).some(values=>Array.isArray(values)&&values.length===0));
  if(emptySelection){card.sourceSettingsError=`Choose at least one item for ${emptySelection.name}, or choose All.`;card.render();return;}
  const proposal=sourceSettingsProposal(card),revision=card.configuration.revision;
  card.settingsBusy=true;card.sourceSettingsReview=null;card.sourceSettingsError=null;card.sourceSettingsNotice=null;card.render();
  try {
    await card._hass.callWS({type:"homeostatic/save_settings",revision,settings:proposal});
    await card.loadConfiguration();
    card.sourceSettingsNotice=card.configError?"Saved, but the current settings could not be reloaded. Reload settings before editing again.":"Changes saved.";
  } catch(error) {card.sourceSettingsError=settingsErrorMessage(error);}
  finally {card.settingsBusy=false;card.render();}
}

export function sourceSettingsAction(card,button) {
  const action=button.dataset.action;
  if(!["preview-source-settings","save-source-settings","discard-source-settings"].includes(action))return false;
  if(card.configBusy||card.settingsBusy)return true;
  if(action==="preview-source-settings")void previewSourceSettings(card);
  else if(action==="save-source-settings")void saveSourceSettings(card);
  else {
    card.configDraft=structuredClone(card.configuration.rules);
    card.settingsDraft=structuredClone(card.configuration.settings);
    card.policyMethodEditor=null;card.deliveryPicker=null;
    card.configPreview=null;card.settingsPreview=null;card.sourceSettingsReview=null;
    card.sourceSettingsError=null;card.sourceSettingsNotice=null;card.render();
  }
  return true;
}
