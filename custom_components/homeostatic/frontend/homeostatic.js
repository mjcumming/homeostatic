import {affectedFunctions, browseHighlights, coverageInventory, dashboardStore, escapeHtml as esc,
  inventoryRows, locationList, locationTree, monitoringLabel, sortedEpisodes,
  recentActivity, sourceMap, sourcePage} from "./model.mjs?v=13";
import {entityProblem, integrationProblem} from "./problem.mjs?v=13";
import {DashboardTools, controlsPanel} from "./history-controls.mjs?v=13";
import {diagnosticOverview} from "./evidence.mjs?v=13";
import {editCatalogRule, MATCH_FIELDS, MATCH_LABELS, monitoringScope, monitoringTree,
  newCatalogRule, scopeChoice, setScopeChoice} from "./configuration.mjs?v=13";
import {styles} from "./styles.mjs?v=13";
import {locationBranch, setBranchExpanded} from "./tree.mjs?v=13";

const VIEWS = ["overview", "house", "coverage", "functions", "problems", "history", "configuration"];
const status = (value) => {
  const safe = ["ready", "blocked", "unknown", "degraded", "pass", "warn", "fail"].includes(value) ? value : "unknown";
  return `<span class="tag ${safe}">${safe[0].toUpperCase() + safe.slice(1)}</span>`;
};
const date = (value) => value ? new Date(value).toLocaleString() : "No completed update";
const list = (values) => values.map(esc).join(", ") || "None";
const json = (value) => esc(JSON.stringify(value, null, 2));
const ownerStatus = (value) => ({ready:"Available",blocked:"Unavailable",unknown:"Not confirmed",degraded:"Limited"}[value] ?? "Not confirmed");
const icon = (name) => `<ha-icon icon="mdi:${name}" aria-hidden="true"></ha-icon>`;

function activitySourceList(entry) {
  if (!entry.sources?.length) return "";
  const groups = new Map();
  for (const source of entry.sources) {
    const group = source.group ?? "Other sources";
    if (!groups.has(group)) groups.set(group,new Map());
    const devices = groups.get(group);
    const device = source.device ?? "Sources without a HA device";
    if (!devices.has(device)) devices.set(device,[]);
    devices.get(device).push(source);
  }
  const evidence = {disabled:"Disabled in HA; health cannot be assessed",
    never_observed:"Awaiting first reading",stale:"Evidence is stale",
    not_monitored:"Not currently monitored"};
  const contents = [...groups].map(([group,devices]) =>
    `<div class="activity-source-group"><strong>${esc(group)}</strong>${[...devices].map(([device,sources]) =>
      `<div><span class="small">${esc(device)}</span><ul>${sources.map((source) =>
        `<li><span>${esc(source.name)}</span><span class="small">${esc(evidence[source.evidence] ?? "No missing evidence reported")}</span>${source.rules.length ? `<span class="small">Matched: ${list(source.rules)}</span>` : ""}${source.exclusions.length ? `<span class="small">Excluded: ${list(source.exclusions)}</span>` : ""}</li>`).join("")}</ul></div>`).join("")}</div>`).join("");
  const shown = entry.sources.length;
  return `<details class="activity-sources"><summary>View ${shown} ${shown === 1 ? "source" : "sources"}${entry.total > shown ? ` of ${entry.total} recorded` : ""}</summary>${contents}${entry.total > shown ? '<p class="small">Only the first 50 sources are listed here. Coverage shows the current monitoring scope.</p>' : ""}</details>`;
}

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "overview"};
    this.page = "overview";
    this.location = null;
    this.collapsedLocations = new Set();
    this.sourceQuery = '';
    this.sourcePage = 0;
    this.sourceScope = null;
    this.coverageQuery = "";
    this.coverageSelection = null;
    this.configuration = null;
    this.configDraft = null;
    this.configPreview = null;
    this.configError = null;
    this.configBusy = false;
    this.configQuery = "";
    this.configExpanded = new Set();
    this.configAdvancedOpen = false;
    this.configScopes = [];
    this.coverageDisclosure = new Map();
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Overview</button><button type="button" data-page="house">Browse the house</button><button type="button" data-page="coverage">Coverage</button><button type="button" data-page="history">Recently resolved</button><button type="button" data-page="configuration">What to monitor</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
    this.main = this.shadowRoot.querySelector("main");
    this.dialog = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.addEventListener("click", (event) => this.clicked(event));
    this.shadowRoot.addEventListener("keydown", (event) => this.keydown(event));
    this.shadowRoot.addEventListener("input", event => {
      if (this.editRule(event)) return;
      if (event.target.matches("[data-config-search]")) {
        this.configQuery = event.target.value;
        this.expandConfigurationMatches(this.configQuery);
        const position = event.target.selectionStart;
        this.render();
        const search = this.shadowRoot.querySelector("[data-config-search]");
        search?.focus();
        search?.setSelectionRange(position,position);
        return;
      }
      if (event.target.matches("[data-source-search]")) {
        this.sourceQuery = event.target.value;
        this.sourcePage = 0;
        this.render();
      } else if (event.target.matches("[data-coverage-search]")) {
        this.coverageQuery = event.target.value;
        this.render();
      }
    });
    this.shadowRoot.addEventListener("change", (event) => {if (!this.editScope(event)) this.editRule(event);});
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
      if (this.page === "configuration" && value.status === "current" && !this.configuration && !this.configBusy) this.loadConfiguration();
      if (this.pendingEpisode && value.status === "current") {
        const episodeId = this.pendingEpisode;
        this.pendingEpisode = null;
        this.openDetail({episodeId});
      } else if (this.detail) this.loadDetail();
    });
  }

  render() {
    const focused = this.shadowRoot.activeElement;
    const historyFocus = focused?.hasAttribute("data-source-search") ? "[data-source-search]" : focused?.hasAttribute("data-coverage-search") ? "[data-coverage-search]" : focused?.hasAttribute("data-config-search") ? "[data-config-search]" : focused?.hasAttribute("data-history-search") ? "[data-history-search]" : focused?.hasAttribute("data-history-filter") ? "[data-history-filter]" : null;
    const selection = ["[data-source-search]", "[data-coverage-search]", "[data-config-search]", "[data-history-search]"].includes(historyFocus) ? [focused.selectionStart, focused.selectionEnd] : null;
    const minimal = ["functions", "problems"].includes(this.config.view);
    this.shadowRoot.querySelector(".nav").hidden = minimal || this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = `← Back to ${{overview:"Overview",house:"House",coverage:"Coverage",functions:"Functions",problems:"Problems",history:"Recently resolved",configuration:"What to monitor"}[this.config.view]}`;
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
    if (this.page === "configuration") this.main.innerHTML = this.configurationPage();
    else if (this.page === "history") this.main.innerHTML = this.tools.historyPanel(data);
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

  configurationChoice(label, scope, current, detail = "") {
    if (!scope) return `<span class="small">${esc(label)} · no stable identity available</span>`;
    const index = this.configScopes.push(scope) - 1;
    const choice = scopeChoice(this.configDraft,scope);
    const option = (value, name) => `<option value="${value}"${choice === value ? " selected" : ""}>${name}</option>`;
    const choices = choice === "multiple"
      ? '<option selected>Multiple direct rules; edit below</option>'
      : `${option("inherit",choice === "inherit" ? "No specific choice" : "Remove this choice")}${option("attach","Watch")}${option("exclude","Exclude")}`;
    return `<label class="config-choice"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ""}<small>Current: ${esc(current)}</small></span><select data-scope-index="${index}" aria-label="${esc(label)} monitoring choice"${this.configBusy || choice === "multiple" ? " disabled" : ""}>${choices}</select></label>`;
  }

  configurationSource(source) {
    const scope = monitoringScope("entity",source.node_id,source);
    const current = source.excluded_by.length ? "Excluded" : source.watched ? "Watched" : "Not selected";
    return `<div class="config-tree-row config-entity">${this.configurationChoice(source.name,scope,current,source.entity_id ?? "")}</div>`;
  }

  configurationDevice(device) {
    const key = `device:${device.id}`;
    const expanded = this.configExpanded.has(key);
    const open = expanded ? " open" : "";
    const {count,watched} = device.total;
    return `<details class="config-device" data-config-group="${esc(key)}"${open}><summary><strong>${esc(device.name)}</strong><span class="small">${watched} of ${count} ${count === 1 ? "entity" : "entities"} watched</span></summary>${expanded ? `<div class="config-children"><div class="config-tree-row">${this.configurationChoice("All entities on this device",monitoringScope("device",device.id),`${watched} of ${count} watched`)}</div>${device.entities.map((source) => this.configurationSource(source)).join("")}</div>` : ""}</details>`;
  }

  configurationGroup(group) {
    const key = `integration:${group.id}`;
    const expanded = this.configExpanded.has(key);
    const open = expanded ? " open" : "";
    if (!expanded) return `<details class="config-integration" data-config-group="${esc(key)}"><summary><strong>${esc(group.name)}</strong><span class="small">${group.watched} of ${group.count} ${group.count === 1 ? "source" : "sources"} watched</span></summary></details>`;
    const scopes = !group.id ? "" : `<div class="config-tree-row">${this.configurationChoice("Integration state and all its entities",monitoringScope("both",group.id),`${group.watched} of ${group.count} watched`)}</div>${group.entry ? `<div class="config-tree-row">${this.configurationChoice("Integration state only",monitoringScope("entry",group.id),group.entry.excluded_by.length ? "Excluded" : group.entry.watched ? "Watched" : "Not selected")}</div>` : ""}${group.entities.length ? `<div class="config-tree-row">${this.configurationChoice("All entities in this integration",monitoringScope("entities",group.id),`${group.entities.filter((source) => source.watched).length} of ${group.entities.length} watched`)}</div>` : ""}`;
    return `<details class="config-integration" data-config-group="${esc(key)}"${open}><summary><strong>${esc(group.name)}</strong><span class="small">${group.watched} of ${group.count} ${group.count === 1 ? "source" : "sources"} watched</span></summary><div class="config-children">${scopes}${group.devices.map((device) => this.configurationDevice(device)).join("")}${group.loose.length ? `<div class="config-loose"><strong>Entities without a device</strong>${group.loose.map((source) => this.configurationSource(source)).join("")}</div>` : ""}</div></details>`;
  }

  configurationPage() {
    const intro = '<div class="intro"><div><h1>What to monitor</h1><p class="sub">Choose which Home Assistant sources Homeostatic watches. New sources matching your choices are included automatically.</p></div></div>';
    if (!this.configuration) return `${intro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring rules…")}</p><button type="button" class="button" data-action="load-configuration">Reload configuration</button></div></section>`;
    if (this.main.querySelector(".config-tree")) {
      this.configAdvancedOpen = this.main.querySelector(".config-advanced")?.open ?? false;
    }
    this.configScopes = [];
    const tree = monitoringTree(this.current.data,this.configQuery);
    const branches = tree.length ? tree.map((group) => this.configurationGroup(group)).join("")
      : '<p class="sub">No integration, device, or entity matches this search.</p>';
    const candidates = this.current.data.inventory.catalog.candidates;
    const watched = candidates.filter((source) => source.watched && ["integration","entity"].includes(source.kind)).length;
    const excluded = candidates.filter((source) => source.excluded_by.length && ["integration","entity"].includes(source.kind)).length;
    const browser = `<section class="panel"><div class="panel-head"><h2>Choose sources</h2></div><div class="body"><p><strong>${watched}</strong> watched · <strong>${excluded}</strong> excluded. Homeostatic currently checks HA integration state and entity availability.</p><p class="sub">Choose Watch or Exclude for an integration, its state, its entities, a device, or one entity. A device choice covers all its associated entities, even across integrations. Search narrows what you see; a choice still covers the whole group.</p><p class="sub">Current shows what Homeostatic monitors now. “No specific choice” means a broader choice may still apply.</p><label class="coverage-search"><span>Find an integration, device, or entity</span><input type="search" data-config-search value="${esc(this.configQuery)}" placeholder="Search discovered sources"></label><div class="config-tree">${branches}</div></div></section>`;
    const rules = this.configDraft.map((rule, index) => {
      const fields = MATCH_FIELDS.map((field) => `<label><span>${esc(MATCH_LABELS[field])}</span><input type="text" data-rule-index="${index}" data-rule-field="match:${field}" value="${esc((rule.match?.[field] ?? []).join(", "))}" placeholder="Any" autocomplete="off"></label>`).join("");
      return `<section class="config-rule"><div class="config-rule-head"><label><span>Rule ID</span><input type="text" data-rule-index="${index}" data-rule-field="id" value="${esc(rule.id)}" spellcheck="false"></label><label><span>Action</span><select data-rule-index="${index}" data-rule-field="action"><option value="attach"${rule.action === "attach" ? " selected" : ""}>Watch availability</option><option value="exclude"${rule.action === "exclude" ? " selected" : ""}>Exclude</option></select></label><label class="config-enabled"><input type="checkbox" data-rule-index="${index}" data-rule-field="enabled"${rule.enabled !== false ? " checked" : ""}> Enabled</label><button type="button" class="link" data-remove-rule="${index}">Remove</button></div><details class="config-matches"><summary>Match sources · ${esc(Object.keys(rule.match ?? {}).join(", ") || "all eligible sources")}</summary><p class="sub">Fields combine with AND; comma-separated values within one field combine with OR. Empty fields match anything. Exclusions always win.</p><div class="config-fields">${fields}</div></details></section>`;
    }).join("");
    const preview = this.configPreview;
    const changes = (items, count, label) => count ? `<div><strong>${count} ${label}</strong><ul>${items.map((item) => `<li>${esc(item.name)} <span class="small">${esc(item.node_id)}</span></li>`).join("")}</ul>${count > items.length ? `<p class="small">Showing the first ${items.length}.</p>` : ""}</div>` : `<p>No sources ${label}.</p>`;
    const result = preview ? `<section class="panel config-preview" aria-live="polite"><div class="panel-head"><h2>Preview of current inventory</h2></div><div class="body"><p><strong>${preview.watched}</strong> watched sources after this change.</p><div class="config-change-list">${changes(preview.added,preview.added_count,"newly watched")}${changes(preview.removed,preview.removed_count,"no longer watched")}</div><details><summary>Rule match counts</summary><ul>${preview.matches.map((item) => `<li>${esc(item.id)}: ${item.matches} matching sources</li>`).join("")}</ul></details>${preview.functions.length ? `<details><summary>Function readiness from current evidence</summary><ul>${preview.functions.map((item) => `<li>${esc(item.name)}: ${esc(item.readiness.answer)}${item.requirements.some((source) => source.monitoring === "excluded" || source.monitoring === "unwatched") ? " · has an unwatched requirement" : ""}</li>`).join("")}</ul><p class="small">This preview does not replay existing holds or episode history.</p></details>` : ""}<p class="small">This preview uses current Home Assistant evidence. New devices may match these rules later.</p></div></section>` : "";
    const advanced = `<details class="config-advanced"${this.configAdvancedOpen ? " open" : ""}><summary>Advanced rules · ${this.configDraft.length}</summary><div class="body"><p class="sub">Edit combinations such as areas, labels, or device classes here. These are the same rules used by the choices above.</p><button type="button" class="button" data-action="add-rule"${this.configBusy ? " disabled" : ""}>Add advanced rule</button><fieldset class="config-editor"${this.configBusy ? " disabled" : ""}>${rules || '<p>No rules. Nothing is selected for passive monitoring.</p>'}</fieldset></div></details>`;
    const actions = `<section class="panel"><div class="panel-head"><h2>Review changes</h2></div><div class="body"><p>Exclusions take precedence over watch rules. Excluding a required source leaves its function without that evidence. Preview shows the effective result before anything is saved.</p><div class="config-actions"><button type="button" class="button" data-action="preview-configuration"${this.configBusy ? " disabled" : ""}>Preview changes</button><button type="button" class="button primary" data-action="save-configuration"${!preview || this.configBusy ? " disabled" : ""}>Save monitoring choices</button><button type="button" class="link" data-action="load-configuration"${this.configBusy ? " disabled" : ""}>Discard edits and reload</button></div>${this.configError ? `<p class="config-error" role="alert">${esc(this.configError)}</p>` : ""}</div></section>`;
    return `${intro}${browser}${actions}${result}<section class="panel">${advanced}</section><section class="panel"><div class="panel-head"><h2>Other settings</h2></div><div class="body"><p>Functions, situations, notification policy, and house timing are still edited in Home Assistant's native Homeostatic options.</p><a class="button" href="/config/integrations">Open integration settings</a></div></section>`;
  }

  expandConfigurationMatches(query) {
    this.configExpanded = new Set();
    if (!query.trim()) return;
    for (const group of monitoringTree(this.current.data,query)) {
      this.configExpanded.add(`integration:${group.id}`);
      for (const device of group.devices) this.configExpanded.add(`device:${device.id}`);
    }
  }

  async loadConfiguration() {
    if (this.configBusy) return;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      const result = await this._hass.callWS({type:"homeostatic/configuration"});
      this.configuration = result;
      this.configDraft = structuredClone(result.rules);
      this.configPreview = null;
    } catch (error) {
      this.configError = error?.message ?? "Could not load configuration.";
    } finally {
      this.configBusy = false;
      if (this.page === "configuration") this.render();
    }
  }

  editRule(event) {
    const index = Number(event.target.dataset.ruleIndex);
    const field = event.target.dataset.ruleField;
    if (!this.configDraft?.[index] || !field) return false;
    const rule = this.configDraft[index];
    editCatalogRule(rule, field, field === "enabled" ? event.target.checked : event.target.value);
    this.configPreview = null;
    this.shadowRoot.querySelector(".config-preview")?.remove();
    this.shadowRoot.querySelector('[data-action="save-configuration"]')?.setAttribute("disabled", "");
    return true;
  }

  editScope(event) {
    if (!event.target.matches?.("[data-scope-index]")) return false;
    const index = Number(event.target.dataset.scopeIndex);
    const scope = this.configScopes[index];
    if (!scope || !setScopeChoice(this.configDraft,scope,event.target.value)) return false;
    this.configPreview = null;
    this.render();
    this.shadowRoot.querySelector(`[data-scope-index="${index}"]`)?.focus();
    return true;
  }

  async previewConfiguration() {
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      this.configPreview = await this._hass.callWS({type:"homeostatic/preview_configuration",revision:this.configuration.revision,rules:this.configDraft});
    } catch (error) {
      this.configPreview = null;
      this.configError = error?.message ?? "Could not preview these rules.";
    } finally {
      this.configBusy = false;
      this.render();
    }
  }

  async saveConfiguration() {
    if (!this.configPreview || this.configBusy) return;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      await this._hass.callWS({type:"homeostatic/save_configuration",revision:this.configuration.revision,preview_token:this.configPreview.preview_token,rules:this.configDraft});
      this.configBusy = false;
      await this.loadConfiguration();
      return;
    } catch (error) {
      this.configError = error?.message ?? "Could not save monitoring rules.";
    } finally {
      this.configBusy = false;
      this.render();
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
    const activity = recentActivity(data);
    this.activityEntries = activity;
    const entries = activity.map((entry,index) => {
      const action = entry.kind === "source" && entry.registered
        ? `<button type="button" class="link" data-node="${esc(entry.nodeId)}">View source</button>`
        : entry.sources?.length ? `<button type="button" class="link" data-activity-index="${index}">Review sources in Coverage</button>`
          : '<button type="button" class="link" data-page="coverage">Review monitoring</button>';
      return `<article class="activity-item"><div class="activity-copy"><strong>${esc(entry.title)}</strong><p>${esc(entry.summary)}</p><p class="small">${esc(date(entry.at))}</p></div><div class="activity-actions">${action}</div>${activitySourceList(entry)}<details class="activity-technical"><summary>Technical details</summary><pre>${json(entry.technical)}</pre></details></article>`;
    }).join("");
    return `<section class="panel"><div class="panel-head"><h2>Monitoring activity</h2></div><div class="body"><p class="small">Up to 50 recent records from this run, including the scope found at load while retained. Earlier activity and resolved problems are not included.</p></div>${entries || '<div class="body"><p class="sub">No monitoring activity recorded in this run.</p></div>'}</section>`;
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
    const view = coverageInventory(data,this.coverageQuery,50,this.coverageSelection);
    const searching = Boolean(view.query || this.coverageSelection);
    const gapItems = view.groups.flatMap((group) => group.devices.flatMap((device) =>
      device.sources.filter((item) => item.reasons.length)));
    const attention = !searching && gapItems.length
      ? `<section class="panel"><div class="panel-head"><h2>Needs attention</h2><span class="tag unknown">${view.summary.gaps} ${view.summary.gaps === 1 ? "gap" : "gaps"}</span></div><div class="coverage-attention">${gapItems.map((item) => this.coverageSource(item)).join("")}</div></section>`
      : !searching ? '<section class="empty coverage-clear"><h2>No coverage gaps reported</h2><p class="sub">Every capability in the current model has observed, non-stale check evidence.</p></section>' : "";
    const bounded = searching && view.resultCount > view.shownCount
      ? ` · showing first ${view.shownCount}` : "";
    const heading = this.coverageSelection ? `Sources from monitoring activity · ${view.resultCount}${bounded}`
      : searching ? `Search results · ${view.resultCount}${bounded}` : "Current monitoring by integration";
    const groups = view.groups.length
      ? view.groups.map((group) => this.coverageGroup(group,searching)).join("")
      : `<div class="body"><p class="sub">${searching ? "No source matches this search." : "No capabilities are currently registered."}</p></div>`;
    return `<div class="intro"><div><h1>Monitoring coverage</h1><p class="sub">What Homeostatic watches, where evidence is missing, why, and what to review next.</p></div></div><section class="coverage-summary" aria-label="Coverage summary"><div><strong>${view.summary.watched}</strong><span>Watched</span></div><div class="${view.summary.gaps ? "has-gap" : ""}"><strong>${view.summary.gaps}</strong><span>Evidence gaps</span></div><div><strong>${view.summary.excluded}</strong><span>Excluded</span></div><div><strong>${view.summary.unselected}</strong><span>Other discovered</span></div></section><label class="coverage-search"><span>Find an integration, device, source, or rule</span><input type="search" data-coverage-search value="${esc(this.coverageQuery)}" placeholder="Search all discovered sources"></label>${attention}<section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2>${searching ? `<button type="button" class="link" data-action="clear-coverage-search">${esc(this.coverageSelection ? "Show all coverage" : "Clear search")}</button>` : ""}</div><div class="coverage-groups">${groups}</div></section>${!searching ? `<section class="panel"><div class="panel-head"><h2>Outside the current model</h2></div><div class="body"><details><summary>${view.summary.excluded} excluded by rules</summary><p class="sub">These sources remain discoverable so an exclusion can be explained. Search above to inspect one.</p></details><details><summary>${view.summary.unselected} other discovered sources</summary><p class="sub">These Home Assistant sources are not selected for monitoring and are not coverage gaps by themselves. Search above to inspect one.</p></details></div></section>${this.changes(data)}` : ""}`;
  }

  house(data) {
    const tree = locationTree(data);
    const locations = locationList(tree);
    const selected = locations.find((location) => location.id === this.location) ??
      locations.find((location) => location.kind === "area") ?? locations[0];
    this.location = selected?.id ?? null;
    const related = selected?.functions ?? [];
    const devices = selected?.devices.length
      ? `<div class="house-section"><h3>Home Assistant devices</h3>${selected.devices.map((device) => `<details class="house-group"><summary>${esc(device.name)} <span class="small">${device.sources.length} source${device.sources.length === 1 ? "" : "s"}</span></summary>${this.sourceTable(data, device.sources)}</details>`).join("")}</div>`
      : '<div class="house-section"><h3>Home Assistant devices</h3><p class="sub">No devices are associated with this location.</p></div>';
    const signals = selected?.signals.length
      ? `<details class="house-group house-signals"><summary>Area signals <span class="small">${selected.signals.length} entit${selected.signals.length === 1 ? "y" : "ies"}</span></summary><p class="sub">These entities have no current Home Assistant device association. They may be derived signals, helpers, or device sources.</p>${this.sourceTable(data, selected.signals)}</details>`
      : "";
    return `<div class="intro"><div><h1>Browse the house</h1><p class="sub">Home Assistant floors and areas · Devices, functions, and area signals</p></div></div>${selected ? `<div class="house"><section class="panel locations" aria-label="Locations"><div class="location-tree" role="tree">${tree.map((location) => locationBranch(location, selected.id, this.collapsedLocations)).join("")}</div></section><div class="stack"><section class="panel"><div class="panel-head"><div><p class="small">${esc(selected.parent_name)}</p><h2>${esc(selected.name)}</h2></div><span class="small">${esc(selected.kind === "area" ? "Area" : selected.kind === "floor" ? "Floor" : "Location group")}</span></div>${devices}${signals}<div class="body"><p class="sub">Device association and location are Home Assistant groupings. Neither proves physical hardware or creates a health dependency.</p></div></section>${this.functionsPanel(data, related)}<p class="small">Functions shown here require a source in this location. Open a function to see shared causes outside the location.</p></div></div>` : '<div class="empty">No Home Assistant floors, areas, or unassigned entities have been discovered.</div>'}`;
  }

  setLocationExpanded(locationId, expanded) {
    this.collapsedLocations = setBranchExpanded(this.collapsedLocations, locationId, expanded);
    this.render();
    [...this.shadowRoot.querySelectorAll("button[data-location]")]
      .find((button) => button.dataset.location === locationId)?.focus();
  }

  clicked(event) {
    const locationToggle = event.target.closest?.("[data-location-toggle]");
    if (locationToggle) {
      const button = locationToggle.closest("button.location-parent");
      this.setLocationExpanded(
        locationToggle.dataset.locationToggle,
        button.getAttribute("aria-expanded") !== "true",
      );
      return;
    }
    const summary = event.target.closest?.("summary");
    const group = summary?.parentElement?.dataset.configGroup;
    if (group !== undefined) {
      event.preventDefault();
      if (this.configExpanded.has(group)) this.configExpanded.delete(group);
      else this.configExpanded.add(group);
      this.render();
      [...this.shadowRoot.querySelectorAll("details[data-config-group]")]
        .find((details) => details.dataset.configGroup === group)?.querySelector("summary")?.focus();
      return;
    }
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.coverageToggle) {
      this.coverageDisclosure.set(button.dataset.coverageToggle,button.getAttribute("aria-expanded") !== "true");
      this.render();
    }
    else if (button.dataset.sourceStep) {this.sourcePage += Number(button.dataset.sourceStep); this.render();}
    else if (button.dataset.activityIndex !== undefined) {
      const entry = this.activityEntries[Number(button.dataset.activityIndex)];
      this.coverageSelection = new Set(entry.sources.map((source) => source.nodeId));
      this.coverageQuery = "";
      this.page = "coverage";
      this.render();
    }
    else if (button.dataset.page) {this.page = button.dataset.page; this.render(); if (this.page === "configuration" && !this.configuration) this.loadConfiguration();}
    else if (button.dataset.removeRule !== undefined) {this.configDraft.splice(Number(button.dataset.removeRule),1); this.configPreview = null; this.render();}
    else if (button.dataset.configSource) {this.configQuery = button.dataset.configSource; this.expandConfigurationMatches(this.configQuery); this.page = "configuration"; this.render(); if (!this.configuration) this.loadConfiguration();}
    else if (button.dataset.location) {this.location = button.dataset.location; this.page = "house"; this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") this.dialog.close();
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "add-rule") {this.configDraft.push(newCatalogRule(this.configDraft)); this.configPreview = null; this.render();}
    else if (button.dataset.action === "load-configuration") this.loadConfiguration();
    else if (button.dataset.action === "preview-configuration") this.previewConfiguration();
    else if (button.dataset.action === "save-configuration") this.saveConfiguration();
    else if (button.dataset.action === "clear-coverage-search") {this.coverageQuery = ""; this.render();}
  }

  keydown(event) {
    const button = event.target.closest?.("button.coverage-toggle, button.location-parent");
    if (!button || !["ArrowLeft","ArrowRight"].includes(event.key)) return;
    const expanded = button.getAttribute("aria-expanded") === "true";
    const next = event.key === "ArrowRight";
    if (expanded === next) return;
    event.preventDefault();
    if (button.matches("button.location-parent")) {
      this.setLocationExpanded(button.dataset.location,next);
    } else {
      this.coverageDisclosure.set(button.dataset.coverageToggle,next);
      this.render();
    }
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
      const diagnostic = diagnosticOverview(source, result, currentFunctions, Boolean(episode));
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
         <section class="detail evidence-overview" aria-label="Evidence summary"><h3>What Homeostatic knows</h3><dl><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd><dt>What is checked</dt><dd>${esc(diagnostic.checks)}</dd><dt>Current assessment</dt><dd>${esc(diagnostic.assessment)}</dd><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></dl></section>
         <p class="small problem-progress">${episode ? `Since ${esc(date(episode.opened_at))}` : "Current status"}${problem ? ` · ${esc(problem.progress)}` : ""}</p>
         ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Working on equipment"} until ${esc(date(control.until))}.</p>`).join("")}
        <details ${disclosure("manage")}><summary>${episode ? "Manage this problem" : "Manage this device"}</summary>${this.tools.detailButtons(source, episode, data)}</details>
        <details ${disclosure("technical")}><summary>Technical details</summary>
          ${problem?.reported ? `<div class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">From an earlier attempt; the current activity is shown above.</p>' : ""}<pre>${esc(problem.reported)}</pre></div>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : ""}
          ${problem?.logsUrl ? `<p><a class="button" href="${esc(problem.logsUrl)}">View integration logs</a></p>` : ""}
          ${dependencies.length || unwatched.length ? `<h3>Reported requirements</h3><ul>${dependencies.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · ${esc(node.own)} · ${list(node.reasons)}</li>`).join("")}${unwatched.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · Not monitored</li>`).join("")}</ul>` : ""}
          ${source.kind === "function" ? `<h3>Requirements</h3><ul>${source.requirements.map((id) => `<li><button class="link" type="button" data-node="${esc(id)}">${esc(nodes.get(id)?.name ?? id)}</button></li>`).join("")}</ul>` : ""}
           <details ${disclosure("diagnostics")}><summary>Raw diagnostic data for troubleshooting</summary><p class="small">This record contains internal identifiers. Review it before sharing.</p><pre>${json({evidence:result,policy:explanation,notifications_enabled:data.policy.notifications_enabled,controls})}</pre></details>
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
      {title:"Overview",path:"overview",type:"panel",cards:[{type:"custom:homeostatic-card-v13",view:"overview",navigation:false}]},
      {title:"House",path:"house",type:"panel",cards:[{type:"custom:homeostatic-card-v13",view:"house",navigation:false}]},
      {title:"Recently resolved",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card-v13",view:"history",navigation:false}]},
      {title:"Coverage",path:"coverage",type:"panel",cards:[{type:"custom:homeostatic-card-v13",view:"coverage",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v13")) customElements.define("homeostatic-card-v13", HomeostaticCard);
if (!customElements.get("homeostatic-panel-v13")) customElements.define("homeostatic-panel-v13", HomeostaticPanel);
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
