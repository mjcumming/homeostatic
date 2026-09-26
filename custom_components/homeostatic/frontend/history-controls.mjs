import {escapeHtml as esc} from "./model.mjs?v=13";

const date = (value) => value ? new Date(value).toLocaleString() : "Unknown";
export const RESOLUTIONS = {
  cleared: ["Recovered", "Homeostatic confirmed recovery from the reported problem."],
  removed: ["Monitoring ended", "This source left monitoring. Recovery was not established."],
  absorbed: ["Joined another problem", "This episode became part of another problem. Recovery was not established."],
};

export function historyPage(history, query = "", resolution = "", page = 0) {
  const search = query.trim().toLocaleLowerCase();
  const rows = (history?.episodes ?? []).filter((item) =>
    (!resolution || item.resolution === resolution) &&
    (!search || [item.source?.name, item.source?.node_id, item.episode.episode_id,
      item.episode.anchor, ...(item.episode.reasons ?? []).map((r) => r.message || r.reason)]
      .join(" ").toLocaleLowerCase().includes(search)));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const selected = Math.min(Math.max(0, page), pages - 1);
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

const historyName = (item) => item.source?.name || item.episode.anchor || item.episode.episode_id;
const historyRows = (rows) => rows.map((item) => `<button type="button" class="row" data-history="${esc(item.episode.episode_id)}"><span class="row-main">${esc(historyName(item))}<small>${esc(RESOLUTIONS[item.resolution]?.[0] ?? "Episode ended")} · ${esc(date(item.resolved_at))}</small></span></button>`).join("");

export function controlsPanel(data, targets = null, saved = null) {
  const names = new Map(data.inventory.nodes.map((source) => [source.node_id, source.name]));
  for (const episode of data.inventory.episodes) names.set(episode.episode_id, names.get(episode.anchor) ?? episode.anchor);
  const records = saved ? [saved] : (data.inventory.operator_controls ?? []).filter((item) => !targets || targets.includes(item.target));
  return `<section class="panel"><div class="panel-head"><h2>${saved ? "Saved control" : "Active controls"}</h2></div><div class="body">${records.length ? records.map((item) => `<div class="note"><strong>${item.action === "shelve" ? "Alerts paused" : "Working on equipment"} · ${esc(names.get(item.target) ?? item.target)}</strong><p>Until ${esc(date(item.until))}</p>${item.action === "maintenance" ? `<p>${item.include_dependents ? "Also covers dependent equipment and functions" : "Selected equipment only"}. Existing problems and alerts remain active.</p>` : "<p>New alerts are held for every recipient, including urgent alerts. The problem remains open.</p>"}${item.reason ? `<p>${esc(item.reason)}</p>` : ""}</div>`).join("") : '<p class="sub">No active shelving or maintenance.</p>'}<p class="small">Controls expire automatically. Early cancellation is not available.</p></div></section>`;
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
    card.shadowRoot.addEventListener("click", (event) => this.clicked(event));
    card.shadowRoot.addEventListener("input", (event) => this.input(event));
    this.dialog.addEventListener("submit", (event) => {event.preventDefault(); this.execute();});
  }

  clearSelection() {this.draft = null; this.historyId = null; this.operation++;}

  close() {this.clearSelection(); this.dialog.close();}

  disconnect() {this.close();}

  update(current) {
    this.revision++;
    if (this.draft) {this.draft.preview = null; this.refreshFormState();}
    if (this.historyId) this.showHistory(this.historyId, current);
  }

  summary(data) {
    const history = data.inventory.resolved_history;
    return `<section class="panel"><div class="panel-head"><h2>Recently resolved</h2></div>${historyRows((history?.episodes ?? []).slice(0, 8))}<div class="body"><p class="small">${this.historyNote(history)}</p><button type="button" class="link" data-page="history">Browse resolved history →</button></div></section>`;
  }

  historyNote(history) {
    if (!history) return "Resolved history is unavailable from this integration version.";
    return `Up to ${esc(history.retention.max_episodes)} ended episodes within ${esc(history.retention.max_age_days)} days. Collection began ${esc(date(history.started_at))}. Earlier history is not reconstructed.`;
  }

  historyPanel(data) {
    const history = data.inventory.resolved_history;
    const result = historyPage(history, this.query, this.resolution, this.page);
    this.page = result.page;
    return `<div class="intro"><div><h1>Recently resolved</h1><p class="sub">Recovery, monitoring changes, and problems joined together.</p></div></div><section class="panel"><div class="body"><p class="small">${this.historyNote(history)}</p><div class="tool-fields"><label>Search history<input type="search" data-history-search value="${esc(this.query)}"></label><label>Outcome<select data-history-filter><option value="">All outcomes</option>${Object.entries(RESOLUTIONS).map(([value, [label]]) => `<option value="${value}"${value === this.resolution ? " selected" : ""}>${label}</option>`).join("")}</select></label></div></div>${historyRows(result.rows)}${!result.total ? '<div class="body"><p>No matching ended episodes in the retained history.</p></div>' : ""}<div class="body actions"><button type="button" class="button" data-tool="previous"${result.page === 0 ? " disabled" : ""}>Previous</button><span role="status">Page ${result.page + 1} of ${result.pages} · ${result.total} episodes</span><button type="button" class="button" data-tool="next"${result.page + 1 === result.pages ? " disabled" : ""}>Next</button></div></section>`;
  }

  detailButtons(source, episode, data) {
    return `<section class="detail"><div class="actions">${episode ? `<button type="button" class="button" data-shelf="${esc(episode.episode_id)}">Pause alerts…</button>` : ""}${["entity", "integration", "external"].includes(source.kind) ? `<button type="button" class="button" data-maintenance="${esc(source.node_id)}">Working on this equipment…</button>` : ""}</div>${(data.inventory.operator_controls ?? []).some((item) => [source.node_id, episode?.episode_id].includes(item.target)) ? controlsPanel(data, [source.node_id, episode?.episode_id]) : ""}</section>`;
  }

  clicked(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.history) this.showHistory(button.dataset.history);
    else if (button.dataset.shelf) this.openControl("shelve", button.dataset.shelf);
    else if (button.dataset.maintenance) this.openControl("maintenance", button.dataset.maintenance);
    else if (button.dataset.duration && this.draft?.kind === "maintenance") {
      this.draft.untilLocal = localEndTime(Number(button.dataset.duration));
      this.body.querySelector('[name="untilLocal"]').value = this.draft.untilLocal;
      this.draft.preview = null;
      this.draft.error = "";
      this.refreshFormState();
    }
    else if (button.dataset.tool === "close") this.close();
    else if (button.dataset.tool === "previous" || button.dataset.tool === "next") {
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
      this.query = this.card.main.querySelector("[data-history-search]").value;
      this.resolution = this.card.main.querySelector("[data-history-filter]").value;
      this.page = 0;
      this.card.render();
    } else if (this.draft && event.target.name) {
      const field = event.target;
      this.draft[field.name] = field.type === "checkbox" ? field.checked : field.value;
      this.draft.preview = null;
      this.draft.error = "";
      this.refreshFormState();
    }
  }

  showHistory(id, current = this.card.current) {
    this.card.detail = null;
    this.card.detailSequence++;
    this.card.dialog.close();
    this.historyId = id;
    this.dialog.querySelector("h2").textContent = "Ended episode";
    if (current.status !== "current") {
      this.body.innerHTML = "<p>History is unavailable while monitoring is disconnected.</p>";
    } else {
      const history = current.data.inventory.resolved_history;
      const item = history?.episodes.find((row) => row.episode.episode_id === id);
      if (!item) this.body.innerHTML = "<p>This episode is no longer in retained history.</p>";
      else {
        this.dialog.querySelector("h2").textContent = historyName(item);
        const [label, explanation] = RESOLUTIONS[item.resolution] ?? ["Episode ended", "No resolution detail is available."];
        const open = current.data.inventory.episodes.some((row) => row.episode_id === item.absorbed_into);
        const retained = history.episodes.some((row) => row.episode.episode_id === item.absorbed_into);
        this.body.innerHTML = `<section><h3>${esc(label)}</h3><p>${esc(explanation)}</p><p class="sub">Opened ${esc(date(item.episode.opened_at))}</p><p class="sub">Resolution observed ${esc(date(item.resolved_at))}</p><p class="small">This is the time Homeostatic observed the resolution, not proof of when a physical problem ended.</p></section><section><h3>Last recorded evidence</h3>${(item.episode.reasons ?? []).map((reason) => `<p>${esc(reason.message || reason.reason)}</p>`).join("") || "<p>No findings were retained.</p>"}<p class="small">Historical evidence; this is not a current health assessment.</p></section>${item.absorbed_into ? open || retained ? `<button type="button" class="button" ${open ? "data-open-episode" : "data-history"}="${esc(item.absorbed_into)}">View related problem</button>` : '<p class="sub">The related problem is no longer available in open or retained history.</p>' : ""}`;
      }
    }
    if (!this.dialog.open) this.dialog.showModal();
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
    const name = inventory.nodes.find((item) => item.node_id === nodeId)?.name ?? nodeId;
    this.dialog.querySelector("h2").textContent = kind === "shelve" ? "Pause alerts" : "Working on this equipment";
    const introduction = kind === "shelve"
      ? "Hold new alerts for every recipient, including urgent alerts, reminders and escalations. Existing messages stay visible and the problem remains open."
      : "Homeostatic will wait to open new problems for this equipment until the end time. Its observed status and home functions remain visible. Existing problems and alerts continue; situations are unaffected.";
    const duration = kind === "maintenance"
      ? '<div class="duration-choices" role="group" aria-label="Choose a maintenance duration"><button type="button" class="button" data-duration="30">30 minutes</button><button type="button" class="button" data-duration="120">2 hours</button><button type="button" class="button" data-duration="240">4 hours</button></div>'
      : "";
    const dependents = kind === "maintenance"
      ? '<label class="check-field"><input type="checkbox" name="includeDependents"> Also cover equipment and functions that depend on this</label>'
      : "";
    this.body.innerHTML = `<p><strong>${esc(name)}</strong></p><p>${introduction}</p><p class="small">${kind === "maintenance" ? "Choose a short window or enter an end time. A problem still present at expiry may open then. " : "Choose an end time within seven days. "}Early cancellation is not available.${kind === "shelve" ? " An existing shelf can only be extended." : ""}</p><form class="tool-form">${duration}<label>${kind === "maintenance" ? "Or choose an end date and time" : "End date and time"} (your local time)<input type="datetime-local" name="untilLocal" required></label>${dependents}<details><summary>Add a reason (optional)</summary><label>Reason<textarea name="reason" maxlength="500" rows="3"></textarea></label></details><div data-control-preview></div><p data-control-feedback role="status"></p><div class="actions">${kind === "maintenance" ? '<button class="button" type="button" data-tool="preview">Review what will be covered</button>' : ""}<button class="button primary" type="submit">${kind === "shelve" ? "Pause alerts" : "Start maintenance"}</button></div></form>`;
    this.dialog.showModal();
    this.refreshFormState();
  }

  scopeMarkup(scope) {
    const names = new Map(this.card.current.data.inventory.nodes.map((source) => [source.node_id, source.name]));
    const sample = (ids) => ids.slice(0, 20).map((id) => esc(names.get(id) ?? id)).join(", ") + (ids.length > 20 ? `, and ${ids.length - 20} more` : "");
    const root = scope.node_ids.find((id) => id === this.draft?.target || id === scope.control?.target);
    const other = scope.node_ids.filter((id) => id !== root && !scope.functions.includes(id));
    const openCount = scope.existing_episode_ids.length;
    return `<div class="note"><h3>What will be covered</h3><p>Selected equipment: ${esc(names.get(root) ?? root ?? "Unavailable")}</p>${other.length ? `<p>Other equipment: ${sample(other)}</p>` : ""}<p>Configured home functions in scope: ${sample(scope.functions) || "None"}</p><p>${openCount} existing ${openCount === 1 ? "problem remains" : "problems remain"} active.</p><p>Ends ${esc(date(scope.until))}</p>${this.draft?.includeDependents || scope.control?.include_dependents ? '<p class="small">Dependent scope may change if the configured relationships change. Homeostatic checks it again when you start.</p>' : ""}</div>`;
  }

  refreshFormState() {
    const draft = this.draft;
    const form = this.body.querySelector("form");
    if (!draft || !form) return;
    const allowed = controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft);
    let validation = "";
    try {controlPayload(draft);} catch (error) {validation = error.message;}
    for (const field of form.querySelectorAll("input, textarea, button")) field.disabled = draft.busy || !allowed;
    form.querySelector('[type="submit"]').disabled = draft.busy || !allowed || !!validation || (draft.kind === "maintenance" && !draft.preview);
    const preview = form.querySelector('[data-tool="preview"]');
    if (preview) preview.disabled = draft.busy || !allowed || !!validation;
    form.querySelector("[data-control-feedback]").textContent = draft.error || (draft.busy ? "Waiting for Home Assistant…" : !allowed ? "This target is no longer available, or monitoring is disconnected. No action can be submitted." : validation || (draft.kind === "maintenance" && !draft.preview ? "Review what will be covered before starting." : ""));
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
    if (!draft || draft.busy || !controlAllowed(this.card.current, this.card._hass?.user?.is_admin, draft) || (draft.kind === "maintenance" && !draft.preview)) return;
    const operation = ++this.operation;
    try {
      const data = controlPayload(draft);
      draft.busy = true;
      draft.error = "";
      this.refreshFormState();
      const result = await callAction(this.card._hass, draft.kind === "shelve" ? "shelve" : "start_maintenance", data);
      if (this.draft !== draft || operation !== this.operation) return;
      if (!result.control) throw new Error("The saved control was not returned.");
      this.body.innerHTML = `<p role="status">Saved by Home Assistant.</p>${controlsPanel(this.card.current.data, null, result.control)}${draft.kind === "maintenance" ? this.scopeMarkup(result) : ""}`;
      this.draft = null;
    } catch (error) {
      if (this.draft === draft) {
        draft.error = `${error?.message ?? "The action could not be confirmed."} Inspect active controls after recovery before retrying; the request may already have been saved.`;
        draft.preview = null;
      }
    } finally {if (this.draft === draft) {draft.busy = false; this.refreshFormState();}}
  }
}
