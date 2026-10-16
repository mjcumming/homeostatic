import {escapeHtml as esc} from "./model.mjs?v=84";


const date = (value) => value ? new Date(value).toLocaleString(undefined, {year:"numeric", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) : "Unknown";
export function observedRange(start, end) {
  const opened = new Date(start), resolved = new Date(end);
  if (!Number.isFinite(opened.getTime()) || !Number.isFinite(resolved.getTime())) return "Time not recorded";
  const day = value => value.toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"});
  const time = value => value.toLocaleTimeString(undefined, {hour:"numeric", minute:"2-digit"});
  const range = day(opened) === day(resolved)
    ? `${day(opened)}, ${time(opened)}–${time(resolved)}`
    : `${day(opened)}, ${time(opened)} – ${day(resolved)}, ${time(resolved)}`;
  const minutes = Math.round((resolved - opened) / 60000);
  if (minutes < 0) return range;
  const duration = minutes === 0 ? "under 1 min"
    : minutes < 60 ? `${minutes} min`
      : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${range} (${duration})`;
}
export const RESOLUTIONS = {
  cleared: ["Cleared", ""],
  removed: ["Monitoring ended", "This source left monitoring. Recovery was not established."],
  absorbed: ["Joined another problem", "This problem became part of another problem. Recovery was not established."],
};

export function historyPage(history, query = "", resolution = "", page = 0, revealId = null) {
  const search = query.trim().toLocaleLowerCase();
  const rows = (history?.episodes ?? []).filter((item) =>
    (!resolution || item.resolution === resolution) &&
    (!search || [historyName(item), item.source?.node_id, item.episode.episode_id,
      item.episode.anchor, ...(item.episode.reasons ?? []).map((r) => r.message || r.reason)]
      .join(" ").toLocaleLowerCase().includes(search)));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const revealed = rows.findIndex(item => item.episode.episode_id === revealId);
  const selected = revealed >= 0 ? Math.floor(revealed / 20) : Math.min(Math.max(0, page), pages - 1);
  return {rows: rows.slice(selected * 20, selected * 20 + 20), total: rows.length, page: selected, pages};
}

export function controlPayload(draft, now = Date.now()) {
  const until = new Date(draft.untilLocal);
  if (!draft.untilLocal || !Number.isFinite(until.getTime()) || until.getTime() <= now || until.getTime() > now + 7 * 86400000) {
    throw new Error("Choose an end time in the future, within seven days.");
  }
  if (draft.reason.length > 500) throw new Error("Keep the reason within 500 characters.");
  return {until: until.toISOString(), reason: draft.reason,
    ...(draft.kind === "shelve" ? {episode_id: draft.target}
      : {node_id: draft.target, include_dependents: draft.includeDependents})};
}

export function localEndTime(minutes, now = Date.now()) {
  const end = new Date(now + minutes * 60000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

export async function callAction(hass, service, service_data) {
  const result = await hass.callWS({type: "call_service", domain: "homeostatic", service,
    service_data, return_response: true});
  if (!result?.response) throw new Error("No action result was received. Inspect active controls before retrying.");
  return result.response;
}

export function controlAllowed(current, admin, draft) {
  if (!admin || current.status !== "current" || !draft) return false;
  const inventory = current.data.inventory;
  return draft.kind === "shelve"
    ? inventory.episodes.some((item) => item.episode_id === draft.target)
    : inventory.nodes.some((item) => item.node_id === draft.target && ["entity", "integration", "external"].includes(item.kind));
}

export const historyName = (item) => [item.source?.name, item.episode.labels?.name]
  .find((name) => name && name !== item.episode.anchor) || "Name not recorded";
const historyRows = (rows, data, selected) => rows.map(item => {
  const id = item.episode.episode_id, expanded = selected === id;
  const contentId = `history-${encodeURIComponent(id)}`;
  const outcome = RESOLUTIONS[item.resolution]?.[0] ?? "Problem ended";
  return `<section class="history-entry"><button type="button" class="row history-toggle" data-history-toggle="${esc(id)}" aria-expanded="${expanded}" aria-controls="${esc(contentId)}"><span class="row-main">${esc(historyName(item))}<small>${esc(outcome)}${expanded ? "" : ` · ${esc(date(item.resolved_at))}`}</small></span><svg class="history-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button><div class="history-content" id="${esc(contentId)}"${expanded ? "" : " hidden"}>${expanded ? historyDetails(item, data) : ""}</div></section>`;
}).join("");

function historyFinding(item, finding) {
  if (finding?.message?.trim() && (item.episode.form === "group" || finding.node_id && finding.node_id !== item.episode.anchor)) return finding.message.trim();
  if (finding?.reason === "connectivity_disconnected") return "A selected connectivity sensor reported the device disconnected.";
  if (finding?.reason === "all_unavailable") return "Home Assistant reported every monitored entity on this device as unavailable.";
  if (finding?.reason === "some_unavailable") return "Home Assistant reported some monitored entities on this device as unavailable.";
  if (finding?.reason === "unavailable" && item.source?.kind === "entity") return "Home Assistant reported this entity as unavailable.";
  return finding?.message?.trim() || "No readable finding was recorded.";
}

export function historyAccount(item) {
  const finding = item.episode.reasons?.find(reason => reason.check_id !== null) ?? item.episode.reasons?.[0];
  if (item.resolution === "cleared" && item.episode.form === "group") {
    return ["Several related sources had a shared problem.", "Individual issues may still be open."];
  }
  const ending = item.resolution === "removed" ? "Monitoring ended without an observed recovery."
    : item.resolution === "absorbed" ? "Recovery was not established." : "";
  return [historyFinding(item, finding), ending];
}

function historyDetails(item, data) {
  const [reported, ending] = historyAccount(item);
  const findings = [...new Set([reported, ...(item.episode.reasons ?? []).map(reason => historyFinding(item, reason))])];
  const open = data.inventory.episodes.some(row => row.episode_id === item.absorbed_into);
  const retained = data.inventory.resolved_history.episodes.some(row => row.episode.episode_id === item.absorbed_into);
  const related = !item.absorbed_into ? "" : open || retained
    ? `<button type="button" class="button" ${open ? "data-open-episode" : "data-history"}="${esc(item.absorbed_into)}">View related problem</button>`
    : '<p class="sub">The related problem is no longer available.</p>';
  return `${findings.map(message => `<p>${esc(message)}</p>`).join("")}${ending ? `<p>${esc(ending)}</p>` : ""}<dl class="history-times"><div><dt>Observed</dt><dd>${esc(observedRange(item.episode.opened_at, item.resolved_at))}</dd></div></dl>${related}`;
}

export function attentionActionAllowed(current, admin, action, target) {
  if (!admin || current.status !== "current" || !current.data.inventory.attention_controls_supported) return false;
  const inventory = current.data.inventory;
  if (action === "acknowledge") return inventory.episodes.some((item) => item.episode_id === target);
  return action === "cancel_control" && (inventory.operator_controls ?? []).some((item) => item.control_id === target);
}

export function controlsPanel(data, targets = null, saved = null) {
  const names = new Map(data.inventory.nodes.map((source) => [source.node_id, source.name]));
  for (const episode of data.inventory.episodes) names.set(episode.episode_id, names.get(episode.anchor) ?? episode.anchor);
  const records = saved ? [saved] : (data.inventory.operator_controls ?? []).filter((item) => !targets || targets.includes(item.target));
  return `<section class="active-controls" aria-label="${saved ? "Saved control" : "Active controls"}">${records.length ? records.map((item) => `<div class="active-control">${!targets ? `<p class="control-target">${esc(names.get(item.target) ?? item.target)}</p>` : ""}<div class="active-control-summary"><p><strong>${item.action === "shelve" ? "Notifications paused" : "Working on equipment"}</strong><span>Until ${esc(date(item.until))}</span></p>${data.inventory.attention_controls_supported ? `<button type="button" class="link" data-cancel-control="${esc(item.control_id)}">${item.action === "shelve" ? "Resume notifications…" : "End maintenance…"}</button>` : ""}</div><p>${item.action === "maintenance" ? `${item.include_dependents ? "Also covers dependent equipment" : "Selected equipment only"}. Existing problems and notifications remain active.` : "For everyone, including urgent notifications. The issue remains open."}</p>${item.reason ? `<p class="control-reason">${esc(item.reason)}</p>` : ""}</div>`).join("") : '<p class="sub">No active pauses or maintenance.</p>'}</section>`;
}

export class DashboardTools {
  constructor(card) {
    this.card = card;
    this.query = "";
    this.resolution = "";
    this.page = 0;
    this.revision = 0;
    this.operation = 0;
    this.dialog = document.createElement("dialog");
    this.dialog.setAttribute("aria-labelledby", "tools-title");
    this.dialog.innerHTML = '<header class="dialog-head"><h2 id="tools-title"></h2><button type="button" class="button" data-tool="close">Close</button></header><div class="dialog-body"></div>';
    card.shadowRoot.append(this.dialog);
    this.body = this.dialog.querySelector(".dialog-body");
    this.dialog.addEventListener("close", () => {if (!this.dialog.open) this.clearSelection();});
    card.shadowRoot.addEventListener("click", (event) => {
      const previous=card.navigation?.capture();
      this.clicked(event);
      card.navigation?.finish(previous);
    });
    card.shadowRoot.addEventListener("input", (event) => this.input(event));
    this.dialog.addEventListener("submit", (event) => {event.preventDefault(); this.immediate ? this.executeImmediate() : this.execute();});
  }

  clearSelection() {this.immediate = null; this.draft = null; this.operation++;}

  close() {this.historyId = null; this.clearSelection(); this.dialog.close();}

  disconnect() {this.close();}

  update(current) {
    this.revision++;
    if (this.immediate) this.refreshImmediate();
    if (this.draft) {this.draft.preview = null; this.refreshFormState();}
  }

  historyNote(history) {
    if (!history) return "Resolved history is unavailable from this integration version.";
    return `Up to ${esc(history.retention.max_episodes)} ended problems within ${esc(history.retention.max_age_days)} days. Collection began ${esc(date(history.started_at))}. Earlier history is not reconstructed.`;
  }

  historyPanel(data) {
    const history = data.inventory.resolved_history;
    const result = historyPage(history, this.query, this.resolution, this.page, this.historyId);
    this.page = result.page;
    const filtered = Boolean(this.query.trim() || this.resolution);
    const filters = history?.episodes.length || filtered ? `<div class="body history-toolbar"><label><span class="sr-only">Search history</span><input type="search" data-history-search placeholder="Find a past issue" value="${esc(this.query)}"></label><label><span class="sr-only">Outcome</span><select data-history-filter><option value="">All outcomes</option>${Object.entries(RESOLUTIONS).map(([value, [label]]) => `<option value="${value}"${value === this.resolution ? " selected" : ""}>${label}</option>`).join("")}</select></label></div>` : "";
    const missing = this.historyId && history && !history.episodes.some(item => item.episode.episode_id === this.historyId) ? '<p class="body" role="status">This issue is no longer in retained history.</p>' : "";
    const empty = !history ? "History is unavailable." : filtered ? "No past issues match these filters." : "No past issues yet.";
    const pagination = result.pages > 1 ? `<div class="body actions"><button type="button" class="button" data-tool="previous"${result.page === 0 ? " disabled" : ""}>Previous</button><span role="status">Page ${result.page + 1} of ${result.pages} · ${result.total} problems</span><button type="button" class="button" data-tool="next"${result.page + 1 === result.pages ? " disabled" : ""}>Next</button></div>` : result.total ? `<div class="body"><span role="status">${result.total} ${result.total === 1 ? "problem" : "problems"}</span></div>` : "";
    return `<section class="panel">${filters}${missing}${historyRows(result.rows, data, this.historyId)}${!result.total ? `<div class="body"><p>${empty}</p></div>` : ""}${pagination}${history ? `<details class="body history-information" data-ui-key="history-information"><summary>History information</summary><p class="small">${this.historyNote(history)}</p></details>` : ""}</section>`;
  }

  detailButtons(source, episode, data) {

    const action = episode ? `<button type="button" class="button" data-shelf="${esc(episode.episode_id)}">Pause notifications…</button>`
      : ["entity", "integration", "external"].includes(source.kind) ? `<button type="button" class="button" data-maintenance="${esc(source.node_id)}">Working on this equipment…</button>` : "";
    const decision = data.policy?.episodes?.find((item) => item.episode_id === episode?.episode_id);
    const acknowledgment = decision?.acknowledgment;
    const awarenessNote = episode && data.inventory.attention_controls_supported && acknowledgment
      ? `<p class="control-status">Acknowledged ${esc(date(acknowledgment.at))}. Awaiting recovery.</p>` : "";
    const awarenessAction = episode && data.inventory.attention_controls_supported && !acknowledgment
      ? `<button type="button" class="button" data-acknowledge="${esc(episode.episode_id)}">Acknowledge issue…</button>` : "";
    const active = (data.inventory.operator_controls ?? []).some((item) => [source.node_id, episode?.episode_id].includes(item.target));
    return action || awarenessNote || awarenessAction || active ? `<section class="detail problem-controls">${awarenessNote}${action || awarenessAction ? `<div class="actions">${awarenessAction}${action}</div>` : ""}${active ? controlsPanel(data, [source.node_id, episode?.episode_id]) : ""}</section>` : "";
  }

  clicked(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.acknowledge) this.openImmediate("acknowledge", button.dataset.acknowledge);
    else if (button.dataset.cancelControl) this.openImmediate("cancel_control", button.dataset.cancelControl);
    else if (button.dataset.historyToggle) {
      if (this.historyId === button.dataset.historyToggle) {this.historyId = null; this.card.render();}
      else this.showHistory(button.dataset.historyToggle);
    }
    else if (button.dataset.history) this.showHistory(button.dataset.history);
    else if (button.dataset.shelf) this.openControl("shelve", button.dataset.shelf);
    else if (button.dataset.maintenance) this.openControl("maintenance", button.dataset.maintenance);
    else if (button.dataset.duration && this.draft?.kind === "maintenance") {
      this.draft.untilLocal = localEndTime(Number(button.dataset.duration));
      this.draft.duration = button.dataset.duration;
      this.body.querySelector('[name="untilLocal"]').value = this.draft.untilLocal;
      this.draft.preview = null;
      this.draft.error = "";
      this.refreshFormState();
    }
    else if (button.dataset.tool === "close") this.close();
    else if (button.dataset.tool === "previous" || button.dataset.tool === "next") {
      this.historyId = null;
      this.page += button.dataset.tool === "next" ? 1 : -1;
      this.card.render();
    } else if (button.dataset.tool === "preview") this.preview();
    else if (button.dataset.openEpisode) {
      const id = button.dataset.openEpisode;
      this.close();
      this.card.openDetail({episodeId: id});
    }
  }

  input(event) {
    if (event.target.hasAttribute("data-history-search") || event.target.hasAttribute("data-history-filter")) {
      const previous = this.card.navigation?.capture();
      this.historyId = null;
      this.query = this.card.main.querySelector("[data-history-search]").value;
      this.resolution = this.card.main.querySelector("[data-history-filter]").value;
      this.page = 0;
      this.card.render();
      this.card.navigation?.finish(previous);
    } else if (this.draft && event.target.name) {
      const field = event.target;
      this.draft[field.name] = field.type === "checkbox" ? field.checked : field.value;
      if (field.name === "untilLocal") {this.draft.duration = null; this.draft.timeEdited = true;}
      this.draft.preview = null;
      this.draft.error = "";
      this.refreshFormState();
    }
  }

  showHistory(id, {focus = true} = {}) {
    this.card.detail = null;
    this.card.detailSequence++;
    this.card.dialog.close();
    this.clearSelection();
    this.dialog.close();
    this.historyId = id;
    this.card.page = "history";
    const history = this.card.current.data?.inventory.resolved_history;
    let result = historyPage(history, this.query, this.resolution, this.page, id);
    if (!result.rows.some(item => item.episode.episode_id === id)) {
      this.query = "";
      this.resolution = "";
      result = historyPage(history, "", "", this.page, id);
    }
    this.page = result.page;
    this.card.render();
    const row = [...this.card.main.querySelectorAll("[data-history-toggle]")].find(button => button.dataset.historyToggle === id);
    if (focus) {row?.focus({preventScroll:true}); row?.scrollIntoView({block:"nearest"});}
  }

  openControl(kind, target) {
    const draft = {kind, target, untilLocal: "", reason: "", includeDependents: false, preview: null, busy: false, error: ""};
    if (!controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft)) return;
    this.card.detail = null;
    this.card.detailSequence++;
    this.card.dialog.close();
    this.draft = draft;
    this.historyId = null;
    const inventory = this.card.current.data.inventory;
    const nodeId = kind === "shelve" ? inventory.episodes.find((item) => item.episode_id === target).anchor : target;
    const source = inventory.nodes.find((item) => item.node_id === nodeId);
    const name = source ? this.card.displaySourceName(source) : nodeId;
    this.dialog.querySelector("h2").textContent = kind === "shelve" ? "Pause notifications" : "Working on this equipment";
    const introduction = kind === "shelve"
      ? "Pause notifications for this whole issue for everyone, including urgent notifications. The issue stays open. Existing notifications are not dismissed; other issues are unaffected."
      : "New issues wait until maintenance ends. Existing issues and notifications continue.";
    const duration = kind === "maintenance"
      ? '<span>How long?</span><div class="duration-choices" role="group" aria-label="Choose a maintenance duration"><button type="button" class="button" data-duration="30">30 minutes</button><button type="button" class="button" data-duration="120">2 hours</button><button type="button" class="button" data-duration="240">4 hours</button></div>'
      : "";
    const dependents = kind === "maintenance"
      ? '<label class="check-field"><input type="checkbox" name="includeDependents"> Also cover equipment that depends on this</label>'
      : "";
    const timeField = '<label>End date and time<input type="datetime-local" name="untilLocal" required aria-describedby="control-time-help"></label><p id="control-time-help" class="small">Your local time · Within 7 days</p>';
    const optionalFields = `<details data-control-options><summary>More options</summary>${dependents}<label>Reason (optional)<textarea name="reason" maxlength="500" rows="3"></textarea></label></details>`;
    const timing = kind === "maintenance"
      ? `${duration}<details data-custom-time><summary>Choose an end time…</summary>${timeField}</details><p data-maintenance-end class="small" hidden></p>`
      : `${timeField}<p class="small">An existing pause can only be extended.</p>`;
    const cancellation = inventory.attention_controls_supported ? "" : '<p class="small">This period can’t be ended early.</p>';
    this.body.innerHTML = `<p class="control-target">${esc(name)}</p><p>${introduction}</p><form class="tool-form">${timing}${optionalFields}<div data-control-preview hidden></div><p data-control-feedback role="status" hidden></p>${cancellation}<div class="actions"><button class="button primary" type="submit">${kind === "shelve" ? "Pause notifications" : "Start maintenance"}</button></div></form>`;
    this.dialog.showModal();
    this.refreshFormState();
  }

  openImmediate(action, target) {
    if (!attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, action, target)) return;
    this.card.detail = null;
    this.card.detailSequence++;
    this.card.dialog.close();
    this.clearSelection();
    this.immediate = {action, target, busy: false, error: ""};
    const inventory = this.card.current.data.inventory;
    const control = inventory.operator_controls?.find((item) => item.control_id === target);
    const episodeId = action === "acknowledge" ? target : control?.action === "shelve" ? control.target : null;
    const nodeId = episodeId ? inventory.episodes.find((item) => item.episode_id === episodeId)?.anchor : control?.target;
    const source = inventory.nodes.find((item) => item.node_id === nodeId);
    const name = source ? this.card.displaySourceName(source) : nodeId;
    const title = action === "acknowledge" ? "Acknowledge issue" : control.action === "shelve" ? "Resume notifications" : "End maintenance";
    this.dialog.querySelector("h2").textContent = title;
    const explanation = action === "acknowledge"
      ? "Record awareness of this issue for everyone and stop its acknowledgment-dependent reminders. Other notifications may continue. The issue remains open until recovery is reported."
      : control.action === "shelve" ? "Resume notifications for this issue under its notification rules and quiet hours. Due notifications may be sent now. Other pauses remain active."
        : "End this equipment maintenance window. Problems still present may open now. Other overlapping maintenance windows remain active.";
    this.body.innerHTML = `<p class="control-target">${esc(name)}</p><p>${explanation}</p><form class="tool-form"><p data-immediate-feedback role="status" hidden></p><div class="actions"><button type="submit" class="button primary">${title}</button></div></form>`;
    if (!this.dialog.open) this.dialog.showModal();
    this.refreshImmediate();
  }

  refreshImmediate() {
    const operation = this.immediate;
    const button = this.body.querySelector('[type="submit"]');
    if (!operation || !button) return;
    const allowed = attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, operation.action, operation.target);
    button.disabled = operation.busy || !allowed;
    this.body.querySelector("[data-immediate-feedback]").textContent = operation.error || (operation.busy ? "Waiting for Home Assistant…" : allowed ? "" : "This target is no longer available or monitoring is disconnected.");
  }

  async executeImmediate() {
    const operation = this.immediate;
    if (!operation || operation.busy || !attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, operation.action, operation.target)) return;
    operation.busy = true;
    this.refreshImmediate();
    try {
      const data = operation.action === "acknowledge" ? {episode_id: operation.target} : {control_id: operation.target};
      const result = await callAction(this.card._hass, operation.action, data);
      if (this.immediate !== operation) return;
      if (operation.action === "acknowledge" ? !result.acknowledgment : result.cancelled_control_id !== operation.target) throw new Error("The requested result was not confirmed.");
      this.body.innerHTML = `<p role="status">${operation.action === "acknowledge" ? "Awareness recorded. The issue remains open." : "The selected control has ended."}</p>`;
      this.immediate = null;
    } catch (error) {
      if (this.immediate === operation) operation.error = `${error?.message ?? "Action could not be confirmed."} Inspect the current problem and controls before retrying; the request may already have been saved.`;
    } finally {
      if (this.immediate === operation) {operation.busy = false; this.refreshImmediate();}
    }
  }

  scopeMarkup(scope) {
    const names = new Map(this.card.current.data.inventory.nodes.map((source) => [source.node_id, source.name]));
    const sample = (ids) => ids.slice(0, 20).map((id) => esc(names.get(id) ?? id)).join(", ") + (ids.length > 20 ? `, and ${ids.length - 20} more` : "");
    const root = scope.node_ids.find((id) => id === this.draft?.target || id === scope.control?.target);
    const other = scope.node_ids.filter((id) => id !== root && !scope.functions.includes(id));
    const openCount = scope.existing_episode_ids.length;
    return `<div class="control-scope"><p>Selected equipment: ${esc(names.get(root) ?? root ?? "Unavailable")}</p>${other.length ? `<p>Other equipment: ${sample(other)}</p>` : ""}<p>${openCount} existing ${openCount === 1 ? "problem remains" : "problems remain"} active.</p><p>Ends ${esc(date(scope.until))}</p>${this.draft?.includeDependents || scope.control?.include_dependents ? '<p class="small">Dependent scope may change if the configured relationships change. Homeostatic checks it again when you start.</p>' : ""}</div>`;
  }

  refreshFormState() {
    const draft = this.draft;
    const form = this.body.querySelector("form");
    if (!draft || !form) return;
    const allowed = controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft);
    let validation = "";
    try {controlPayload(draft);} catch (error) {validation = error.message;}
    for (const field of form.querySelectorAll("input, textarea, button")) field.disabled = draft.busy || !allowed;
    form.querySelector('[type="submit"]').disabled = draft.busy || !allowed || !!validation;
    const preview = form.querySelector('[data-tool="preview"]');
    if (preview) preview.disabled = draft.busy || !allowed || !!validation;
    const feedback = form.querySelector("[data-control-feedback]");
    feedback.textContent = draft.error || (draft.busy ? "Waiting for Home Assistant…" : !allowed ? "This target is no longer available, or monitoring is disconnected. No action can be submitted." : draft.untilLocal || draft.timeEdited ? validation : "");
    feedback.hidden = !feedback.textContent;
    for (const button of form.querySelectorAll("[data-duration]")) button.setAttribute("aria-pressed", String(button.dataset.duration === draft.duration));
    const end = form.querySelector("[data-maintenance-end]");
    if (end) {
      end.hidden = !draft.untilLocal || !!validation;
      end.textContent = end.hidden ? "" : `Ends ${new Date(draft.untilLocal).toLocaleString(undefined, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})}`;
    }
    form.querySelector("[data-control-preview]").hidden = !draft.preview;
    form.querySelector("[data-control-preview]").innerHTML = draft.preview ? this.scopeMarkup(draft.preview) : "";
  }

  async preview() {
    const draft = this.draft;
    if (!draft || draft.busy || !controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft)) return;
    const revision = this.revision;
    const operation = ++this.operation;
    try {
      const {reason, ...data} = controlPayload(draft);
      draft.busy = true;
      draft.error = "";
      this.refreshFormState();
      const scope = await callAction(this.card._hass, "preview_maintenance", data);
      if (this.draft !== draft || operation !== this.operation) return;
      if (revision === this.revision) draft.preview = scope;
      else draft.error = "Monitoring changed during preview. Preview the scope again.";
    } catch (error) {if (this.draft === draft) draft.error = error?.message ?? "Could not preview maintenance.";}
    finally {if (this.draft === draft) {draft.busy = false; this.refreshFormState();}}
  }

  async execute() {
    const draft = this.draft;
    if (!draft || draft.busy || !controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft)) return;
    const operation = ++this.operation;
    try {
      const data = controlPayload(draft);
      draft.busy = true;
      draft.error = "";
      this.refreshFormState();
      const result = await callAction(this.card._hass, draft.kind === "shelve" ? "shelve" : "start_maintenance", data);
      if (this.draft !== draft || operation !== this.operation) return;
      if (!result.control) throw new Error("The saved control was not returned.");
      this.body.innerHTML = `<p role="status">Saved by Home Assistant.</p>${controlsPanel(this.card.current.data, null, result.control)}${draft.kind === "maintenance" ? `<details><summary>Covered equipment</summary>${this.scopeMarkup(result)}</details>` : ""}`;
      this.draft = null;
    } catch (error) {
      if (this.draft === draft) {
        draft.error = `${error?.message ?? "The action could not be confirmed."} Inspect active controls after recovery before retrying; the request may already have been saved.`;
        draft.preview = null;
      }
    } finally {if (this.draft === draft) {draft.busy = false; this.refreshFormState();}}
  }
}
