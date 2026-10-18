import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=97";


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
  split: ["Issues separated", "The problems were separated into individual issues. Recovery was not established."],
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

export async function callAction(hass, service, service_data) {
  const result = await hass.callWS({type: "call_service", domain: "homeostatic", service,
    service_data, return_response: true});
  if (!result?.response) throw new Error("No action result was received. Inspect active controls before retrying.");
  return result.response;
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
    : item.resolution === "split" ? RESOLUTIONS.split[1]
      : item.resolution === "absorbed" ? "Recovery was not established." : "";
  return [historyFinding(item, finding), ending];
}

function separatedIssues(item, data) {
  if (item.resolution !== "split") return "";
  const nodes = new Map(inventoryRows(data).map(source => [source.node_id, source]));
  const successors = [...new Set(item.split_into ?? [])];
  let missing = 0;
  const links = successors.map(id => {
    const open = data.inventory.episodes.find(row => row.episode_id === id);
    const retained = data.inventory.resolved_history.episodes.find(row => row.episode.episode_id === id);
    if (!open && !retained) {missing++; return "";}
    const name = open ? nodes.get(open.anchor)?.name || open.labels?.name || "Name not recorded" : historyName(retained);
    return `<button type="button" class="button" ${open ? "data-open-episode" : "data-history"}="${esc(id)}">${open ? "Open issue" : "View history"}: ${esc(name)}</button>`;
  }).join("");
  return `${links ? `<div class="actions">${links}</div>` : ""}${missing ? `<p class="sub">${missing} separated ${missing === 1 ? "issue is" : "issues are"} no longer available.</p>` : !successors.length ? '<p class="sub">The separate issues were not recorded.</p>' : ""}`;
}

function historyDetails(item, data) {
  const [reported, ending] = historyAccount(item);
  const findings = [...new Set([reported, ...(item.episode.reasons ?? []).map(reason => historyFinding(item, reason))])];
  const open = data.inventory.episodes.some(row => row.episode_id === item.absorbed_into);
  const retained = data.inventory.resolved_history.episodes.some(row => row.episode.episode_id === item.absorbed_into);
  const related = !item.absorbed_into ? "" : open || retained
    ? `<button type="button" class="button" ${open ? "data-open-episode" : "data-history"}="${esc(item.absorbed_into)}">View related problem</button>`
    : '<p class="sub">The related problem is no longer available.</p>';
  return `${findings.map(message => `<p>${esc(message)}</p>`).join("")}${ending ? `<p>${esc(ending)}</p>` : ""}<dl class="history-times"><div><dt>Observed</dt><dd>${esc(observedRange(item.episode.opened_at, item.resolved_at))}</dd></div></dl>${related}${separatedIssues(item, data)}`;
}

export function attentionActionAllowed(current, admin, action, target) {
  if (!admin || current.status !== "current" || !current.data.inventory.attention_controls_supported) return false;
  return action === "cancel_control" && (current.data.inventory.operator_controls ?? []).some((item) => item.control_id === target);
}

/** List active maintenance windows; issue pauses belong to the shared issue response area. */
export function controlsPanel(data, targets = null) {
  const names = new Map(data.inventory.nodes.map((source) => [source.node_id, source.name]));
  const records = (data.inventory.operator_controls ?? []).filter((item) => item.action === "maintenance" && (!targets || targets.includes(item.target)));
  return `<section class="active-controls" aria-label="Active maintenance">${records.length ? records.map((item) => `<div class="active-control">${!targets ? `<p class="control-target">${esc(names.get(item.target) ?? item.target)}</p>` : ""}<div class="active-control-summary"><p><strong>Working on equipment</strong><span>Until ${esc(date(item.until))}</span></p>${data.inventory.attention_controls_supported ? `<button type="button" class="link" data-cancel-control="${esc(item.control_id)}">End maintenance…</button>` : ""}</div><p>${item.include_dependents ? "Also covers dependent equipment" : "Selected equipment only"}. Existing problems and notifications remain active.</p>${item.reason ? `<p class="control-reason">${esc(item.reason)}</p>` : ""}</div>`).join("") : '<p class="sub">No active maintenance.</p>'}</section>`;
}

export class DashboardTools {
  constructor(card) {
    this.card = card;
    this.query = "";
    this.resolution = "";
    this.page = 0;
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
    this.dialog.addEventListener("submit", (event) => {event.preventDefault(); this.executeImmediate();});
  }

  clearSelection() {this.immediate = null;}

  close() {this.historyId = null; this.clearSelection(); this.dialog.close();}

  disconnect() {this.close();}

  update() {
    if (this.immediate) this.refreshImmediate();
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

  /** Show a source's active maintenance windows with their End maintenance action. */
  maintenanceControls(source, data) {
    const active = (data.inventory.operator_controls ?? []).some((item) => item.action === "maintenance" && item.target === source.node_id);
    return active ? `<section class="detail problem-controls">${controlsPanel(data, [source.node_id])}</section>` : "";
  }

  clicked(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.cancelControl) this.openImmediate(button.dataset.cancelControl);
    else if (button.dataset.historyToggle) {
      if (this.historyId === button.dataset.historyToggle) {this.historyId = null; this.card.render();}
      else this.showHistory(button.dataset.historyToggle);
    }
    else if (button.dataset.history) this.showHistory(button.dataset.history);
    else if (button.dataset.tool === "close") this.close();
    else if (button.dataset.tool === "previous" || button.dataset.tool === "next") {
      this.historyId = null;
      this.page += button.dataset.tool === "next" ? 1 : -1;
      this.card.render();
    }
    else if (button.dataset.openEpisode) {
      const id = button.dataset.openEpisode;
      this.close();
      this.card.openDetail({episodeId: id});
    }
  }

  input(event) {
    if (!event.target.hasAttribute("data-history-search") && !event.target.hasAttribute("data-history-filter")) return;
    const previous = this.card.navigation?.capture();
    this.historyId = null;
    this.query = this.card.main.querySelector("[data-history-search]").value;
    this.resolution = this.card.main.querySelector("[data-history-filter]").value;
    this.page = 0;
    this.card.render();
    this.card.navigation?.finish(previous);
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

  openImmediate(target) {
    if (!attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, "cancel_control", target)) return;
    this.card.detail = null;
    this.card.detailSequence++;
    this.card.dialog.close();
    this.clearSelection();
    this.immediate = {target, busy: false, error: ""};
    const inventory = this.card.current.data.inventory;
    const control = inventory.operator_controls?.find((item) => item.control_id === target);
    const source = inventory.nodes.find((item) => item.node_id === control?.target);
    const name = source ? this.card.displaySourceName(source) : control?.target;
    this.dialog.querySelector("h2").textContent = "End maintenance";
    this.body.innerHTML = `<p class="control-target">${esc(name)}</p><p>End this equipment maintenance window. Problems still present may open now. Other overlapping maintenance windows remain active.</p><form class="tool-form"><p data-immediate-feedback role="status" hidden></p><div class="actions"><button type="submit" class="button primary">End maintenance</button></div></form>`;
    if (!this.dialog.open) this.dialog.showModal();
    this.refreshImmediate();
  }

  refreshImmediate() {
    const operation = this.immediate;
    const button = this.body.querySelector('[type="submit"]');
    if (!operation || !button) return;
    const allowed = attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, "cancel_control", operation.target);
    button.disabled = operation.busy || !allowed;
    this.body.querySelector("[data-immediate-feedback]").textContent = operation.error || (operation.busy ? "Waiting for Home Assistant…" : allowed ? "" : "This target is no longer available or monitoring is disconnected.");
  }

  async executeImmediate() {
    const operation = this.immediate;
    if (!operation || operation.busy || !attentionActionAllowed(this.card.current, this.card._hass?.user?.is_admin, "cancel_control", operation.target)) return;
    operation.busy = true;
    this.refreshImmediate();
    try {
      const result = await callAction(this.card._hass, "cancel_control", {control_id: operation.target});
      if (this.immediate !== operation) return;
      if (result.cancelled_control_id !== operation.target) throw new Error("The requested result was not confirmed.");
      this.body.innerHTML = '<p role="status">The selected control has ended.</p>';
      this.immediate = null;
    } catch (error) {
      if (this.immediate === operation) operation.error = `${error?.message ?? "Action could not be confirmed."} Inspect the current controls before retrying; the request may already have been saved.`;
    } finally {
      if (this.immediate === operation) {operation.busy = false; this.refreshImmediate();}
    }
  }
}
