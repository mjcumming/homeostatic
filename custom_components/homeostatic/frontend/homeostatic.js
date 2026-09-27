import {affectedFunctions, coverageInventory, dashboardStore, deviceRegistryCoverage, escapeHtml as esc,
  homeEpisodeGroups, inventoryRows, locationAssessment, locationList, locationTree, monitoringLabel, sortedEpisodes,
  recentActivity, sourceMap} from "./model.mjs?v=21";
import {deviceProblem, entityProblem, integrationProblem} from "./problem.mjs?v=21";
import {DashboardTools, controlsPanel} from "./history-controls.mjs?v=21";
import {diagnosticOverview} from "./evidence.mjs?v=21";
import {editCatalogRule, MATCH_FIELDS, MATCH_LABELS, monitoringScope, monitoringTree,
  newCatalogRule, scopeChoice, setScopeChoice} from "./configuration.mjs?v=21";
import {styles} from "./styles.mjs?v=21";
import {locationBranch, setBranchExpanded} from "./tree.mjs?v=21";

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
const RAIL_WIDTH_KEY = "homeostatic-house-rail-width";
const RAIL_MIN = 300;
const RAIL_MAX = 600;

function savedRailWidth() {
  try {
    const value = Number(window.localStorage.getItem(RAIL_WIDTH_KEY));
    return value >= RAIL_MIN && value <= RAIL_MAX ? value : 340;
  } catch {
    return 340;
  }
}

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
  return `<details class="activity-sources"><summary>View ${shown} ${shown === 1 ? "source" : "sources"}${entry.total > shown ? ` of ${entry.total} recorded` : ""}</summary>${contents}${entry.total > shown ? '<p class="small">Only the first 50 sources are listed here. Monitoring shows the current scope.</p>' : ""}</details>`;
}

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "overview"};
    this.page = "overview";
    this.location = null;
    this.collapsedLocations = new Set();
    this.railWidth = savedRailWidth();
    this.railResize = null;
    this.coverageQuery = "";
    this.coverageSelection = null;
    this.configuration = null;
    this.configDraft = null;
    this.configPreview = null;
    this.configError = null;
    this.configBusy = false;
    this.configQuery = "";
    this.configExpanded = new Set();
    this.settingsSection = "monitoring";
    this.configAdvancedOpen = false;
    this.configScopes = [];
    this.coverageDisclosure = new Map();
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Home</button><button type="button" data-page="house">Explore</button><button type="button" data-page="coverage">Monitoring</button><button type="button" data-page="history">History</button><button type="button" data-page="configuration">Settings</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
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
      if (event.target.matches("[data-coverage-search]")) {
        this.coverageQuery = event.target.value;
        this.render();
      }
    });
    this.shadowRoot.addEventListener("change", (event) => {if (!this.editScope(event)) this.editRule(event);});
    this.shadowRoot.addEventListener("pointerdown", (event) => this.startRailResize(event));
    this.shadowRoot.addEventListener("pointermove", (event) => this.moveRailResize(event));
    this.shadowRoot.addEventListener("pointerup", (event) => this.endRailResize(event));
    this.shadowRoot.addEventListener("pointercancel", (event) => this.endRailResize(event));
    this.tools = new DashboardTools(this);
    this.dialog.addEventListener("close", () => {this.detail = null; this.detailSequence++;});
  }

  static getStubConfig() { return {view: "overview"}; }
  getCardSize() { return this.config.view === "functions" ? 4 : 8; }

  setConfig(config) {
    if (config.view !== undefined && !VIEWS.includes(config.view)) {
      throw new Error("Homeostatic view must be overview, house, coverage, history, configuration, functions, or problems.");
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
    this.railResize = null;
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
    const historyFocus = focused?.hasAttribute("data-coverage-search") ? "[data-coverage-search]" : focused?.hasAttribute("data-config-search") ? "[data-config-search]" : focused?.hasAttribute("data-history-search") ? "[data-history-search]" : focused?.hasAttribute("data-history-filter") ? "[data-history-filter]" : null;
    const selection = ["[data-coverage-search]", "[data-config-search]", "[data-history-search]"].includes(historyFocus) ? [focused.selectionStart, focused.selectionEnd] : null;
    const minimal = ["functions", "problems"].includes(this.config.view);
    this.shadowRoot.querySelector(".nav").hidden = minimal || this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = `← Back to ${{overview:"Home",house:"Explore",coverage:"Monitoring",functions:"Functions",problems:"Problems",history:"History",configuration:"Settings"}[this.config.view]}`;
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
    else if (this.page === "history") this.main.innerHTML = this.history(data);
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
      : `${option("inherit",choice === "inherit" ? "No specific choice" : "Remove this choice")}${option("attach","Watch")}${option("exclude","Ignore availability")}`;
    return `<label class="config-choice"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ""}<small>Current: ${esc(current)}</small></span><select data-scope-index="${index}" aria-label="${esc(label)} monitoring choice"${this.configBusy || choice === "multiple" ? " disabled" : ""}>${choices}</select></label>`;
  }

  configurationSource(source) {
    const scope = monitoringScope("entity",source.node_id,source);
    const inSummary = inventoryRows(this.current.data).some((item) => item.kind === "device" && item.watched && item.availability_entities?.includes(source.entity_id));
    const current = source.excluded_by.length ? "Availability ignored" : source.watched ? "Watched" : inSummary ? "Expected by device summary" : "Not selected";
    return `<div class="config-tree-row config-entity">${this.configurationChoice(source.name,scope,current,source.entity_id ?? "")}</div>`;
  }

  configurationDevice(device) {
    const key = `device:${device.id}`;
    const expanded = this.configExpanded.has(key);
    const open = expanded ? " open" : "";
    const {count,watched} = device.total;
    const summary = device.summary ? `<div class="config-tree-row">${this.configurationChoice("Device availability summary (one check)",monitoringScope("device_availability",device.id),device.summary.excluded_by.length ? "Excluded" : device.summary.watched ? "Watched" : "Not selected","Expects selected entities to be available; entity exclusions apply")}</div>` : "";
    return `<details class="config-device" data-config-group="${esc(key)}"${open}><summary><strong>${esc(device.name)}</strong><span class="small">${watched} of ${count} ${count === 1 ? "entity" : "entities"} watched${device.summary?.watched ? " · summary watched" : ""}</span></summary>${expanded ? `<div class="config-children">${summary}<div class="config-tree-row">${this.configurationChoice("All entities on this device",monitoringScope("device",device.id),`${watched} of ${count} watched`)}</div>${device.entities.map((source) => this.configurationSource(source)).join("")}</div>` : ""}</details>`;
  }

  configurationGroup(group) {
    const key = `integration:${group.id}`;
    const expanded = this.configExpanded.has(key);
    const open = expanded ? " open" : "";
    const name = group.entry ? this.displaySourceName(group.entry) : group.name;
    if (!expanded) return `<details class="config-integration" data-config-group="${esc(key)}"><summary><strong>${esc(name)}</strong><span class="small">${group.watched} of ${group.count} ${group.count === 1 ? "source" : "sources"} watched</span></summary></details>`;
    const scopes = !group.id ? "" : `<div class="config-tree-row">${this.configurationChoice("Integration state and all its entities",monitoringScope("both",group.id),`${group.watched} of ${group.count} watched`)}</div>${group.entry ? `<div class="config-tree-row">${this.configurationChoice("Integration state only",monitoringScope("entry",group.id),group.entry.excluded_by.length ? "Excluded" : group.entry.watched ? "Watched" : "Not selected")}</div>` : ""}${group.entities.length ? `<div class="config-tree-row">${this.configurationChoice("All entities in this integration",monitoringScope("entities",group.id),`${group.entities.filter((source) => source.watched).length} of ${group.entities.length} watched`)}</div>` : ""}`;
    return `<details class="config-integration" data-config-group="${esc(key)}"${open}><summary><strong>${esc(name)}</strong><span class="small">${group.watched} of ${group.count} ${group.count === 1 ? "source" : "sources"} watched</span></summary><div class="config-children">${scopes}${group.devices.map((device) => this.configurationDevice(device)).join("")}${group.loose.length ? `<div class="config-loose"><strong>Entities without a device</strong>${group.loose.map((source) => this.configurationSource(source)).join("")}</div>` : ""}</div></details>`;
  }

  configurationPage() {
    const data = this.current.data;
    const intro = '<div class="intro"><div><h1>Settings</h1><p class="sub">Choose what Homeostatic watches and how it responds.</p></div></div>';
    const sections = `<nav class="settings-nav" aria-label="Settings sections">${[
      ["monitoring","Monitoring choices"],["functions","Functions & situations"],
      ["alerts","Alerts & delivery"],["advanced","Advanced"],
    ].map(([id,label]) => `<button type="button" class="button${this.settingsSection === id ? " primary" : ""}" data-settings-section="${id}" aria-pressed="${this.settingsSection === id}">${label}</button>`).join("")}</nav>`;
    const options = '<a class="button" href="/config/integrations">Open Homeostatic options in Home Assistant</a>';
    if (this.settingsSection === "functions") {
      const situations = data.inventory.nodes.filter((source) => source.kind === "situation");
      const names = (items) => items.length ? `<ul>${items.map((item) => `<li>${esc(item.name)}</li>`).join("")}</ul>` : '<p class="sub">None defined yet.</p>';
      return `${intro}${sections}<section class="panel"><div class="panel-head"><h2>Home functions</h2></div><div class="body"><p>Define the jobs your house should perform and confirm which sources each one requires.</p>${names(data.functions)}${options}</div></section><section class="panel settings-following"><div class="panel-head"><h2>Situation alerts</h2></div><div class="body"><p>Home Assistant defines the condition; Homeostatic tracks the resulting situation and its alerts.</p>${names(situations)}${options}</div></section>`;
    }
    if (this.settingsSection === "alerts") {
      const enabled = data.policy.notifications_enabled;
      const consumer = data.coverage.notification_consumer_missing;
      return `${intro}${sections}<section class="panel"><div class="panel-head"><h2>Alerts & delivery</h2></div><div class="body"><p><strong>Notification requests are ${enabled ? "on" : "off"}.</strong> ${enabled ? "Homeostatic can request alerts under the current policy." : "Open problems remain visible here, but Homeostatic is not requesting alerts."}</p>${consumer ? '<p class="note">The selected notification consumer is missing or disabled. Review it before relying on alerts.</p>' : ""}<p class="sub">Homeostatic records requests, not proof that a phone received or displayed a message.</p>${options}</div></section>`;
    }
    if (this.settingsSection === "advanced") {
      return `${intro}${sections}<section class="panel"><div class="panel-head"><h2>Advanced settings</h2></div><div class="body"><p>House-wide timing, function definitions, situation bindings, and notification policy are edited in Home Assistant's Homeostatic options. The policy uses structured YAML.</p><p>Full catalog rules remain available in the Monitoring choices editor. Changes there use the same preview and save path.</p><div class="actions"><button type="button" class="button" data-action="open-advanced-rules">Edit catalog rules</button>${options}</div></div></section>`;
    }
    const monitoringIntro = '<section class="settings-lead"><h2>Monitoring choices</h2><p class="sub">Choose which sources you expect to be available. Device summaries apply that expectation to their selected entities. Broad defaults may need tuning; future matching sources are included. Ignore availability removes an expectation without changing Home Assistant states. Preview and save your choices below.</p></section>';
    if (!this.configuration) return `${intro}${sections}${monitoringIntro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring rules…")}</p><button type="button" class="button" data-action="load-configuration">Reload configuration</button></div></section>`;
    if (this.main.querySelector(".config-tree")) {
      this.configAdvancedOpen = this.main.querySelector(".config-advanced")?.open ?? false;
    }
    this.configScopes = [];
    const tree = monitoringTree(this.current.data,this.configQuery);
    const branches = tree.length ? tree.map((group) => this.configurationGroup(group)).join("")
      : '<p class="sub">No integration, device, or entity matches this search.</p>';
    const candidates = this.current.data.inventory.catalog.candidates;
    const watched = candidates.filter((source) => source.watched && ["integration","device","entity"].includes(source.kind)).length;
    const excluded = candidates.filter((source) => source.excluded_by.length && ["integration","device","entity"].includes(source.kind)).length;
    const browser = `<section class="panel"><div class="panel-head"><h2>Choose sources</h2></div><div class="body"><p><strong>${watched}</strong> watched · <strong>${excluded}</strong> excluded. Homeostatic checks HA integration state and the availability of selected device summaries or entities.</p><p class="sub">A device availability summary is one check across its enabled entities. Choose individual entities only when you need separate problems for them. Search narrows what you see; a choice still covers the whole group.</p><p class="sub">Current shows what Homeostatic monitors now. “No specific choice” means a broader choice may still apply.</p><label class="coverage-search"><span>Find an integration, device, or entity</span><input type="search" data-config-search value="${esc(this.configQuery)}" placeholder="Search discovered sources"></label><div class="config-tree">${branches}</div></div></section>`;
    const rules = this.configDraft.map((rule, index) => {
      const fields = MATCH_FIELDS.map((field) => `<label><span>${esc(MATCH_LABELS[field])}</span><input type="text" data-rule-index="${index}" data-rule-field="match:${field}" value="${esc((rule.match?.[field] ?? []).join(", "))}" placeholder="Any" autocomplete="off"></label>`).join("");
      return `<section class="config-rule"><div class="config-rule-head"><label><span>Rule ID</span><input type="text" data-rule-index="${index}" data-rule-field="id" value="${esc(rule.id)}" spellcheck="false"></label><label><span>Action</span><select data-rule-index="${index}" data-rule-field="action"><option value="attach"${rule.action === "attach" ? " selected" : ""}>Watch availability</option><option value="exclude"${rule.action === "exclude" ? " selected" : ""}>Exclude</option></select></label><label class="config-enabled"><input type="checkbox" data-rule-index="${index}" data-rule-field="enabled"${rule.enabled !== false ? " checked" : ""}> Enabled</label><button type="button" class="link" data-remove-rule="${index}">Remove</button></div><details class="config-matches"><summary>Match sources · ${esc(Object.keys(rule.match ?? {}).join(", ") || "all eligible sources")}</summary><p class="sub">Fields combine with AND; comma-separated values within one field combine with OR. Empty fields match anything. Exclusions always win.</p><div class="config-fields">${fields}</div></details></section>`;
    }).join("");
    const preview = this.configPreview;
    const changes = (items, count, label) => count ? `<div><strong>${count} ${label}</strong><ul>${items.map((item) => `<li>${esc(item.name)} <span class="small">${esc(item.node_id)}</span></li>`).join("")}</ul>${count > items.length ? `<p class="small">Showing the first ${items.length}.</p>` : ""}</div>` : `<p>No sources ${label}.</p>`;
    const result = preview ? `<section class="panel config-preview" aria-live="polite"><div class="panel-head"><h2>Preview of current inventory</h2></div><div class="body"><p><strong>${preview.watched}</strong> watched sources after this change.</p><div class="config-change-list">${changes(preview.added,preview.added_count,"newly watched")}${changes(preview.removed,preview.removed_count,"no longer watched")}</div><details><summary>Rule match counts</summary><ul>${preview.matches.map((item) => `<li>${esc(item.id)}: ${item.matches} matching sources</li>`).join("")}</ul></details>${preview.functions.length ? `<details><summary>Function readiness from current evidence</summary><ul>${preview.functions.map((item) => `<li>${esc(item.name)}: ${esc(item.readiness.answer)}${item.requirements.some((source) => source.monitoring === "excluded" || source.monitoring === "unwatched") ? " · has an unwatched requirement" : ""}</li>`).join("")}</ul><p class="small">This preview does not replay existing holds or episode history.</p></details>` : ""}<p class="small">This preview uses current Home Assistant evidence. New devices may match these rules later.</p></div></section>` : "";
    const advanced = `<details class="config-advanced"${this.configAdvancedOpen ? " open" : ""}><summary>Advanced rules · ${this.configDraft.length}</summary><div class="body"><p class="sub">Edit combinations such as areas, labels, or device classes here. These are the same rules used by the choices above.</p><button type="button" class="button" data-action="add-rule"${this.configBusy ? " disabled" : ""}>Add advanced rule</button><fieldset class="config-editor"${this.configBusy ? " disabled" : ""}>${rules || '<p>No rules. Nothing is selected for passive monitoring.</p>'}</fieldset></div></details>`;
    const actions = `<section class="panel"><div class="panel-head"><h2>Review changes</h2></div><div class="body"><p>Exclusions take precedence over watch rules. Excluding a required source leaves its function without that evidence. Preview shows the effective result before anything is saved.</p><div class="config-actions"><button type="button" class="button" data-action="preview-configuration"${this.configBusy ? " disabled" : ""}>Preview changes</button><button type="button" class="button primary" data-action="save-configuration"${!preview || this.configBusy ? " disabled" : ""}>Save monitoring choices</button><button type="button" class="link" data-action="load-configuration"${this.configBusy ? " disabled" : ""}>Discard edits and reload</button></div>${this.configError ? `<p class="config-error" role="alert">${esc(this.configError)}</p>` : ""}</div></section>`;
    return `${intro}${sections}${monitoringIntro}${browser}${actions}${result}<section class="panel">${advanced}</section>`;
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

  displaySourceName(source) {
    if (source?.kind !== "integration") return source?.name ?? "Monitored source";
    const provider = integrationProblem(source,[],(key) => this._hass.localize?.(key)).integration;
    return provider === "Home Assistant" || source.name.toLocaleLowerCase().includes(provider.toLocaleLowerCase())
      ? source.name : `${provider} · ${source.name}`;
  }

  problems(data, compact = false) {
    const nodes = sourceMap(data);
    const groups = compact ? homeEpisodeGroups(data) : null;
    const episodes = groups ? groups.visible : sortedEpisodes(data);
    if (!episodes.length) {
      const notReady = data.functions.filter((f) => f.readiness.answer !== "ready");
      const detail = !data.functions.length ? "No home functions are defined yet. Monitoring shows what has been selected for HA checks."
        : notReady.length ? `${notReady.length} function(s) are not confirmed ready. Review their requirements and evidence.`
        : "Defined functions are ready based on their current HA checks.";
      return `<section class="empty"><h2>No open problems reported</h2><p class="sub">${esc(detail)}</p></section>`;
    }
    return episodes.map((episode) => {
      const source = nodes.get(episode.anchor);
      const situation = source?.kind === "situation";
      const affected = affectedFunctions(data, episode);
      const title = this.displaySourceName(source);
      const problem = deviceProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
        integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor]) ??
        entityProblem(source, data.inventory.entity_status?.[episode.anchor], nodes.get(`entry:${source?.owner_id}`), data.areas, (key) => this._hass.localize?.(key));
      const summary = problem?.summary ?? (situation ? "This reported condition remains open. Check its current state." : "Home Assistant reports a problem. Open the details to check what is affected.");
      const impact = affected.map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`).join("; ");
      return `<section class="issue ${problem?.tone ?? (situation ? "situation" : "failure")}"><p class="small">${esc(problem?.context ?? problem?.integration ?? (situation ? "Situation" : "Home Assistant"))}${["high","critical"].includes(episode.importance) ? ` · ${esc(episode.importance === "critical" ? "Critical" : "Important")}` : ""}</p><h2>${esc(title)}</h2>${problem ? `<h3 class="issue-condition">${esc(problem.headline)}</h3>` : ""}<p>${esc(summary)}</p>${impact ? `<p class="impact-line">${esc(impact)}</p>` : ""}<p class="small problem-progress">Since ${esc(date(episode.opened_at))}${problem ? ` · ${esc(problem.progress)}` : ""}</p><div class="actions">${problem?.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : ""}<button type="button" class="${problem?.needsAction ? "link" : "button"}" data-episode="${esc(episode.episode_id)}">${source?.kind === "entity" ? "What to check" : "View details"}</button></div></section>`;
    }).join("") + (groups?.waiting ? `<section class="panel"><div class="body"><strong>${groups.waiting} sources need current evidence.</strong><p class="sub">Their status is unknown; this does not establish an outage.</p><button type="button" class="link" data-page="coverage">Review monitoring →</button></div></section>` : "") + (groups?.hidden ? `<section class="panel"><div class="body"><strong>${groups.hidden} more open problems.</strong> <button type="button" class="link" data-page="problems">View all problems →</button></div></section>` : "");
  }

  functionsPanel(data, selected = data.functions) {
    const nodes = sourceMap(data);
    return `<section class="panel"><div class="panel-head"><h2>Home functions</h2><span class="small">${selected.length} defined</span></div>${selected.length ? selected.map((item) => {
      const causes = item.readiness.nodes.map((node) => nodes.get(node.node_id)?.name ?? node.node_id);
      return `<button type="button" class="row" data-node="${esc(item.node_id)}">${icon("check-network-outline")}<span class="row-main">${esc(item.name)}<small>${esc(causes.join(", ") || "Declared requirements pass their current checks")}</small></span>${status(item.readiness.answer)}</button>`;
    }).join("") : '<div class="body"><p class="sub">Define the important jobs your house should perform and the sources they require.</p><button type="button" class="link" data-settings-section="functions">Review functions in Settings →</button></div>'}</section>`;
  }

  monitoringGlance(data) {
    const watched = data.inventory.catalog.watched;
    const devices = deviceRegistryCoverage(data);
    const evidence = Math.max(0,data.evidence_gaps - Number(Boolean(data.coverage.notification_consumer_missing)));
    return `<section class="panel"><div class="panel-head"><h2>Limits on this picture</h2></div><div class="body"><p>${watched} sources are selected for HA integration-state or entity-availability checks.</p><p>${devices.watched} of ${devices.total} enabled HA device records have a selected availability summary. ${devices.withoutEvidence} lack an eligible HA entity signal; ${devices.disabled} disabled records are excluded.</p>${evidence ? `<p><strong>${evidence} monitoring ${evidence === 1 ? "item needs" : "items need"} evidence review.</strong> This does not establish that the equipment failed.</p>` : '<p>No missing check evidence is reported for selected sources.</p>'}<button type="button" class="link" data-page="coverage">Review monitoring →</button>${!data.policy.notifications_enabled ? '<p class="home-alert-state">Notification requests are off. <button type="button" class="link" data-settings-section="alerts">Review alert settings →</button></p>' : ""}${data.coverage.notification_consumer_missing ? '<p class="home-alert-state">The notification consumer is missing or disabled. <button type="button" class="link" data-settings-section="alerts">Review alert settings →</button></p>' : ""}</div></section>`;
  }

  overview(data) {
    const activeControls = (data.inventory.operator_controls ?? []).length;
    const recentlyResolved = data.inventory.resolved_history?.episodes?.length ?? 0;
    return `<div class="intro"><div><h1>Home</h1><p class="sub">What matters now, what is affected, and what you can do.</p></div><span class="small">Updated ${esc(date(data.updated_at))}</span></div>${this.problems(data,true)}<div class="grid"><div class="stack">${this.functionsPanel(data)}</div><div class="stack">${this.monitoringGlance(data)}${activeControls ? controlsPanel(data) : ""}</div></div>${recentlyResolved ? `<p class="home-history-link"><button type="button" class="link" data-page="history">${recentlyResolved} recently resolved · View history →</button></p>` : ""}`;
  }

  history(data) {
    const activity = recentActivity(data,50);
    return `<div class="intro"><div><h1>History</h1><p class="sub">Ended problems and monitoring changes have different records and retention.</p></div></div>${this.tools.historyPanel(data)}<details class="history-monitoring"><summary>Monitoring changes from this run · ${activity.length}</summary>${this.changes(data,activity)}</details>`;
  }

  changes(data, activity = recentActivity(data,50)) {
    this.activityEntries = activity;
    const entries = activity.map((entry,index) => {
      const action = entry.kind === "source" && entry.registered
        ? `<button type="button" class="link" data-node="${esc(entry.nodeId)}">View source</button>`
        : entry.sources?.length ? `<button type="button" class="link" data-activity-index="${index}">Review sources in Monitoring</button>`
          : '<button type="button" class="link" data-page="coverage">Review monitoring</button>';
      return `<article class="activity-item"><div class="activity-copy"><strong>${esc(entry.title)}</strong><p>${esc(entry.summary)}</p><p class="small">${esc(date(entry.at))}</p></div><div class="activity-actions">${action}</div>${activitySourceList(entry)}<details class="activity-technical"><summary>Technical details</summary><pre>${json(entry.technical)}</pre></details></article>`;
    }).join("");
    return `<section class="panel"><div class="panel-head"><h2>Monitoring changes</h2></div><div class="body"><p class="small">Only the last 50 records from this run are available. The scope found at load is a snapshot, not a new change. Earlier activity is not reconstructed.</p></div>${entries || '<div class="body"><p class="sub">No monitoring activity recorded in this run.</p></div>'}</section>`;
  }

  houseSource(registered, source, coverage) {
    const reasons = coverage?.reasons ?? [];
    const label = source.excluded_by.length ? "Excluded by rule"
      : source.watched ? reasons.length ? "Evidence needs review" : "Monitored"
        : "Not selected for monitoring";
    const explanation = source.excluded_by.length ? "An exclusion rule applies. Review it in Settings if this source should be watched."
      : source.watched ? reasons.join(" · ") || "No missing or stale check evidence reported."
        : "Not currently monitored. Review Settings if it should be watched.";
    const name = registered.has(source.node_id)
      ? `<button type="button" class="link" data-node="${esc(source.node_id)}">${esc(source.name)}</button>`
      : `<strong>${esc(source.name)}</strong>`;
    return `<div class="house-source"><div class="house-source-name">${name}${source.entity_id ? `<span class="small">${esc(source.entity_id)}</span>` : ""}</div><div class="house-source-state"><span class="house-state${reasons.length ? " has-gap" : ""}">${esc(label)}</span><span class="small">${esc(explanation)}</span>${coverage?.guidance && reasons.length ? `<span class="small">Next: ${esc(coverage.guidance)}</span>` : ""}</div><div class="house-source-actions"><button type="button" class="link" data-coverage-source="${esc(source.node_id)}">Review monitoring</button></div></div>`;
  }

  coverageExpanded(id, gaps, searching) {
    return searching || (this.coverageDisclosure.has(id)
      ? this.coverageDisclosure.get(id) : gaps > 0);
  }

  coverageSource(item) {
    const source = item.source;
    const rules = source.excluded_by.length ? source.excluded_by : source.attached_by;
    const check = source.kind === "integration" ? "Home Assistant integration state"
      : source.kind === "entity" ? "Home Assistant entity availability"
        : source.kind === "device" ? "Home Assistant device availability"
        : source.kind === "function" ? "Defined function requirements" : "Defined source";
    const limit = source.kind === "integration" ? "This check does not test whether the integration's service works end to end."
      : source.kind === "entity" ? "An HA state does not confirm a fresh physical reading or successful command."
        : source.kind === "device" ? "Associated HA entity states do not confirm physical connectivity."
        : "Only declared requirements and their available checks can be assessed.";
    const affected = item.affectedFunctions.length
      ? `<span class="coverage-impact">Defined functions affected: ${esc(item.affectedFunctions.map((fn) => `${fn.name} (${ownerStatus(fn.readiness)})`).join(", "))}</span>` : "";
    const guidance = item.guidance
      ? `<span class="coverage-guidance">What to do: ${esc(item.guidance)}</span>` : "";
    const evidence = item.reasons.length
      ? `<strong class="coverage-state">${source.disabled ? "Disabled in Home Assistant" : "Current evidence needs review"}</strong>${item.reasons.map((reason) => `<span class="coverage-gap">${esc(reason)}</span>`).join("")}${affected}${guidance}`
      : `<span class="small">${esc(source.excluded_by.length ? "Excluded from monitoring" : !source.watched ? "Not selected for monitoring" : "No missing check evidence reported")}</span>`;
    const displayName = this.displaySourceName(source);
    const name = item.registered
      ? `<button type="button" class="link coverage-name" data-node="${esc(source.node_id)}">${esc(displayName)}</button>`
      : `<span class="coverage-name">${esc(displayName)}</span>`;
    const areas = source.attributes.area?.length
      ? `<span class="small">Area reference: ${esc(source.attributes.area.join(", "))}</span>` : "";
    const change = source.kind === "device" && source.attributes.device?.[0]
      ? `<a href="/config/devices/device/${esc(source.attributes.device[0])}">Open device in Home Assistant</a>`
      : ["integration","entity"].includes(source.kind)
        ? `<button type="button" class="link" data-config-source="${esc(source.name)}">Change monitoring</button>`
        : '<button type="button" class="link" data-settings-section="functions">Review definitions</button>';
    const native = source.kind === "integration" && item.reasons.length
      ? `<a href="${esc(integrationProblem(source,[],(key) => this._hass.localize?.(key)).integrationUrl)}">Open in Home Assistant</a>` : "";
    return `<div class="coverage-source${item.reasons.length && !source.disabled ? " has-gap" : ""}${source.disabled ? " is-disabled" : ""}"><div>${name}<span class="small">${esc(check)}</span>${areas}</div><div class="coverage-evidence">${evidence}<span class="small">${esc(limit)}</span>${native}${item.reasons.length || !source.watched ? change : ""}</div>${rules.length ? `<details class="rule-details"><summary>Technical details</summary><span class="mono">${list(rules)}</span></details>` : ""}</div>`;
  }

  coverageDevice(device, groupId, searching) {
    const id = `${groupId}/${device.id}`;
    const expanded = this.coverageExpanded(id,device.gaps,searching);
    const summary = `${device.count} ${device.count === 1 ? "source" : "sources"}${device.gaps ? ` · ${device.gaps} to review` : ""}`;
    return `<div class="coverage-device"><button type="button" class="coverage-toggle device-toggle" data-coverage-toggle="${esc(id)}" aria-expanded="${expanded}"><span class="disclosure" aria-hidden="true"></span><span>${esc(device.name)}</span><span class="small">${esc(summary)}</span></button><div class="coverage-sources"${expanded ? "" : " hidden"}>${device.sources.map((item) => this.coverageSource(item)).join("")}</div></div>`;
  }

  coverageGroup(group, searching) {
    const expanded = this.coverageExpanded(group.id,group.gaps,searching);
    const summary = `${group.count} ${group.count === 1 ? "source" : "sources"}${group.gaps ? ` · ${group.gaps} to review` : ""}`;
    const integration = group.devices.flatMap((device) => device.sources).find((item) => item.source.kind === "integration");
    const name = integration ? this.displaySourceName(integration.source) : group.name;
    const devices = group.devices.map((device) => device.id === `${group.id}:health`
      ? `<div class="coverage-sources">${device.sources.map((item) => this.coverageSource(item)).join("")}</div>`
      : this.coverageDevice(device,group.id,searching)).join("");
    return `<section class="coverage-group"><button type="button" class="coverage-toggle integration-toggle" data-coverage-toggle="${esc(group.id)}" aria-expanded="${expanded}"><span class="disclosure" aria-hidden="true"></span><span>${esc(name)}</span><span class="small">${esc(summary)}</span></button><div class="coverage-devices"${expanded ? "" : " hidden"}>${devices}</div></section>`;
  }

  coverage(data) {
    const view = coverageInventory(data,this.coverageQuery,50,this.coverageSelection);
    const devices = deviceRegistryCoverage(data,this.coverageQuery);
    const searching = Boolean(view.query || this.coverageSelection);
    const gapItems = view.groups.flatMap((group) => group.devices.flatMap((device) =>
      device.sources.filter((item) => item.reasons.length)));
    const attention = !searching && gapItems.length
      ? `<section class="panel"><div class="panel-head"><h2>Monitoring to review</h2><span class="small">${gapItems.length} ${gapItems.length === 1 ? "source" : "sources"}</span></div><div class="coverage-attention">${gapItems.slice(0,20).map((item) => this.coverageSource(item)).join("")}</div>${gapItems.length > 20 ? `<div class="body"><p class="small">Showing first 20 sources. Search by name to review the rest.</p></div>` : ""}</section>`
      : !searching ? '<section class="empty coverage-clear"><h2>No selected source needs evidence review</h2><p class="sub">This describes Homeostatic’s current HA checks, not the physical condition of every device.</p></section>' : "";
    const bounded = searching && view.resultCount > view.shownCount
      ? ` · showing first ${view.shownCount}` : "";
    const heading = this.coverageSelection ? `Selected sources · ${view.resultCount}${bounded}`
      : searching ? `Search results · ${view.resultCount}${bounded}` : "Watched sources and requirements";
    const groups = view.groups.length
      ? view.groups.map((group) => this.coverageGroup(group,searching)).join("")
      : `<div class="body"><p class="sub">${searching ? "No source matches this search." : "No capabilities are currently registered."}</p></div>`;
    const deviceGaps = devices.matches.map((device) => `<div class="coverage-source has-gap"><div><a class="coverage-name" href="/config/devices/device/${esc(device.id)}">${esc(device.name)}</a><span class="small">HA device registry</span></div><div class="coverage-evidence"><strong class="coverage-state">No eligible availability entity</strong><span class="coverage-guidance">Check this device in Home Assistant. An enabled operational or diagnostic entity is needed before Homeostatic can assess availability.</span></div></div>`).join("");
    const deviceGapPanel = !this.coverageSelection && devices.withoutEvidence ? `<section class="panel"><div class="panel-head"><h2>Devices without availability evidence</h2><span class="small">${devices.withoutEvidence} registry records</span></div><div class="body"><p>${devices.available} of ${devices.total} enabled HA device records have an eligible availability summary; ${devices.watched} are selected. ${devices.disabled} disabled records are excluded. Records below have no check and do not become fault problems. ${this.coverageQuery ? `${devices.resultCount} match this search.` : ""}</p></div>${deviceGaps ? `<div class="coverage-attention">${deviceGaps}</div>` : ""}${devices.resultCount > devices.matches.length ? `<div class="body"><p class="small">Showing first ${devices.matches.length}; search by device name to narrow the list.</p></div>` : ""}</section>` : "";
    return `<div class="intro"><div><h1>Monitoring</h1><p class="sub">What Homeostatic checks, where the evidence has limits, and what you can change.</p></div><button type="button" class="button" data-settings-section="monitoring">Change monitoring</button></div><p class="monitoring-lead"><strong>${view.summary.watched} sources selected for HA checks.</strong> These checks report integration state or entity availability; they do not establish physical-device freshness or successful commands.</p>${attention}<label class="coverage-search"><span>Find an integration, device, or source</span><input type="search" data-coverage-search value="${esc(this.coverageQuery)}" placeholder="Search all discovered sources"></label><section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2>${searching ? `<button type="button" class="link" data-action="clear-coverage-search">${esc(this.coverageSelection ? "Show all monitoring" : "Clear search")}</button>` : ""}</div><div class="coverage-groups">${groups}</div></section>${deviceGapPanel}${!searching ? `<section class="panel monitoring-discovery"><div class="panel-head"><h2>Other discovered sources</h2></div><div class="body"><p>${view.summary.excluded} excluded · ${view.summary.unselected} not selected. These are available through search; an unselected source is not a problem by itself.</p></div></section>` : ""}`;
  }

  house(data) {
    const tree = locationTree(data);
    const locations = locationList(tree);
    const selected = locations.find((location) => location.id === this.location) ??
      locations.find((location) => location.kind === "area") ?? locations[0];
    this.location = selected?.id ?? null;
    if (!selected) {
      return '<div class="empty">No Home Assistant floors, areas, or unassigned entities have been discovered.</div>';
    }
    const related = selected.functions;
    const registered = sourceMap(data);
    const coverage = new Map(coverageInventory(data,"",50,new Set(selected.sources.map((source) => source.node_id))).groups.flatMap((group) =>
      group.devices.flatMap((device) => device.sources.map((item) => [item.source.node_id, item]))));
    const sourceRows = selected.sources;
    const {episodes,evidenceGaps:gaps,requiredUnselected,watched,excluded,unselected} =
      locationAssessment(data,selected);
    const count = (value, label) => `${value} ${label}${value === 1 ? "" : "s"}`;
    const monitoringSummary = [count(watched,"monitored source"),
      unselected ? count(unselected,"not selected source") : null,
      excluded ? count(excluded,"excluded source") : null].filter(Boolean).join(" · ");
    const summary = `<div class="house-summary"><div><strong>${esc(count(episodes.length,"linked open problem"))}</strong><span>${esc(count(gaps.length,"monitored evidence gap"))}</span><span>${esc(`${related.length} ${related.length === 1 ? "function" : "functions"} using sources here`)}</span></div><p>${esc(monitoringSummary)}</p>${!watched && !related.length ? '<p>Homeostatic has no basis to assess what this location should do yet.</p>' : ""}${unselected ? '<p>Not selected means no monitoring rule chose these entities. It does not mean they are broken or need individual checks.</p>' : ""}<div class="house-summary-actions"><button type="button" class="link" data-page="coverage">Review monitoring →</button>${unselected || excluded ? '<button type="button" class="link" data-settings-section="monitoring">Change monitoring →</button>' : ""}</div></div>`;
    const functions = related.length ? `${this.functionsPanel(data, related)}<p class="small house-functions-note">These functions require a source assigned to this location; their work may happen elsewhere.</p>`
      : '<section class="panel"><div class="panel-head"><h2>Functions using sources here</h2></div><div class="body"><p>No defined function currently requires a discovered source in this location. Homeostatic cannot infer what should work here from entity names alone.</p><p class="sub">Define important functions and their required sources in Homeostatic options.</p><a class="button" href="/config/integrations">Open Home Assistant integrations</a></div></section>';
    const problems = episodes.length ? `<section class="panel house-findings"><div class="panel-head"><h2>Open problems linked to this location</h2></div>${episodes.map((episode) => {
      const source = registered.get(episode.anchor);
      const problem = integrationProblem(source,episode.reasons,(key) => this._hass.localize?.(key),data.inventory.integration_evidence?.[episode.anchor]) ??
        entityProblem(source,data.inventory.entity_status?.[episode.anchor],registered.get(`entry:${source?.owner_id}`),data.areas,(key) => this._hass.localize?.(key));
      const impact = affectedFunctions(data,episode).map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`);
      return `<div class="house-finding"><div><strong>${esc(source?.name ?? "Monitored source")}</strong><p class="small">${esc(problem?.summary ?? "An open problem is linked to this location. Review its current evidence.")}</p>${impact.length ? `<p class="small">${esc(impact.join("; "))}</p>` : ""}</div><button type="button" class="link" data-episode="${esc(episode.episode_id)}">View problem</button></div>`;
    }).join("")}</section>` : "";
    const gapRows = gaps.map((source) => {
      const item = coverage.get(source.node_id);
      const functions = item.affectedFunctions.map((fn) => `${fn.name} (${fn.readiness})`);
      return `<div class="house-finding"><div><strong>${esc(source.name)}</strong><p class="small">${esc(item.reasons.join(" · "))}</p>${functions.length ? `<p class="small">Function readiness: ${esc(functions.join(", "))}</p>` : ""}${item.guidance ? `<p class="small">Next: ${esc(item.guidance)}</p>` : ""}</div><button type="button" class="link" data-coverage-source="${esc(source.node_id)}">Review evidence</button></div>`;
    }).join("");
    const requiredRows = requiredUnselected.map((source) =>
      `<div class="house-finding"><div><strong>${esc(source.name)}</strong><p class="small">A defined function requires this source, but it is not selected for monitoring. Review whether to monitor it before relying on that function's readiness.</p></div><button type="button" class="link" data-coverage-source="${esc(source.node_id)}">Review monitoring</button></div>`).join("");
    const evidence = gaps.length || requiredUnselected.length
      ? `<section class="panel house-findings"><div class="panel-head"><h2>Monitoring to review</h2></div>${gapRows}${requiredRows}</section>`
      : "";
    const allClear = (watched || related.length) && !episodes.length && !gaps.length && !requiredUnselected.length
      ? '<section class="panel house-status"><div class="body"><h2>No linked problems or source evidence gaps reported</h2><p class="sub">This covers selected monitoring only. Unselected entities have not been assessed.</p></div></section>' : "";
    const devices = selected.devices.length
      ? `<div class="house-section"><h3>Home Assistant devices</h3>${selected.devices.map((device) => `<details class="house-group"${selected.devices.length === 1 ? " open" : ""}><summary>${esc(device.name)} <span class="small">${device.sources.length} source${device.sources.length === 1 ? "" : "s"}</span></summary>${device.sources.map((source) => this.houseSource(registered,source,coverage.get(source.node_id))).join("")}</details>`).join("")}</div>`
      : "";
    const signals = selected.signals.length
      ? `<details class="house-group house-signals"><summary>Entities without a Home Assistant device <span class="small">${selected.signals.length} entit${selected.signals.length === 1 ? "y" : "ies"}</span></summary><p class="sub">Home Assistant associates these entities with the location but not with a device.</p>${selected.signals.map((source) => this.houseSource(registered,source,coverage.get(source.node_id))).join("")}</details>`
      : "";
    const inventory = `<section class="panel"><details class="house-inventory"><summary>Discovered Home Assistant entities <span class="small">${esc(count(sourceRows.length,"entity"))}</span></summary><p class="sub">Device and location associations organize this list. They do not establish physical hardware or health dependencies.</p>${devices}${signals || (!devices ? '<p class="sub">No entities are associated with this location.</p>' : "")}</details></section>`;
    return `<div class="intro"><div><h1>Explore</h1><p class="sub">Current functions, problems, and monitoring by Home Assistant location.</p></div></div><div class="house" style="--house-rail-width:${this.railWidth}px"><section class="panel locations" aria-label="Locations"><div class="location-tree" role="tree">${tree.map((location) => locationBranch(location, selected.id, this.collapsedLocations)).join("")}</div></section><div class="rail-resizer" role="separator" tabindex="0" aria-label="Resize locations panel" aria-orientation="vertical" aria-valuemin="${RAIL_MIN}" aria-valuemax="${RAIL_MAX}" aria-valuenow="${this.railWidth}" aria-valuetext="${this.railWidth} pixels" title="Drag or use arrow keys to resize locations"></div><div class="stack"><section class="panel"><div class="panel-head"><div><p class="small">${esc(selected.parent_name)}</p><h2>${esc(selected.name)}</h2></div><span class="small">${esc(selected.kind === "area" ? "Area" : selected.kind === "floor" ? "Floor" : "Location group")}</span></div>${summary}</section>${functions}${problems}${evidence}${allClear}${inventory}</div></div>`;
  }

  setRailWidth(width, save = true) {
    const house = this.shadowRoot.querySelector(".house");
    const limit = house ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.floor(house.clientWidth * 0.45))) : RAIL_MAX;
    this.railWidth = Math.max(RAIL_MIN, Math.min(limit, Math.round(width)));
    house?.style.setProperty("--house-rail-width", `${this.railWidth}px`);
    const handle = house?.querySelector(".rail-resizer");
    handle?.setAttribute("aria-valuenow", String(this.railWidth));
    handle?.setAttribute("aria-valuetext", `${this.railWidth} pixels`);
    if (save) {
      try { window.localStorage.setItem(RAIL_WIDTH_KEY, String(this.railWidth)); } catch { /* Storage can be unavailable in embedded views. */ }
    }
  }

  startRailResize(event) {
    const handle = event.target.closest?.(".rail-resizer");
    if (!handle) return;
    event.preventDefault();
    this.railResize = {x:event.clientX,width:this.railWidth};
    handle.setPointerCapture(event.pointerId);
  }

  moveRailResize(event) {
    if (!this.railResize) return;
    this.setRailWidth(this.railResize.width + event.clientX - this.railResize.x, false);
  }

  endRailResize(event) {
    if (!this.railResize) return;
    this.moveRailResize(event);
    this.railResize = null;
    this.setRailWidth(this.railWidth);
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
    else if (button.dataset.coverageSource) {
      this.coverageSelection = new Set([button.dataset.coverageSource]);
      this.coverageQuery = "";
      this.page = "coverage";
      this.render();
    }
    else if (button.dataset.activityIndex !== undefined) {
      const entry = this.activityEntries[Number(button.dataset.activityIndex)];
      this.coverageSelection = new Set(entry.sources.map((source) => source.nodeId));
      this.coverageQuery = "";
      this.page = "coverage";
      this.render();
    }
    else if (button.dataset.page) {this.page = button.dataset.page; this.render(); if (this.page === "configuration" && this.settingsSection === "monitoring" && !this.configuration) this.loadConfiguration();}
    else if (button.dataset.settingsSection) {
      this.page = "configuration";
      this.settingsSection = button.dataset.settingsSection;
      this.render();
      if (this.settingsSection === "monitoring" && !this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.removeRule !== undefined) {this.configDraft.splice(Number(button.dataset.removeRule),1); this.configPreview = null; this.render();}
    else if (button.dataset.ignoreAvailability) this.ignoreAvailability(button.dataset.ignoreAvailability);
    else if (button.dataset.configSource) {this.dialog.close(); this.configQuery = button.dataset.configSource; this.expandConfigurationMatches(this.configQuery); this.settingsSection = "monitoring"; this.page = "configuration"; this.render(); if (!this.configuration) this.loadConfiguration();}
    else if (button.dataset.location) {this.location = button.dataset.location; this.page = "house"; this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") this.dialog.close();
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "add-rule") {this.configDraft.push(newCatalogRule(this.configDraft)); this.configPreview = null; this.render();}
    else if (button.dataset.action === "open-advanced-rules") {
      this.settingsSection = "monitoring";
      this.configAdvancedOpen = true;
      this.render();
      if (!this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.action === "load-configuration") this.loadConfiguration();
    else if (button.dataset.action === "preview-configuration") this.previewConfiguration();
    else if (button.dataset.action === "save-configuration") this.saveConfiguration();
    else if (button.dataset.action === "clear-coverage-search") {this.coverageQuery = ""; this.coverageSelection = null; this.render();}
  }

  keydown(event) {
    if (event.target.matches?.(".rail-resizer")) {
      const delta = {ArrowLeft:-24,ArrowRight:24,Home:RAIL_MIN - this.railWidth,
        End:RAIL_MAX - this.railWidth}[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      this.setRailWidth(this.railWidth + delta);
      return;
    }
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

  async ignoreAvailability(nodeId) {
    if (this.configBusy || this.current.status !== "current") return;
    const source = inventoryRows(this.current.data).find((item) => item.node_id === nodeId);
    if (!source) return;
    this.dialog.close();
    this.settingsSection = "monitoring";
    this.page = "configuration";
    if (!this.configuration) await this.loadConfiguration();
    if (!this.configuration || this.current.status !== "current") return;
    const scope = monitoringScope("entity",nodeId,source);
    if (!scope || !setScopeChoice(this.configDraft,scope,"exclude")) {
      this.configError = "Multiple direct choices apply. Review this entity in the advanced rules before ignoring availability.";
    } else {
      this.configError = null;
    }
    this.configQuery = source.entity_id ?? source.name;
    this.expandConfigurationMatches(this.configQuery);
    this.configPreview = null;
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
      this.shadowRoot.querySelector("#detail-title").textContent = this.displaySourceName(source);
      this.shadowRoot.querySelector("#detail-label").textContent = source.kind === "situation" ? "Situation" : episode ? "Open problem" : "Capability";
      const currentFunctions = episode ? affectedFunctions(data, episode) : [];
      const diagnostic = diagnosticOverview(source, result, currentFunctions, Boolean(episode));
      const findings = result.explanation.findings;
      const problem = deviceProblem(source, result.entity_status, Boolean(episode)) ??
        integrationProblem(source, findings, (key) => this._hass.localize?.(key), result.integration_evidence, Boolean(episode)) ??
        entityProblem(source, result.entity_status, nodes.get(`entry:${source.owner_id}`), data.areas, (key) => this._hass.localize?.(key), Boolean(episode));
      const memberEvidence = result.device_evidence;
      const availabilityChoices = memberEvidence ? `<section class="detail"><h3>Entities expected to be available</h3><p class="small">Current Home Assistant states. Ignoring availability opens a draft monitoring change for preview and save.</p><ul>${memberEvidence.members.map((member) => `<li><strong>${esc(member.name)}</strong> · ${esc(member.restored ? "Restored; current value unknown" : member.state)} <button class="link" type="button" data-ignore-availability="${esc(member.node_id)}">Ignore availability…</button></li>`).join("")}</ul><p class="small">Showing ${memberEvidence.members.length} of ${memberEvidence.total} selected entities.</p><button class="link" type="button" data-config-source="${esc(source.name)}">Review all monitoring choices</button></section>` : source.kind === "entity" ? `<section class="detail"><button class="button" type="button" data-ignore-availability="${esc(source.node_id)}">Ignore this availability check…</button><p class="small">Opens a draft monitoring change for preview and save. Home Assistant state stays unchanged.</p></section>` : "";
      const dependencies = result.explanation.nodes.filter((node) => node.node_id !== nodeId);
      const unwatched = result.readiness?.nodes.filter((node) => !node.watched) ?? [];
      const nativeLink = source.kind === "integration" && problem ? (problem.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : "") : source.entity_id
        ? `<button class="button primary" type="button" data-entity="${esc(source.entity_id)}">${esc(problem?.entityLabel ?? "View in Home Assistant")}</button>`
        : source.entry_id || source.owner_id ? '<a class="button primary" href="/config/integrations">Review connection</a>' : "";
      const explanation = episode ? data.policy.episodes.find((item) => item.episode_id === episode.episode_id) : null;
      const controls = (data.inventory.operator_controls ?? []).filter((control) => [episode?.episode_id, nodeId].includes(control.target));
      const diagnosticData = {evidence:result,policy:explanation,notifications_enabled:data.policy.notifications_enabled,controls};
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      const genericSummary = source.kind === "situation" ? (episode ? "This reported condition remains open. Check its current state." : "No open problem is reported for this condition.")
        : result.readiness ? `${ownerStatus(result.readiness.answer)} in Home Assistant.` : "Current status has not been confirmed.";
      body.innerHTML = `<section class="detail problem-brief">${problem ? `<p class="small">${esc(problem.context ?? problem.integration)}</p><h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}</section>
        ${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}
         ${problem?.connectionNote ? `<section class="detail"><p>${esc(problem.connectionNote)}</p><button class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button></section>` : ""}
         <section class="detail next-action"><h3>What you can do</h3><p>${esc(problem?.nextStep ?? (nativeLink ? "Check the current state in Home Assistant." : "Check the listed requirements to find what needs attention."))}</p>${nativeLink || problem?.deviceUrl ? `<div class="actions">${nativeLink}${problem?.deviceUrl ? `<a class="button" href="${esc(problem.deviceUrl)}">Open device page</a>` : ""}</div>` : ""}</section>
         ${availabilityChoices}
         <section class="detail evidence-overview" aria-label="Evidence summary"><h3>What Homeostatic knows</h3><dl><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd><dt>What is checked</dt><dd>${esc(diagnostic.checks)}</dd><dt>Current assessment</dt><dd>${esc(diagnostic.assessment)}</dd><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></dl></section>
         <p class="small problem-progress">${episode ? `Since ${esc(date(episode.opened_at))}` : "Current status"}${problem ? ` · ${esc(problem.progress)}` : ""}</p>
         ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Working on equipment"} until ${esc(date(control.until))}.</p>`).join("")}
        ${this.tools.detailButtons(source, episode, data)}
        <details ${disclosure("technical")}><summary>Technical details</summary>
          ${problem?.reported ? `<div class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">From an earlier attempt; the current activity is shown above.</p>' : ""}<pre>${esc(problem.reported)}</pre></div>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : ""}
          ${problem?.logsUrl ? `<p><a class="button" href="${esc(problem.logsUrl)}">View integration logs</a></p>` : ""}
          ${dependencies.length || unwatched.length ? `<h3>Reported requirements</h3><ul>${dependencies.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · ${esc(node.own)} · ${list(node.reasons)}</li>`).join("")}${unwatched.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · Not monitored</li>`).join("")}</ul>` : ""}
          ${source.kind === "function" ? `<h3>Requirements</h3><ul>${source.requirements.map((id) => `<li><button class="link" type="button" data-node="${esc(id)}">${esc(nodes.get(id)?.name ?? id)}</button></li>`).join("")}</ul>` : ""}
          <p class="small">Diagnostic data contain internal identifiers. Review before sharing.</p>
          <button type="button" class="button" data-copy-diagnostics>Copy diagnostic data</button><p class="small" data-copy-feedback role="status"></p>
          <details ${disclosure("diagnostics")}><summary>View raw data</summary><pre>${json(diagnosticData)}</pre></details>
        </details>`;
      body.querySelector("[data-copy-diagnostics]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const feedback = body.querySelector("[data-copy-feedback]");
        button.disabled = true;
        try {
          await navigator.clipboard.writeText(JSON.stringify(diagnosticData, null, 2));
          feedback.textContent = "Diagnostic data copied.";
        } catch {
          feedback.textContent = "Could not copy. Open View raw data to select and copy the text manually.";
        } finally {
          button.disabled = false;
        }
      });
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
      {title:"Home",path:"overview",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"overview",navigation:false}]},
      {title:"Explore",path:"house",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"house",navigation:false}]},
      {title:"Monitoring",path:"coverage",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"coverage",navigation:false}]},
      {title:"History",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"history",navigation:false}]},
      {title:"Settings",path:"configuration",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"configuration",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v21")) customElements.define("homeostatic-card-v21", HomeostaticCard);
if (!customElements.get("homeostatic-panel-v21")) customElements.define("homeostatic-panel-v21", HomeostaticPanel);
if (!customElements.get("homeostatic-card-v15")) customElements.define("homeostatic-card-v15", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v15")) customElements.define("homeostatic-panel-v15", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v14")) customElements.define("homeostatic-card-v14", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v14")) customElements.define("homeostatic-panel-v14", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v13")) customElements.define("homeostatic-card-v13", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v13")) customElements.define("homeostatic-panel-v13", class extends HomeostaticPanel {});
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
