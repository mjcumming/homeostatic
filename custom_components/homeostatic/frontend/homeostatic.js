import {affectedFunctions, browseHighlights, coverageInventory, dashboardStore, escapeHtml as esc,
  inventoryRows, locationList, locationTree, monitoringLabel, sortedEpisodes,
  recentActivity, sourceMap, sourcePage} from "./model.mjs?v=10";
import {entityProblem, integrationProblem} from "./problem.mjs?v=10";
import {DashboardTools, controlsPanel} from "./history-controls.mjs?v=10";
import {styles} from "./styles.mjs?v=10";

const VIEWS = ["overview", "house", "coverage", "functions", "problems", "history"];
const status = (value) => {
  const safe = ["ready", "blocked", "unknown", "degraded", "pass", "warn", "fail"].includes(value) ? value : "unknown";
  return `<span class="tag ${safe}">${safe[0].toUpperCase() + safe.slice(1)}</span>`;
};
const date = (value) => value ? new Date(value).toLocaleString() : "No completed update";
const list = (values) => values.map(esc).join(", ") || "None";
const json = (value) => esc(JSON.stringify(value, null, 2));
const ownerStatus = (value) => ({ready:"Available",blocked:"Unavailable",unknown:"Not confirmed",degraded:"Limited"}[value] ?? "Not confirmed");
const icon = (name) => `<ha-icon icon="mdi:${name}" aria-hidden="true"></ha-icon>`;

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "overview"};
    this.page = "overview";
    this.location = null;
    this.sourceQuery = '';
    this.sourcePage = 0;
    this.sourceScope = null;
    this.coverageQuery = "";
    this.coverageDisclosure = new Map();
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Overview</button><button type="button" data-page="house">Browse the house</button><button type="button" data-page="coverage">Coverage</button><button type="button" data-page="history">Recently resolved</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
    this.main = this.shadowRoot.querySelector("main");
    this.dialog = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.addEventListener("click", (event) => this.clicked(event));
    this.shadowRoot.addEventListener("keydown", (event) => this.keydown(event));
    this.shadowRoot.addEventListener("input", event => {
      if (event.target.matches("[data-source-search]")) {
        this.sourceQuery = event.target.value;
        this.sourcePage = 0;
        this.render();
      } else if (event.target.matches("[data-coverage-search]")) {
        this.coverageQuery = event.target.value;
        this.render();
      }
    });
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
    const historyFocus = focused?.hasAttribute("data-source-search") ? "[data-source-search]" : focused?.hasAttribute("data-coverage-search") ? "[data-coverage-search]" : focused?.hasAttribute("data-history-search") ? "[data-history-search]" : focused?.hasAttribute("data-history-filter") ? "[data-history-filter]" : null;
    const selection = ["[data-source-search]", "[data-coverage-search]", "[data-history-search]"].includes(historyFocus) ? [focused.selectionStart, focused.selectionEnd] : null;
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
      const title = source?.name ?? "Monitored connection";
      const problem = integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor]) ??
        entityProblem(source, data.inventory.entity_status?.[episode.anchor], nodes.get(`entry:${source?.owner_id}`), data.areas, (key) => this._hass.localize?.(key));
      const summary = problem?.summary ?? (situation ? "This reported condition remains open. Check its current state." : "Home Assistant reports a problem. Open the details to check what is affected.");
      const impact = affected.map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`).join("; ");
      return `<section class="issue ${problem?.tone ?? (situation ? "situation" : "failure")}"><p class="small">${esc(problem?.context ?? problem?.integration ?? (situation ? "Situation" : "Home Assistant"))}${["high","critical"].includes(episode.importance) ? ` · ${esc(episode.importance === "critical" ? "Critical" : "Important")}` : ""}</p><h2>${esc(title)}</h2>${problem ? `<h3 class="issue-condition">${esc(problem.headline)}</h3>` : ""}<p>${esc(summary)}</p>${impact ? `<p class="impact-line">${esc(impact)}</p>` : ""}<p class="small problem-progress">Since ${esc(date(episode.opened_at))}${problem ? ` · ${esc(problem.progress)}` : ""}</p><div class="actions">${problem?.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : ""}<button type="button" class="${problem?.needsAction ? "link" : "button"}" data-episode="${esc(episode.episode_id)}">${source?.kind === "entity" ? "What to check" : "View details"}</button></div></section>`;
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
    const locations = browseHighlights(data);
    return `<div class="intro"><div><h1>Your home, at a glance</h1><p class="sub">What needs attention, and what your house can do.</p></div><span class="small">Updated ${esc(date(data.updated_at))}</span></div>${this.problems(data)}<div class="grid"><div class="stack">${this.functionsPanel(data)}${this.tools.summary(data)}</div><div class="stack">${this.coveragePanel(data)}${controlsPanel(data)}<section class="panel"><div class="panel-head"><h2>Browse the house</h2></div>${locations.map((location) => `<button type="button" class="row" data-location="${esc(location.id)}"><span class="row-main">${esc(location.name)}<small>${esc(location.parent_name)}</small></span><span class="small">${location.sources.length} sources</span></button>`).join("")}<div class="body"><button type="button" class="link" data-page="house">All locations →</button></div></section></div></div>`;
  }

  changes(data) {
    const entries = recentActivity(data).map((entry) => {
      const action = entry.kind === "source" && entry.registered
        ? `<button type="button" class="link" data-node="${esc(entry.nodeId)}">View source</button>`
        : '<button type="button" class="link" data-page="coverage">Review monitoring</button>';
      const names = entry.kind === "group"
        ? `<p class="activity-names small">${esc(entry.names.slice(0,3).join(", "))}${entry.names.length > 3 ? ` and ${entry.names.length - 3} more` : ""}</p>` : "";
      return `<article class="activity-item"><div class="activity-copy"><strong>${esc(entry.title)}</strong><p>${esc(entry.summary)}</p>${names}<p class="small">${esc(date(entry.at))}</p></div><div class="activity-actions">${action}<details><summary>Technical record</summary><pre>${json(entry.technical)}</pre></details></div></article>`;
    }).join("");
    return `<section class="panel"><div class="panel-head"><h2>Why monitoring changed</h2></div><div class="body"><p class="small">Use this history when a source appears or disappears from monitoring. These are setup and rule changes, not household problems.</p></div>${entries || '<div class="body"><p class="sub">No monitoring changes recorded in this session.</p></div>'}</section>`;
  }

  sourceTable(data, rows) {
    const registered = sourceMap(data);
    const scope = `${this.page}:${this.page === "house" ? this.location : "all"}`;
    if (scope !== this.sourceScope) {
      this.sourceScope = scope;
      this.sourceQuery = "";
      this.sourcePage = 0;
    }
    const result = sourcePage(rows, this.sourceQuery, this.sourcePage);
    this.sourcePage = result.page;
    return `<div class="body"><label>Find a source <input type="search" data-source-search value="${esc(this.sourceQuery)}"></label><p class="small">${result.total} sources · Page ${result.page + 1} of ${result.pages}</p></div><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Monitoring</th><th>Rule provenance</th></tr></thead><tbody>${result.rows.map((source) => `<tr><td>${registered.has(source.node_id) ? `<button type="button" class="link" data-node="${esc(source.node_id)}">${esc(source.name)}</button>` : esc(source.name)}<small>${esc(source.kind)}</small></td><td>${esc(monitoringLabel(source))}</td><td><span class="mono">${list(source.excluded_by.length ? source.excluded_by : source.attached_by)}</span></td></tr>`).join("")}</tbody></table></div><div class="body actions"><button class="button" type="button" data-source-step="-1" ${result.page === 0 ? "disabled" : ""}>Previous sources</button><button class="button" type="button" data-source-step="1" ${result.page + 1 >= result.pages ? "disabled" : ""}>Next sources</button></div>`;
  }

  locationBranch(location, selectedId, depth = 1) {
    const selected = location.id === selectedId;
    const count = `${location.sources.length} source${location.sources.length === 1 ? "" : "s"}`;
    return `<div class="location-branch"><button type="button" class="location ${location.children.length ? "location-parent" : ""}" data-location="${esc(location.id)}" role="treeitem" aria-level="${depth}" aria-selected="${selected}"${location.children.length ? ' aria-expanded="true"' : ""}><span class="location-name">${esc(location.name)}</span><span class="small">${esc(count)}</span></button>${location.children.length ? `<div class="location-children" role="group">${location.children.map((child) => this.locationBranch(child, selectedId, depth + 1)).join("")}</div>` : ""}</div>`;
  }

  coverageExpanded(id, gaps, searching) {
    return searching || (this.coverageDisclosure.has(id)
      ? this.coverageDisclosure.get(id) : gaps > 0);
  }

  coverageSource(item) {
    const source = item.source;
    const rules = source.excluded_by.length ? source.excluded_by : source.attached_by;
    const affected = item.affectedFunctions.length
      ? `<span class="coverage-impact">Readiness impact: ${esc(item.affectedFunctions.map((fn) => `${fn.name} (${fn.readiness})`).join(", "))}</span>` : "";
    const guidance = item.guidance
      ? `<span class="coverage-guidance">Next: ${esc(item.guidance)}</span>` : "";
    const evidence = item.reasons.length
      ? `${item.reasons.map((reason) => `<span class="coverage-gap">${esc(reason)}</span>`).join("")}${affected}${guidance}`
      : `<span class="small">${esc(item.registered ? "No coverage gap reported" : monitoringLabel(source))}</span>`;
    const name = item.registered
      ? `<button type="button" class="link coverage-name" data-node="${esc(source.node_id)}">${esc(source.name)}</button>`
      : `<span class="coverage-name">${esc(source.name)}</span>`;
    const areas = source.attributes.area?.length
      ? `<span class="small">Area reference: ${esc(source.attributes.area.join(", "))}</span>` : "";
    return `<div class="coverage-source${item.reasons.length ? " has-gap" : ""}"><div>${name}<span class="small">${esc(source.kind)}</span>${areas}</div><div class="coverage-evidence">${evidence}</div>${rules.length ? `<details class="rule-details"><summary>Technical rule details</summary><span class="mono">${list(rules)}</span></details>` : ""}</div>`;
  }

  coverageDevice(device, groupId, searching) {
    const id = `${groupId}/${device.id}`;
    const expanded = this.coverageExpanded(id,device.gaps,searching);
    const summary = `${device.count} ${device.count === 1 ? "capability" : "capabilities"}${device.gaps ? ` · ${device.gaps} ${device.gaps === 1 ? "gap" : "gaps"}` : ""}`;
    return `<div class="coverage-device"><button type="button" class="coverage-toggle device-toggle" data-coverage-toggle="${esc(id)}" aria-expanded="${expanded}"><span class="disclosure" aria-hidden="true"></span><span>${esc(device.name)}</span><span class="small">${esc(summary)}</span></button><div class="coverage-sources"${expanded ? "" : " hidden"}>${device.sources.map((item) => this.coverageSource(item)).join("")}</div></div>`;
  }

  coverageGroup(group, searching) {
    const expanded = this.coverageExpanded(group.id,group.gaps,searching);
    const summary = `${group.count} ${group.count === 1 ? "capability" : "capabilities"}${group.gaps ? ` · ${group.gaps} ${group.gaps === 1 ? "gap" : "gaps"}` : ""}`;
    return `<section class="coverage-group"><button type="button" class="coverage-toggle integration-toggle" data-coverage-toggle="${esc(group.id)}" aria-expanded="${expanded}"><span class="disclosure" aria-hidden="true"></span><span>${esc(group.name)}</span><span class="small">${esc(summary)}</span></button><div class="coverage-devices"${expanded ? "" : " hidden"}>${group.devices.map((device) => this.coverageDevice(device,group.id,searching)).join("")}</div></section>`;
  }

  coverage(data) {
    const view = coverageInventory(data,this.coverageQuery);
    const searching = Boolean(view.query);
    const gapItems = view.groups.flatMap((group) => group.devices.flatMap((device) =>
      device.sources.filter((item) => item.reasons.length)));
    const attention = !searching && gapItems.length
      ? `<section class="panel"><div class="panel-head"><h2>Needs attention</h2><span class="tag unknown">${view.summary.gaps} ${view.summary.gaps === 1 ? "gap" : "gaps"}</span></div><div class="coverage-attention">${gapItems.map((item) => this.coverageSource(item)).join("")}</div></section>`
      : !searching ? '<section class="empty coverage-clear"><h2>No coverage gaps reported</h2><p class="sub">Every capability in the current model has observed, non-stale check evidence.</p></section>' : "";
    const bounded = searching && view.resultCount > view.shownCount
      ? ` · showing first ${view.shownCount}` : "";
    const heading = searching ? `Search results · ${view.resultCount}${bounded}` : "Current monitoring by integration";
    const groups = view.groups.length
      ? view.groups.map((group) => this.coverageGroup(group,searching)).join("")
      : `<div class="body"><p class="sub">${searching ? "No source matches this search." : "No capabilities are currently registered."}</p></div>`;
    return `<div class="intro"><div><h1>Monitoring coverage</h1><p class="sub">What Homeostatic watches, where evidence is missing, why, and what to review next.</p></div></div><section class="coverage-summary" aria-label="Coverage summary"><div><strong>${view.summary.watched}</strong><span>Watched</span></div><div class="${view.summary.gaps ? "has-gap" : ""}"><strong>${view.summary.gaps}</strong><span>Evidence gaps</span></div><div><strong>${view.summary.excluded}</strong><span>Excluded</span></div><div><strong>${view.summary.unselected}</strong><span>Other discovered</span></div></section><label class="coverage-search"><span>Find an integration, device, source, or rule</span><input type="search" data-coverage-search value="${esc(this.coverageQuery)}" placeholder="Search all discovered sources"></label>${attention}<section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2>${searching ? '<button type="button" class="link" data-action="clear-coverage-search">Clear search</button>' : ""}</div><div class="coverage-groups">${groups}</div></section>${!searching ? `<section class="panel"><div class="panel-head"><h2>Outside the current model</h2></div><div class="body"><details><summary>${view.summary.excluded} excluded by rules</summary><p class="sub">These sources remain discoverable so an exclusion can be explained. Search above to inspect one.</p></details><details><summary>${view.summary.unselected} other discovered sources</summary><p class="sub">These Home Assistant sources are not selected for monitoring and are not coverage gaps by themselves. Search above to inspect one.</p></details></div></section>${this.changes(data)}` : ""}`;
  }

  house(data) {
    const tree = locationTree(data);
    const locations = locationList(tree);
    const selected = locations.find((location) => location.id === this.location) ??
      locations.find((location) => location.kind === "area") ?? locations[0];
    this.location = selected?.id ?? null;
    const ids = new Set(selected?.sources.map((source) => source.node_id) ?? []);
    const related = data.functions.filter((item) =>
      ids.has(item.node_id) || item.requirements.some((id) => ids.has(id)));
    const contents = selected?.sources.length ? this.sourceTable(data, selected.sources)
      : '<div class="body"><p class="sub">No enrolled or candidate sources are assigned here.</p></div>';
    return `<div class="intro"><div><h1>Browse the house</h1><p class="sub">Home Assistant floors and areas</p></div></div>${selected ? `<div class="house"><section class="panel locations" aria-label="Locations"><div class="location-tree" role="tree">${tree.map((location) => this.locationBranch(location, selected.id)).join("")}</div></section><div class="stack"><section class="panel"><div class="panel-head"><div><p class="small">${esc(selected.parent_name)}</p><h2>${esc(selected.name)}</h2></div><span class="small">${esc(selected.kind === "area" ? "Area" : selected.kind === "floor" ? "Floor" : "Location group")}</span></div>${contents}<div class="body"><p class="sub">Location membership never creates a health dependency.</p></div></section>${this.functionsPanel(data, related)}<p class="small">Functions shown here have direct requirements in this location. Open a function to see shared causes outside the location.</p></div></div>` : '<div class="empty">No Home Assistant floors, areas, or unassigned sources have been discovered.</div>'}`;
  }

  clicked(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.coverageToggle) {
      this.coverageDisclosure.set(button.dataset.coverageToggle,button.getAttribute("aria-expanded") !== "true");
      this.render();
    }
    else if (button.dataset.sourceStep) {this.sourcePage += Number(button.dataset.sourceStep); this.render();}
    else if (button.dataset.page) {this.page = button.dataset.page; this.render();}
    else if (button.dataset.location) {this.location = button.dataset.location; this.page = "house"; this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") this.dialog.close();
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "clear-coverage-search") {this.coverageQuery = ""; this.render();}
  }

  keydown(event) {
    const button = event.target.closest?.("button.coverage-toggle");
    if (!button || !["ArrowLeft","ArrowRight"].includes(event.key)) return;
    const expanded = button.getAttribute("aria-expanded") === "true";
    const next = event.key === "ArrowRight";
    if (expanded === next) return;
    event.preventDefault();
    this.coverageDisclosure.set(button.dataset.coverageToggle,next);
    this.render();
  }

  openDetail(selection) {
    this.detail = selection;
    this.shadowRoot.querySelector("#detail-title").textContent = "Problem details";
    this.shadowRoot.querySelector("#detail-label").textContent = "Current status";
    this.shadowRoot.querySelector(".dialog-body").innerHTML = "<p>Loading current status…</p>";
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
      const problem = integrationProblem(source, findings, (key) => this._hass.localize?.(key), result.integration_evidence, Boolean(episode)) ??
        entityProblem(source, result.entity_status, nodes.get(`entry:${source.owner_id}`), data.areas, (key) => this._hass.localize?.(key), Boolean(episode));
      const dependencies = result.explanation.nodes.filter((node) => node.node_id !== nodeId);
      const unwatched = result.readiness?.nodes.filter((node) => !node.watched) ?? [];
      const nativeLink = source.kind === "integration" && problem ? (problem.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : "") : source.entity_id
        ? `<button class="button primary" type="button" data-entity="${esc(source.entity_id)}">${esc(problem?.entityLabel ?? "View in Home Assistant")}</button>`
        : source.entry_id || source.owner_id ? '<a class="button primary" href="/config/integrations">Review connection</a>' : "";
      const explanation = episode ? data.policy.episodes.find((item) => item.episode_id === episode.episode_id) : null;
      const controls = (data.inventory.operator_controls ?? []).filter((control) => [episode?.episode_id, nodeId].includes(control.target));
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      const genericSummary = source.kind === "situation" ? (episode ? "This reported condition remains open. Check its current state." : "No open problem is reported for this condition.")
        : result.readiness ? `${ownerStatus(result.readiness.answer)} in Home Assistant.` : "Current status has not been confirmed.";
      body.innerHTML = `<section class="detail problem-brief">${problem ? `<p class="small">${esc(problem.context ?? problem.integration)}</p><h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}</section>
        ${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}
        ${problem?.connectionNote ? `<section class="detail"><p>${esc(problem.connectionNote)}</p><button class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button></section>` : ""}
        <section class="detail next-action"><h3>What you can do</h3><p>${esc(problem?.nextStep ?? (nativeLink ? "Check the current state in Home Assistant." : "Check the listed requirements to find what needs attention."))}</p>${nativeLink || problem?.deviceUrl ? `<div class="actions">${nativeLink}${problem?.deviceUrl ? `<a class="button" href="${esc(problem.deviceUrl)}">Open device page</a>` : ""}</div>` : ""}</section>
        <p class="small problem-progress">${episode ? `Since ${esc(date(episode.opened_at))}` : "Current status"}${problem ? ` · ${esc(problem.progress)}` : ""}</p>
        ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Maintenance"} until ${esc(date(control.until))}.</p>`).join("")}
        <details ${disclosure("manage")}><summary>${episode ? "Manage this problem" : "Manage this device"}</summary>${this.tools.detailButtons(source, episode, data)}</details>
        <details ${disclosure("technical")}><summary>Technical details</summary>
          ${problem?.reported ? `<div class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">From an earlier attempt; the current activity is shown above.</p>' : ""}<pre>${esc(problem.reported)}</pre></div>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : ""}
          ${problem?.logsUrl ? `<p><a class="button" href="${esc(problem.logsUrl)}">View integration logs</a></p>` : ""}
          ${dependencies.length || unwatched.length ? `<h3>Reported requirements</h3><ul>${dependencies.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · ${esc(node.own)} · ${list(node.reasons)}</li>`).join("")}${unwatched.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · Not monitored</li>`).join("")}</ul>` : ""}
          ${source.kind === "function" ? `<h3>Requirements</h3><ul>${source.requirements.map((id) => `<li><button class="link" type="button" data-node="${esc(id)}">${esc(nodes.get(id)?.name ?? id)}</button></li>`).join("")}</ul>` : ""}
          <p class="sub">These checks describe Home Assistant's connection. They do not verify physical operation. Only configured dependencies establish household impact.</p>
          <details ${disclosure("diagnostics")}><summary>Diagnostic data</summary><pre>${json({evidence:result,policy:explanation,notifications_enabled:data.policy.notifications_enabled,controls})}</pre></details>
        </details>`;
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
  constructor() {
    super();
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "ha-menu";
    menu.setAttribute("aria-label", "Open Home Assistant menu");
    menu.title = "Open Home Assistant menu";
    menu.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>';
    menu.addEventListener("click", () => this.dispatchEvent(new CustomEvent("hass-toggle-menu", {bubbles:true, composed:true})));
    this.shadowRoot.querySelector(".brand").prepend(menu);
  }

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
      {title:"Overview",path:"overview",type:"panel",cards:[{type:"custom:homeostatic-card-v10",view:"overview",navigation:false}]},
      {title:"House",path:"house",type:"panel",cards:[{type:"custom:homeostatic-card-v10",view:"house",navigation:false}]},
      {title:"Recently resolved",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card-v10",view:"history",navigation:false}]},
      {title:"Coverage",path:"coverage",type:"panel",cards:[{type:"custom:homeostatic-card-v10",view:"coverage",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v10")) customElements.define("homeostatic-card-v10", HomeostaticCard);
if (!customElements.get("homeostatic-panel-v10")) customElements.define("homeostatic-panel-v10", HomeostaticPanel);
if (!customElements.get("homeostatic-card")) customElements.define("homeostatic-card", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel")) customElements.define("homeostatic-panel", class extends HomeostaticPanel {});
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
