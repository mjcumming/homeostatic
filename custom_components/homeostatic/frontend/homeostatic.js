import {affectedFunctions, areaGroups, dashboardStore, escapeHtml as esc,
  inventoryRows, monitoringLabel, sortedEpisodes, sourceMap} from "./model.mjs";
import {integrationProblem} from "./problem.mjs";
import {DashboardTools, controlsPanel} from "./history-controls.mjs";
import {styles} from "./styles.mjs";

const VIEWS = ["overview", "house", "coverage", "functions", "problems", "history"];
const status = (value) => {
  const safe = ["ready", "blocked", "unknown", "degraded", "pass", "warn", "fail"].includes(value) ? value : "unknown";
  return `<span class="tag ${safe}">${safe[0].toUpperCase() + safe.slice(1)}</span>`;
};
const date = (value) => value ? new Date(value).toLocaleString() : "No completed update";
const list = (values) => values.map(esc).join(", ") || "None";
const json = (value) => esc(JSON.stringify(value, null, 2));
const icon = (name) => `<ha-icon icon="mdi:${name}" aria-hidden="true"></ha-icon>`;

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "overview"};
    this.page = "overview";
    this.area = null;
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Overview</button><button type="button" data-page="house">Browse the house</button><button type="button" data-page="coverage">Coverage</button><button type="button" data-page="history">Recently resolved</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
    this.main = this.shadowRoot.querySelector("main");
    this.dialog = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.addEventListener("click", (event) => this.clicked(event));
    this.tools = new DashboardTools(this);
    this.dialog.addEventListener("close", () => {this.detail = null; this.detailSequence++;});
  }

  static getStubConfig() { return {view: "overview"}; }
  getCardSize() { return this.config.view === "functions" ? 4 : 8; }

  setConfig(config) {
    if (config.view !== undefined && !VIEWS.includes(config.view)) {
      throw new Error("Homeostatic view must be overview, house, coverage, functions, problems, or history.");
    }
    this.config = {...config, view: config.view ?? "overview"};
    this.page = this.config.view;
    this.render();
  }

  set hass(value) {
    const changed = this._hass?.connection !== value.connection || this._hass?.user?.id !== value.user?.id;
    this._hass = value;
    if (changed) {
      this.release();
      this.connect();
    } else if (!this.removeListener) this.connect();
  }

  connectedCallback() { this.connect(); }
  disconnectedCallback() {
    this.release();
    this.detailSequence++;
    this.dialog.close();
  }

  release() {
    this.tools.disconnect();
    this.dialog.close();
    this.detail = null;
    this.removeListener?.();
    this.removeListener = null;
    this.store = null;
    this.current = {status: "loading", data: null, error: null};
    this.detailSequence++;
  }

  connect() {
    if (!this.isConnected || !this._hass || this.removeListener) return;
    if (!this._hass.user?.is_admin) {
      this.current = {status: "error", data: null, error: "Administrator access is required for the installation-wide dashboard."};
      this.render();
      return;
    }
    this.store = dashboardStore(this._hass.connection);
    this.removeListener = this.store.listen((value) => {
      this.current = value;
      this.tools.update(value);
      this.render();
      if (this.pendingEpisode && value.status === "current") {
        const episodeId = this.pendingEpisode;
        this.pendingEpisode = null;
        this.openDetail({episodeId});
      } else if (this.detail) this.loadDetail();
    });
  }

  render() {
    const focused = this.shadowRoot.activeElement;
    const historyFocus = focused?.hasAttribute("data-history-search") ? "[data-history-search]" : focused?.hasAttribute("data-history-filter") ? "[data-history-filter]" : null;
    const selection = historyFocus === "[data-history-search]" ? [focused.selectionStart, focused.selectionEnd] : null;
    const minimal = ["functions", "problems"].includes(this.config.view);
    this.shadowRoot.querySelector(".nav").hidden = minimal || this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = `← Back to ${{overview:"Overview",house:"House",coverage:"Coverage",functions:"Functions",problems:"Problems",history:"Recently resolved"}[this.config.view]}`;
    this.shadowRoot.querySelectorAll("[data-page]").forEach((button) => {
      if (button.closest(".nav")) {
        if (button.dataset.page === this.page) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });
    if (this.current.status !== "current") {
      const messages = {
        loading: ["Waiting for monitoring", "A fresh update is needed before health can be shown."],
        disconnected: ["Connection lost", "Current health is unknown. Reconnecting to Home Assistant."],
        unavailable: ["Monitoring unavailable", this.current.data?.error ? "Homeostatic reported an error. Check its configuration, storage and logs." : "Homeostatic is starting or has been unloaded."],
        error: ["Dashboard unavailable", this.current.error],
      };
      const [title, message] = messages[this.current.status];
      this.main.innerHTML = `<div class="banner" role="status"><h2>${esc(title)}</h2><p>${esc(message)}</p><p class="small">Last completed update: ${esc(date(this.current.data?.updated_at))}</p>${this.store && this.current.status === "error" ? '<button class="link" type="button" data-action="retry">Retry connection</button>' : ""}</div>`;
      return;
    }
    const data = this.current.data;
    if (this.page === "history") this.main.innerHTML = this.tools.historyPanel(data);
    else if (this.page === "functions") this.main.innerHTML = this.functionsPanel(data);
    else if (this.page === "problems") this.main.innerHTML = this.problems(data);
    else if (this.page === "coverage") this.main.innerHTML = this.coverage(data);
    else if (this.page === "house") this.main.innerHTML = this.house(data);
    else this.main.innerHTML = this.overview(data);
    if (historyFocus) {
      const input = this.main.querySelector(historyFocus);
      input?.focus();
      if (selection) input?.setSelectionRange(...selection);
    }
  }

  problems(data) {
    const nodes = sourceMap(data);
    const episodes = sortedEpisodes(data);
    if (!episodes.length) {
      const notReady = data.functions.filter((f) => f.readiness.answer !== "ready");
      const detail = !data.functions.length ? "No functions are defined. Coverage below shows what is watched."
        : notReady.length ? `${notReady.length} function(s) are not confirmed ready. Review their requirements and evidence.`
        : "All defined functions are ready based on their current checks.";
      return `<section class="empty"><h2>No open problems</h2><p class="sub">${esc(detail)}</p></section>`;
    }
    return episodes.map((episode) => {
      const source = nodes.get(episode.anchor);
      const situation = source?.kind === "situation";
      const affected = affectedFunctions(data, episode);
      const title = situation ? source.name : affected.length === 1 ? `${affected[0].name}: ${affected[0].readiness.answer}`
        : affected.length ? `${affected.length} functions need attention` : source?.name ?? episode.anchor;
      const problem = integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor]);
      const reasons = episode.reasons.map((r) => r.message || r.reason.replaceAll("_", " "));
      const summary = problem ? problem.summary : reasons.join("; ") || "Evidence is unknown";
      return `<section class="issue ${problem?.tone ?? (situation ? "situation" : "failure")}"><p class="small">${situation ? "Situation" : "Open problem"} · ${esc(episode.importance)} importance${problem ? ` · ${esc(problem.integration)}` : ""} · Since ${esc(date(episode.opened_at))}</p><div class="issue-heading"><h2>${esc(title)}</h2>${problem ? `<span class="condition ${problem.tone}">${esc(problem.headline)}</span>` : ""}</div><p>${esc(summary)}</p><div class="actions"><button type="button" class="button primary" data-episode="${esc(episode.episode_id)}">View problem</button></div></section>`;
    }).join("");
  }

  functionsPanel(data, selected = data.functions) {
    const nodes = sourceMap(data);
    return `<section class="panel"><div class="panel-head"><h2>Home functions</h2><span class="small">${selected.length} defined</span></div>${selected.length ? selected.map((item) => {
      const causes = item.readiness.nodes.map((node) => nodes.get(node.node_id)?.name ?? node.node_id);
      return `<button type="button" class="row" data-node="${esc(item.node_id)}">${icon("check-network-outline")}<span class="row-main">${esc(item.name)}<small>${esc(causes.join(", ") || "Declared requirements pass their current checks")}</small></span>${status(item.readiness.answer)}</button>`;
    }).join("") : '<div class="body"><p class="sub">Define functions in Homeostatic options to describe the jobs your house should perform.</p></div>'}</section>`;
  }

  coveragePanel(data) {
    const watched = data.inventory.catalog.watched;
    return `<section class="panel"><div class="panel-head"><h2>Monitoring coverage</h2></div><div class="body"><div class="stat"><span>Watched equipment sources</span><strong>${watched}</strong></div><div class="stat"><span>Evidence gaps</span><strong>${data.evidence_gaps}</strong></div><div class="stat"><span>Never observed checks</span><strong>${data.coverage.never_observed.length}</strong></div><div class="note">Availability checks do not establish physical freshness, detector progress or command completion.</div>${data.coverage.notification_consumer_missing ? '<p class="sub">The selected notification consumer is missing or disabled.</p>' : ""}<button type="button" class="link" data-page="coverage">See checks and enrollment →</button></div></section>`;
  }

  overview(data) {
    const groups = areaGroups(data).slice(0, 6);
    return `<div class="intro"><div><h1>Your home, at a glance</h1><p class="sub">What needs attention, and what your house can do.</p></div><span class="small">Updated ${esc(date(data.updated_at))}</span></div>${this.problems(data)}<div class="grid"><div class="stack">${this.functionsPanel(data)}${this.tools.summary(data)}${this.changes(data)}</div><div class="stack">${this.coveragePanel(data)}${controlsPanel(data)}<section class="panel"><div class="panel-head"><h2>Browse the house</h2></div>${groups.map((area) => `<button type="button" class="row" data-area="${esc(area.id)}"><span class="row-main">${esc(area.name)}<small>${esc(area.floor)}</small></span><span class="small">${area.sources.length} sources</span></button>`).join("")}<div class="body"><button type="button" class="link" data-page="house">All locations →</button></div></section></div></div>`;
  }

  changes(data) {
    const names = new Map(inventoryRows(data).map((item) => [item.node_id, item.name]));
    return `<section class="panel"><div class="panel-head"><h2>Recent enrollment changes</h2></div><div class="body"><p class="small">Last 50 changes from this runtime. Resolved problems appear in Recently resolved.</p>${data.inventory.enrollment_changes.length ? [...data.inventory.enrollment_changes].reverse().slice(0, 8).map((change) => `<details><summary>${esc(names.get(change.node_id) ?? change.node_id)}</summary><pre>${json(change)}</pre></details>`).join("") : '<p class="sub">No enrollment changes recorded in this runtime.</p>'}</div></section>`;
  }

  sourceTable(data, rows) {
    const registered = sourceMap(data);
    return `<div class="table-wrap"><table><thead><tr><th>Capability</th><th>Monitoring</th><th>Rule provenance</th></tr></thead><tbody>${rows.map((source) => `<tr><td>${registered.has(source.node_id) ? `<button type="button" class="link" data-node="${esc(source.node_id)}">${esc(source.name)}</button>` : esc(source.name)}<small>${esc(source.kind)}</small></td><td>${esc(monitoringLabel(source))}</td><td><span class="mono">${list(source.excluded_by.length ? source.excluded_by : source.attached_by)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }

  coverage(data) {
    const names = new Map(inventoryRows(data).map((row) => [row.node_id, row.name]));
    const gapRows = [
      ...data.coverage.no_checks.map((id) => [id, "No own checks"]),
      ...data.coverage.never_observed.map((item) => [item.node_id, `Never observed: ${item.check_id}`]),
      ...data.coverage.stale.map((item) => [item.node_id, `Stale: ${item.check_id}`]),
    ];
    return `<div class="intro"><div><h1>What is monitored</h1><p class="sub">Enrollment and evidence are separate questions.</p></div></div><div class="grid"><div class="stack"><section class="panel"><div class="panel-head"><h2>Inventory and rules</h2></div>${this.sourceTable(data, inventoryRows(data))}</section><section class="panel"><div class="panel-head"><h2>Evidence details</h2></div><div class="body"><p class="small">Composite functions may have no own checks; their requirements determine readiness. Categories can overlap.</p>${gapRows.length ? gapRows.map(([id, reason]) => `<p class="sub">${esc(names.get(id) ?? id)} · ${esc(reason)}</p>`).join("") : '<p class="sub">No missing or stale check evidence in the registered model.</p>'}</div></section></div><div class="stack">${this.coveragePanel(data)}<section class="panel"><div class="panel-head"><h2>Notifications</h2></div><div class="body"><p>${data.policy.notifications_enabled ? "Notification events enabled" : "Notification events off"}</p><p class="sub">Requests do not establish phone receipt.</p><details><summary>Routes and current controls</summary><pre>${json({routes:data.policy.routes,controls:data.inventory.operator_controls})}</pre></details></div></section></div></div>`;
  }

  house(data) {
    const groups = areaGroups(data);
    const selected = groups.find((area) => area.id === this.area) ?? groups[0];
    const ids = new Set(selected?.sources.map((source) => source.node_id) ?? []);
    const related = data.functions.filter((item) =>
      ids.has(item.node_id) || item.requirements.some((id) => ids.has(id)));
    return `<div class="intro"><div><h1>Browse the house</h1><p class="sub">Home Assistant areas and floors</p></div></div>${selected ? `<div class="house"><section class="panel locations" aria-label="Locations">${groups.map((area) => `<button type="button" class="location" data-area="${esc(area.id)}" aria-pressed="${area.id === selected.id}"><span class="small">${esc(area.floor)}</span><br>${esc(area.name)}</button>`).join("")}</section><div class="stack"><section class="panel"><div class="panel-head"><h2>${esc(selected.name)}</h2></div>${this.sourceTable(data, selected.sources)}<div class="body"><p class="sub">Location membership never creates a health dependency.</p></div></section>${this.functionsPanel(data, related)}<p class="small">Functions shown here have direct requirements in this location. Open a function to see shared causes outside the area.</p></div></div>` : '<div class="empty">No enrolled or candidate sources have been discovered.</div>'}`;
  }

  clicked(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.page) {this.page = button.dataset.page; this.render();}
    else if ("area" in button.dataset) {this.area = button.dataset.area; this.page = "house"; this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") this.dialog.close();
    else if (button.dataset.action === "retry") this.store?.retry();
  }

  openDetail(selection) {
    this.detail = selection;
    this.shadowRoot.querySelector("#detail-title").textContent = "Problem details";
    this.shadowRoot.querySelector("#detail-label").textContent = "Current evidence";
    this.shadowRoot.querySelector(".dialog-body").innerHTML = "<p>Loading current evidence…</p>";
    if (!this.dialog.open) this.dialog.showModal();
    this.loadDetail();
  }

  async loadDetail() {
    const sequence = ++this.detailSequence;
    const body = this.shadowRoot.querySelector(".dialog-body");
    const selection = this.detail;
    const {status: connectionStatus, data} = this.current;
    if (connectionStatus !== "current") {
      this.shadowRoot.querySelector("#detail-label").textContent = "Evidence unavailable";
      body.innerHTML = "<p>Current evidence is unavailable. Wait for monitoring to reconnect.</p>";
      return;
    }
    const episode = selection.episodeId ? data.inventory.episodes.find((item) => item.episode_id === selection.episodeId) : null;
    if (selection.episodeId && !episode) {
      this.shadowRoot.querySelector("#detail-label").textContent = "No longer open";
      body.innerHTML = "<p>This episode is no longer open. It may have recovered, been absorbed into another problem, or been removed from monitoring.</p>";
      return;
    }
    const nodeId = episode?.anchor ?? selection.nodeId;
    try {
      const result = await this._hass.callWS({type: "homeostatic/node", node_id: nodeId});
      if (sequence !== this.detailSequence || !this.detail) return;
      const source = result.source;
      const nodes = sourceMap(data);
      this.shadowRoot.querySelector("#detail-title").textContent = source.name;
      this.shadowRoot.querySelector("#detail-label").textContent = source.kind === "situation" ? "Situation" : episode ? "Open problem" : "Capability";
      const currentFunctions = episode ? affectedFunctions(data, episode) : [];
      const findings = result.explanation.findings;
      const problem = integrationProblem(source, findings, (key) => this._hass.localize?.(key), result.integration_evidence);
      const dependencies = result.explanation.nodes.filter((node) => node.node_id !== nodeId);
      const unwatched = result.readiness?.nodes.filter((node) => !node.watched) ?? [];
      const integrationLink = problem ? `<a class="button ${problem.logsPrimary ? "" : "primary"}" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : "";
      const logsLink = problem?.logsUrl ? `<a class="button ${problem.logsPrimary ? "primary" : ""}" href="${esc(problem.logsUrl)}">View integration logs</a>` : "";
      const nativeLink = problem ? (problem.logsPrimary ? logsLink + integrationLink : integrationLink + logsLink) : source.entity_id
        ? `<button class="button" type="button" data-entity="${esc(source.entity_id)}">Open entity in HA</button>`
        : source.entry_id || source.owner_id ? '<a class="button" href="/config/integrations">Open integrations in HA</a>' : "";
      const requests = episode ? data.inventory.notification_requests.filter((item) => item.episode_id === episode.episode_id) : [];
      const explanation = episode ? data.policy.episodes.find((item) => item.episode_id === episode.episode_id) : null;
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      body.innerHTML = `<section class="detail">${problem ? `<p class="small">${esc(problem.integration)} · Integration</p><h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>${episode && problem.currentReason === "loaded" ? '<p class="note">This problem remains open until recovery is confirmed.</p>' : ""}${problem.reported ? `<details class="reported-error" ${disclosure("reported-error")}><summary>${problem.historical ? "Last reported error" : "Reported error"}${problem.reportedAt ? ` · ${esc(date(problem.reportedAt))}` : ""}</summary>${problem.historical ? '<p class="sub">Earlier evidence, retained for context during the current state.</p>' : ""}<p class="mono">${esc(problem.reported)}</p></details>` : ""}${problem.missingDetail ? "<p class='sub'>Home Assistant did not provide a specific cause. The integration logs may have more detail.</p>" : ""}` : `${result.readiness ? status(result.readiness.answer) : ""}${findings.length ? findings.map((finding) => `<p>${esc(finding.message || finding.reason.replaceAll("_", " "))}</p>`).join("") : "<p>No current failure is reported for this capability.</p>"}`}<p class="sub">${episode ? `Open since ${esc(date(episode.opened_at))}` : "Current evaluated evidence"}</p></section>
        ${dependencies.length || unwatched.length ? `<section class="detail"><h3>What is preventing this from working</h3>${dependencies.length ? `<ul>${dependencies.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · ${esc(node.own)} · ${list(node.reasons)}</li>`).join("")}</ul>` : ""}${unwatched.map((node) => `<p>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · Unwatched requirement</p>`).join("")}</section>` : ""}
        ${currentFunctions.length ? `<section class="detail"><h3>Currently affected functions</h3><ul>${currentFunctions.map((item) => `<li>${esc(item.name)} · ${esc(item.readiness.answer)}</li>`).join("")}</ul></section>` : ""}
        <section class="detail"><h3>What you can do</h3><p>${esc(problem?.nextStep ?? "Review this capability and any reported causes in Home Assistant.")}</p><div class="actions">${nativeLink || "<span class='small'>No native source page is available for this declaration.</span>"}</div></section>
        ${problem && !data.functions.length ? '<p class="sub">No home functions are defined yet. This report describes the integration connection; it does not establish which household activities are affected.</p>' : ""}
        ${this.tools.detailButtons(source, episode, data)}
        ${source.kind === "function" ? `<section class="detail"><h3>Declared requirements</h3><ul>${source.requirements.map((id) => `<li><button class="link" type="button" data-node="${esc(id)}">${esc(nodes.get(id)?.name ?? id)}</button></li>`).join("")}</ul></section>` : ""}
        ${episode ? `<details ${disclosure("notifications")}><summary>Notifications and active controls</summary><p>${data.policy.notifications_enabled ? requests.length ? "Notification content has been requested. Receipt is not verified." : "No current notification request is recorded. Policy may hold or record this problem." : "Notification events are off."}</p>${requests.map((request) => `<div class="note"><strong>${esc(request.title)}</strong><p>${esc(request.message)}</p><p class="small">${esc(request.recipient)} · ${list(request.channels)} · ${esc(request.loudness)}</p></div>`).join("")}<pre>${json({policy:explanation,controls:data.inventory.operator_controls.filter((control) => control.target === episode.episode_id || control.target === nodeId)})}</pre></details>` : ""}
        <details ${disclosure("technical")}><summary>Technical evidence and potential impact</summary>${result.readiness ? `<p>Readiness: ${esc(result.readiness.answer)}</p>` : ""}<p class="sub">Availability alone does not identify a physical fault or verify command completion. Potential dependents are not a claim that every dependent is currently failing.</p><pre>${json(result)}</pre></details>`;
      body.querySelector("[data-entity]")?.addEventListener("click", (event) => {
        this.dialog.close();
        this.dispatchEvent(new CustomEvent("hass-more-info", {bubbles:true,composed:true,detail:{entityId:event.currentTarget.dataset.entity}}));
      });
    } catch (error) {
      if (sequence === this.detailSequence) body.innerHTML = `<p>${esc(error?.message ?? "Could not load current evidence.")}</p>`;
    }
  }
}

class HomeostaticPanel extends HomeostaticCard {
  set route(value) {
    const match = value?.path?.match(/^\/episode\/([^/]+)$/);
    if (match) {
      try {
        const episodeId = decodeURIComponent(match[1]);
        if (this.isConnected && this.current.status === "current") this.openDetail({episodeId});
        else this.pendingEpisode = episodeId;
      } catch { this.pendingEpisode = null; }
    }
  }
}

class HomeostaticStrategy {
  static getCreateSuggestions() { return {title:"Homeostatic",icon:"mdi:home-heart"}; }
  static async generate() {
    return {title:"Homeostatic",views:[
      {title:"Overview",path:"overview",type:"panel",cards:[{type:"custom:homeostatic-card",view:"overview",navigation:false}]},
      {title:"House",path:"house",type:"panel",cards:[{type:"custom:homeostatic-card",view:"house",navigation:false}]},
      {title:"Recently resolved",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card",view:"history",navigation:false}]},
      {title:"Coverage",path:"coverage",type:"panel",cards:[{type:"custom:homeostatic-card",view:"coverage",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card")) customElements.define("homeostatic-card", HomeostaticCard);
if (!customElements.get("homeostatic-panel")) customElements.define("homeostatic-panel", HomeostaticPanel);
if (!customElements.get("ll-strategy-dashboard-homeostatic")) customElements.define("ll-strategy-dashboard-homeostatic", class extends HTMLElement {
  static getCreateSuggestions() { return HomeostaticStrategy.getCreateSuggestions(); }
  static generate() { return HomeostaticStrategy.generate(); }
});
window.customCards = window.customCards || [];
if (!window.customCards.some((item) => item.type === "homeostatic-card")) window.customCards.push({
  type:"homeostatic-card",name:"Homeostatic",description:"Live problems, functions, locations and monitoring coverage.",
});
window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((item) => item.type === "homeostatic")) window.customStrategies.push({
  type:"homeostatic",strategyType:"dashboard",name:"Homeostatic",description:"A dashboard populated from Homeostatic monitoring.",
});
