import {affectedFunctions, coverageInventory, dashboardStore, deviceRegistryCoverage, escapeHtml as esc,
  inventoryRows, locationAssessment, locationList, locationTree, monitoringLabel, recentEpisodes, sortedEpisodes,
  sourceMap} from "./model.mjs?v=23";
import {deviceProblem, entityProblem, integrationProblem} from "./problem.mjs?v=23";
import {DashboardTools, controlsPanel} from "./history-controls.mjs?v=23";
import {diagnosticOverview} from "./evidence.mjs?v=23";
import {editCatalogRule, MATCH_FIELDS, MATCH_LABELS, monitoringScope,
  newCatalogRule, scopeChoice, setScopeChoice} from "./configuration.mjs?v=23";
import {styles} from "./styles.mjs?v=23";
import {locationBranch, setBranchExpanded} from "./tree.mjs?v=23";

import {configurationBrowser, monitoringNavigation, monitoringIndex, revealMonitoringPath} from "./monitoring-browser.mjs?v=23";

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
const EXPLORE_LOCATION_KEY = "homeostatic-explore-location";
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

function savedExploreLocation() {
  try { return window.sessionStorage.getItem(EXPLORE_LOCATION_KEY); }
  catch { return null; }
}

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "overview"};
    this.page = "overview";
    this.location = savedExploreLocation();
    this.locationName = null;
    this.collapsedLocations = new Set();
    this.railWidth = savedRailWidth();
    this.railResize = null;
    this.coverageQuery = "";
    this.coverageSelection = null;
    this.coverageLocation = null;
    this.configuration = null;
    this.configDraft = null;
    this.configPreview = null;
    this.configError = null;
    this.configBusy = false;
    this.configQuery = "";
    this.configExpanded = new Set();
    this.configPages = new Map();
    this.configSelection = null;
    this.configDisclosures = new Map();
    this.settingsSection = "monitoring";
    this.configAdvancedOpen = false;
    this.configScopes = [];
    this.coverageDisclosure = new Map();
    this.renderedView = null;
    this.renderedCurrent = false;
    this.savedPageState = null;
    this.exploreState = null;
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Overview</button><button type="button" data-page="problems">Issues</button><button type="button" data-page="house">Explore</button><button type="button" data-page="coverage">Monitoring</button><button type="button" data-page="history">History</button><button type="button" data-page="configuration">Settings</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
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

  viewIdentity() {
    return `${this.page}:${this.page === "house" ? this.location : ""}:${this.page === "configuration" ? this.settingsSection : ""}`;
  }

  disclosures() {
    const occurrences = new Map();
    return [...this.main.querySelectorAll("details:not([data-config-group]):not(.config-advanced)")].map((details) => {
      const owner = `${details.closest(".coverage-attention") ? "attention:" : ""}${details.closest("[data-ui-key]")?.dataset.uiKey ?? ""}`;
      const label = details.querySelector(":scope > summary")?.textContent.trim() ?? "";
      const identity = `${owner}:${label}`;
      const count = occurrences.get(identity) ?? 0;
      occurrences.set(identity,count + 1);
      return [details,`${identity}:${count}`];
    });
  }

  capturePageState() {
    const known = new Set();
    const open = new Set();
    const disclosures = this.disclosures();
    for (const [details,key] of disclosures) {
      known.add(key);
      if (details.open) open.add(key);
    }
    const active = this.shadowRoot.activeElement;
    const focus = this.main.contains(active) ? {
      tag:active.tagName,
      attributes:[...active.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => [attribute.name,attribute.value]),
      disclosure:disclosures.find(([details]) => details.querySelector(":scope > summary") === active)?.[1],
      selection:typeof active.selectionStart === "number" ? [active.selectionStart,active.selectionEnd] : null,
    } : null;
    const scroll = [];
    for (let node = this.main; node; node = node.parentNode ?? node.getRootNode()?.host) {
      if (node.scrollTop || node.scrollLeft) scroll.push([node,node.scrollTop,node.scrollLeft]);
    }
    const innerScroll = [".config-rail",".locations"].map((selector) => {
      const node = this.main.querySelector(selector);
      return [selector,node?.scrollTop ?? 0,node?.scrollLeft ?? 0];
    });
    return {known,open,focus,scroll,innerScroll};
  }

  restorePageState(state) {
    const disclosures = this.disclosures();
    for (const [details,key] of disclosures) {
      if (state.known.has(key)) details.open = state.open.has(key);
    }
    for (const [node,top,left] of state.scroll) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    for (const [selector,top,left] of state.innerScroll) {
      const node = this.main.querySelector(selector);
      if (node) {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
    }
    if (state.focus?.disclosure) {
      disclosures.find(([,key]) => key === state.focus.disclosure)?.[0].querySelector(":scope > summary")?.focus({preventScroll:true});
    } else if (state.focus?.attributes.length) {
      const target = [...this.main.querySelectorAll(state.focus.tag.toLowerCase())].find((element) =>
        state.focus.attributes.every(([name,value]) => element.getAttribute(name) === value));
      target?.focus({preventScroll:true});
      if (state.focus.selection && target?.setSelectionRange) target.setSelectionRange(...state.focus.selection);
    }
  }

  render() {
    const oldDetail = this.main.querySelector(".config-detail");
    const oldBulk = oldDetail?.querySelector("[data-config-disclosure]");
    if (oldDetail?.dataset.selection && oldBulk) this.configDisclosures.set(oldDetail.dataset.selection,oldBulk.open);
    const oldRail = this.main.querySelector(".config-rail");
    const railState = oldRail ? {query:oldRail.dataset.query,top:oldRail.scrollTop} : null;
    const view = this.viewIdentity();
    if (view !== this.renderedView) this.savedPageState = this.page === "house" && this.exploreState?.location === this.location ? this.exploreState.state : null;
    else if (this.renderedCurrent) this.savedPageState = this.capturePageState();
    const minimal = ["functions", "problems"].includes(this.config.view);
    this.shadowRoot.querySelector(".nav").hidden = minimal || this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = this.config.view === "house" && this.locationName
      ? `← Back to ${this.locationName} in Explore`
      : `← Back to ${{overview:"Overview",house:"Explore",coverage:"Monitoring",functions:"Functions",problems:"Issues",history:"History",configuration:"Settings"}[this.config.view]}`;
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
      this.renderedCurrent = false;
      return;
    }
    const data = this.current.data;
    if (this.page === "configuration") this.main.innerHTML = this.configurationPage();
    else if (this.page === "history") this.main.innerHTML = this.history(data);
    else if (this.page === "functions") this.main.innerHTML = this.functionsPanel(data);
    else if (this.page === "problems") this.main.innerHTML = this.issuesPage(data);
    else if (this.page === "coverage") this.main.innerHTML = this.coverage(data);
    else if (this.page === "house") this.main.innerHTML = this.house(data);
    else this.main.innerHTML = this.overview(data);
    if (this.savedPageState) this.restorePageState(this.savedPageState);
    const configDetail = this.main.querySelector(".config-detail");
    if (configDetail) {
      configDetail.dataset.selection = this.configSelection ?? "";
      const bulk = configDetail.querySelector("[data-config-disclosure]");
      if (bulk) bulk.open = this.configDisclosures.get(this.configSelection) ?? false;
      const rail = this.main.querySelector(".config-rail");
      rail.dataset.query = this.configQuery;
      if (railState?.query === this.configQuery) rail.scrollTop = railState.top;
    }
    this.renderedView = this.viewIdentity();
    this.renderedCurrent = true;
  }

  configurationChoice(label, scope, current, detail = "") {
    if (!scope) return `<span class="small">${esc(label)} · no stable identity available</span>`;
    const index = this.configScopes.push(scope) - 1;
    const choice = scopeChoice(this.configDraft,scope);
    const option = (value, name) => `<option value="${value}"${choice === value ? " selected" : ""}>${name}</option>`;
    const choices = choice === "multiple"
      ? '<option selected>Multiple direct rules; edit below</option>'
      : `${option("inherit","Use matching rules")}${option("attach","Watch")}${option("exclude","Ignore availability")}`;
    const original = scopeChoice(this.configuration.rules,scope);
    const pending = original !== choice ? " · Unsaved choice" : "";
    return `<label class="config-choice"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ""}<small>Currently: ${esc(current)}</small><small>Choice: ${choice === "inherit" ? "Use other matching rules" : choice === "attach" ? "Watch; matching exclusions still apply" : choice === "exclude" ? "Ignore availability" : "Review advanced rules"}${pending}</small></span><select data-scope-index="${index}" aria-label="${esc(label)} monitoring choice"${this.configBusy || choice === "multiple" ? " disabled" : ""}>${choices}</select></label>`;
  }

  configurationPage() {
    const data = this.current.data;
    const intro = '<div class="intro"><div><h1>Settings</h1><p class="sub">Choose what Homeostatic watches and how it responds.</p></div></div>';
    const sections = `<nav class="settings-nav" aria-label="Settings sections">${[
      ["monitoring","Monitoring choices"],["functions","Functions & situations"],
      ["alerts","Alerts & delivery"],["advanced","Advanced"],
    ].map(([id,label]) => `<button type="button" class="button${this.settingsSection === id ? " primary" : ""}" data-settings-section="${id}" aria-pressed="${this.settingsSection === id}">${label}</button>`).join("")}</nav>`;
    const optionsUrl = `/config/integrations/integration/homeostatic${data.entry_id ? `#config_entry=${encodeURIComponent(data.entry_id)}` : ""}`;
    const options = `<a class="button" href="${esc(optionsUrl)}">Open Homeostatic in Home Assistant</a><p class="small">Choose Configure or Options on the Homeostatic entry to edit these settings.</p>`;
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
    const monitoringIntro = '<section class="settings-lead"><h2>Monitoring choices</h2><p class="sub">Choose an integration or device, then adjust what you expect to be available. Current monitoring stays unchanged until you review and save. Use matching rules removes a direct choice; other watch or ignore rules may still apply.</p></section>';
    if (!this.configuration) return `${intro}${sections}${monitoringIntro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring rules…")}</p><button type="button" class="button" data-action="load-configuration">Reload configuration</button></div></section>`;
    if (this.main.querySelector(".config-tree")) {
      this.configAdvancedOpen = this.main.querySelector(".config-advanced")?.open ?? false;
    }
    this.configScopes = [];
    const browser = configurationBrowser(this);
    const rules = this.configDraft.map((rule, index) => {
      const fields = MATCH_FIELDS.map((field) => `<label><span>${esc(MATCH_LABELS[field])}</span><input type="text" data-rule-index="${index}" data-rule-field="match:${field}" value="${esc((rule.match?.[field] ?? []).join(", "))}" placeholder="Any" autocomplete="off"></label>`).join("");
      return `<section class="config-rule"><div class="config-rule-head"><label><span>Rule ID</span><input type="text" data-rule-index="${index}" data-rule-field="id" value="${esc(rule.id)}" spellcheck="false"></label><label><span>Action</span><select data-rule-index="${index}" data-rule-field="action"><option value="attach"${rule.action === "attach" ? " selected" : ""}>Watch availability</option><option value="exclude"${rule.action === "exclude" ? " selected" : ""}>Exclude</option></select></label><label class="config-enabled"><input type="checkbox" data-rule-index="${index}" data-rule-field="enabled"${rule.enabled !== false ? " checked" : ""}> Enabled</label><button type="button" class="link" data-remove-rule="${index}">Remove</button></div><details class="config-matches"><summary>Match sources · ${esc(Object.keys(rule.match ?? {}).join(", ") || "all eligible sources")}</summary><p class="sub">Fields combine with AND; comma-separated values within one field combine with OR. Empty fields match anything. Exclusions always win.</p><div class="config-fields">${fields}</div></details></section>`;
    }).join("");
    const preview = this.configPreview;
    const changes = (items, count, label) => count ? `<div><strong>${count} ${label}</strong><ul>${items.map((item) => `<li>${esc(item.name)} <span class="small">${esc(item.node_id)}</span></li>`).join("")}</ul>${count > items.length ? `<p class="small">Showing the first ${items.length}.</p>` : ""}</div>` : `<p>No sources ${label}.</p>`;
    const result = preview ? `<section class="panel config-preview" aria-live="polite"><div class="panel-head"><h2>Preview of current inventory</h2></div><div class="body"><p><strong>${preview.watched}</strong> watched sources after this change.</p><div class="config-change-list">${changes(preview.added,preview.added_count,"newly watched")}${changes(preview.removed,preview.removed_count,"no longer watched")}</div><details><summary>Rule match counts</summary><ul>${preview.matches.map((item) => `<li>${esc(item.id)}: ${item.matches} matching sources</li>`).join("")}</ul></details>${preview.functions.length ? `<details><summary>Function readiness from current evidence</summary><ul>${preview.functions.map((item) => `<li>${esc(item.name)}: ${esc(item.readiness.answer)}${item.requirements.some((source) => source.monitoring === "excluded" || source.monitoring === "unwatched") ? " · has an unwatched requirement" : ""}</li>`).join("")}</ul><p class="small">This preview does not replay existing holds or episode history.</p></details>` : ""}<p class="small">This preview uses current Home Assistant evidence. New devices may match these rules later.</p></div></section>` : "";
    const advanced = `<details class="config-advanced"${this.configAdvancedOpen ? " open" : ""}><summary>Advanced rules · ${this.configDraft.length}</summary><div class="body"><p class="sub">Edit combinations such as areas, labels, or device classes here. These are the same rules used by the choices above.</p><button type="button" class="button" data-action="add-rule"${this.configBusy ? " disabled" : ""}>Add advanced rule</button><fieldset class="config-editor"${this.configBusy ? " disabled" : ""}>${rules || '<p>No rules. Nothing is selected for passive monitoring.</p>'}</fieldset></div></details>`;
    const actions = `<section class="panel config-review"><div><strong>${JSON.stringify(this.configDraft) === JSON.stringify(this.configuration.rules) ? "No unsaved monitoring choices" : "Unsaved monitoring choices"}</strong><p class="small">${preview ? "Review the preview below, then save your choices." : "Review the effective result before saving. Matching exclusions take precedence."}</p></div><div><div class="config-actions"><button type="button" class="button" data-action="preview-configuration"${this.configBusy ? " disabled" : ""}>Review changes</button><button type="button" class="button primary" data-action="save-configuration"${!preview || this.configBusy ? " disabled" : ""}>Save choices</button><button type="button" class="link" data-action="load-configuration"${this.configBusy ? " disabled" : ""}>Discard edits and reload</button></div>${this.configError ? `<p class="config-error" role="alert">${esc(this.configError)}</p>` : ""}</div></section>`;
    return `${intro}${sections}${monitoringIntro}${actions}${result}${browser}<section class="panel">${advanced}</section>`;
  }

  expandConfigurationMatches(query) {
    this.configExpanded = new Set();
    this.configPages = new Map();
    if (!query.trim()) return;
    const index = monitoringIndex(monitoringNavigation(this.current.data,query));
    for (const node of index.values()) {
      if (node.children.length && node.type !== "device" && !node.children.every((child) => child.type === "entity")) this.configExpanded.add(node.key);
    }
    const exact = [...index.values()].find((node) => node.source?.entity_id === query || node.source?.name === query);
    this.configSelection = exact?.key ?? index.keys().next().value;
    if (exact) revealMonitoringPath(monitoringNavigation(this.current.data,query),exact.key,this.configExpanded,this.configPages);
  }

  selectConfiguration(key) {
    this.configSelection = key;
    let tree = monitoringNavigation(this.current.data,this.configQuery);
    if (!monitoringIndex(tree).has(key)) {
      this.configQuery = "";
      tree = monitoringNavigation(this.current.data);
    }
    revealMonitoringPath(tree,key,this.configExpanded,this.configPages);
    this.render();
    this.shadowRoot.querySelector("#config-detail-title")?.focus({preventScroll:true});
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
    const pending = this.shadowRoot.querySelector(".config-review strong");
    if (pending) pending.textContent = "Unsaved monitoring choices";
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

  issueRow(data, episode) {
    const nodes = sourceMap(data);
    const source = nodes.get(episode.anchor);
    const situation = source?.kind === "situation";
    const affected = affectedFunctions(data, episode);
    const problem = deviceProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
      integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor]) ??
      entityProblem(source, data.inventory.entity_status?.[episode.anchor], nodes.get(`entry:${source?.owner_id}`), data.areas, (key) => this._hass.localize?.(key));
    const tone = situation ? "situation" : problem?.tone ?? "uncertain";
    const labels = {failure:"Reported problem",retrying:"Connection retrying",uncertain:"Availability to review",
      neutral:"Configuration review",recovering:"Confirming recovery",situation:"Active situation"};
    const context = problem?.context ?? problem?.integration ?? (situation ? "Situation" : "Home Assistant");
    const impact = affected.map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`).join("; ");
    return `<article class="issue-row ${esc(tone)}" data-ui-key="issue:${esc(episode.episode_id)}"><div class="issue-copy"><p class="small">${esc(labels[tone] ?? "Current issue")} · ${esc(context)}${["high","critical"].includes(episode.importance) ? ` · ${esc(episode.importance === "critical" ? "Critical" : "Important")}` : ""}</p><h3>${esc(this.displaySourceName(source))}</h3><p>${esc(problem?.headline ?? "Current condition needs review")}</p>${impact ? `<p class="impact-line">Function status: ${esc(impact)}</p>` : ""}<p class="small">Recorded ${esc(date(episode.opened_at))}</p></div><button type="button" class="button" data-episode="${esc(episode.episode_id)}">View details</button></article>`;
  }

  issuesPanel(data, episodes, recent = false) {
    const total = data.inventory.episodes.length;
    const title = recent ? "Recent issues" : "Open issues";
    const rows = episodes.map((episode) => this.issueRow(data, episode)).join("");
    const empty = '<div class="body"><p>No open issues reported. Review Monitoring for what these checks can establish.</p></div>';
    return `<section class="panel issues-panel"><div class="panel-head"><div><h2>${title}</h2>${recent ? '<p class="small">The three most recently recorded open issues</p>' : '<p class="small">Ordered by importance, then longest open</p>'}</div><span class="small">${total} open</span></div>${rows || empty}${recent && total ? '<div class="body issues-footer"><button type="button" class="link" data-page="problems">View all issues →</button></div>' : ""}</section>`;
  }

  issuesPage(data) {
    return `<div class="intro"><div><h1>Issues</h1><p class="sub">Current problems, situations, and conditions needing review.</p></div><span class="small">Updated ${esc(date(data.updated_at))}</span></div>${this.issuesPanel(data, sortedEpisodes(data))}`;
  }

  functionsPanel(data, selected = data.functions, heading = "Home functions") {
    const nodes = sourceMap(data);
    return `<section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2><span class="small">${selected.length} defined</span></div>${selected.length ? selected.map((item) => {
      const causes = item.readiness.nodes.map((node) => nodes.get(node.node_id)?.name ?? node.node_id);
      return `<button type="button" class="row" data-node="${esc(item.node_id)}">${icon("check-network-outline")}<span class="row-main">${esc(item.name)}<small>${esc(causes.join(", ") || "Declared requirements pass their current checks")}</small></span>${status(item.readiness.answer)}</button>`;
    }).join("") : '<div class="body"><p class="sub">Define the important jobs your house should perform and the sources they require.</p><button type="button" class="link" data-settings-section="functions">Review functions in Settings →</button></div>'}</section>`;
  }

  overview(data) {
    const total = data.inventory.episodes.length;
    const notReady = data.functions.filter((item) => item.readiness.answer !== "ready").length;
    const evidence = Math.max(0, data.evidence_gaps - Number(Boolean(data.coverage.notification_consumer_missing)));
    const notification = !data.policy.notifications_enabled ? "Off"
      : data.coverage.notification_consumer_missing ? "Consumer missing" : "Requests on";
    const activeControls = (data.inventory.operator_controls ?? []).length;
    const recentlyResolved = data.inventory.resolved_history?.episodes?.length ?? 0;
    const functionValue = data.functions.length ? String(notReady) : "Not configured";
    const functionNote = data.functions.length ? `${data.functions.length} defined` : "No home functions defined";
    return `<div class="intro"><div><h1>Overview</h1><p class="sub">A current view of your house and its monitoring.</p></div><span class="small">Updated ${esc(date(data.updated_at))}</span></div><div class="overview-stats"><button type="button" class="overview-stat" data-page="problems"><span>Open issues</span><strong>${total}</strong><small>Problems and active situations</small></button><button type="button" class="overview-stat" data-page="functions"><span>Functions not confirmed ready</span><strong>${esc(functionValue)}</strong><small>${esc(functionNote)}</small></button><button type="button" class="overview-stat" data-page="coverage"><span>Evidence to review</span><strong>${evidence}</strong><small>${data.inventory.catalog.watched} sources selected for HA checks</small></button><button type="button" class="overview-stat" data-settings-section="alerts"><span>Notification requests</span><strong>${esc(notification)}</strong><small>Review alert settings</small></button></div>${this.issuesPanel(data, recentEpisodes(data), true)}${activeControls ? controlsPanel(data) : ""}${recentlyResolved ? `<p class="home-history-link"><button type="button" class="link" data-page="history">${recentlyResolved} recently resolved · View history →</button></p>` : ""}`;
  }

  history(data) {
    return `<div class="intro"><div><h1>History</h1><p class="sub">Ended problems and what happened to them.</p></div></div>${this.tools.historyPanel(data)}`;
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
    return `<div class="coverage-source${item.reasons.length && !source.disabled ? " has-gap" : ""}${source.disabled ? " is-disabled" : ""}" data-ui-key="source:${esc(source.node_id)}"><div>${name}<span class="small">${esc(check)}</span>${areas}</div><div class="coverage-evidence">${evidence}<span class="small">${esc(limit)}</span>${native}${item.reasons.length || !source.watched ? change : ""}</div>${rules.length ? `<details class="rule-details"><summary>Technical details</summary><span class="mono">${list(rules)}</span></details>` : ""}</div>`;
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
    const heading = this.coverageLocation ? `${this.coverageLocation} sources · ${view.resultCount}${bounded}`
      : this.coverageSelection ? `Selected sources · ${view.resultCount}${bounded}`
      : searching ? `Search results · ${view.resultCount}${bounded}` : "Watched sources and requirements";
    const groups = view.groups.length
      ? view.groups.map((group) => this.coverageGroup(group,searching)).join("")
      : `<div class="body"><p class="sub">${searching ? "No source matches this search." : "No capabilities are currently registered."}</p></div>`;
    const deviceGaps = devices.matches.map((device) => `<div class="coverage-source has-gap"><div><a class="coverage-name" href="/config/devices/device/${esc(device.id)}">${esc(device.name)}</a><span class="small">HA device registry</span></div><div class="coverage-evidence"><strong class="coverage-state">No eligible availability entity</strong><span class="coverage-guidance">Check this device in Home Assistant. An enabled operational or diagnostic entity is needed before Homeostatic can assess availability.</span></div></div>`).join("");
    const deviceGapPanel = !this.coverageSelection && devices.withoutEvidence ? `<section class="panel"><div class="panel-head"><h2>Devices without availability evidence</h2><span class="small">${devices.withoutEvidence} registry records</span></div><div class="body"><p>${devices.available} of ${devices.total} enabled HA device records have an eligible availability summary; ${devices.watched} are selected. ${devices.disabled} disabled records are excluded. Records below have no check and do not become fault problems. ${this.coverageQuery ? `${devices.resultCount} match this search.` : ""}</p></div>${deviceGaps ? `<div class="coverage-attention">${deviceGaps}</div>` : ""}${devices.resultCount > devices.matches.length ? `<div class="body"><p class="small">Showing first ${devices.matches.length}; search by device name to narrow the list.</p></div>` : ""}</section>` : "";
    const lead = this.coverageLocation
      ? `<strong>Sources assigned to ${esc(this.coverageLocation)}.</strong> Location is for browsing; it does not establish a health dependency. Use Back above to return to this location in Explore.`
      : `<strong>${view.summary.watched} sources selected for HA checks.</strong> These checks report integration state or entity availability; they do not establish physical-device freshness or successful commands.`;
    return `<div class="intro"><div><h1>Monitoring</h1><p class="sub">What Homeostatic checks, where the evidence has limits, and what you can change.</p></div><button type="button" class="button" data-settings-section="monitoring">Change monitoring</button></div><p class="monitoring-lead">${lead}</p>${attention}<label class="coverage-search"><span>Find an integration, device, or source</span><input type="search" data-coverage-search value="${esc(this.coverageQuery)}" placeholder="Search all discovered sources"></label><section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2>${searching ? `<button type="button" class="link" data-action="clear-coverage-search">${esc(this.coverageSelection ? "Show all monitoring" : "Clear search")}</button>` : ""}</div><div class="coverage-groups">${groups}</div></section>${deviceGapPanel}${!searching ? `<section class="panel monitoring-discovery"><div class="panel-head"><h2>Other discovered sources</h2></div><div class="body"><p>${view.summary.excluded} excluded · ${view.summary.unselected} not selected. These are available through search; an unselected source is not a problem by itself.</p></div></section>` : ""}`;
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
    this.locationName = selected.name;
    try { window.sessionStorage.setItem(EXPLORE_LOCATION_KEY,selected.id); } catch { /* Session storage can be unavailable. */ }
    const related = selected.functions;
    const registered = sourceMap(data);
    const coverage = new Map(coverageInventory(data,"",50,new Set(selected.sources.map((source) => source.node_id))).groups.flatMap((group) =>
      group.devices.flatMap((device) => device.sources.map((item) => [item.source.node_id, item]))));
    const sourceRows = selected.sources;
    const {episodes,evidenceGaps:gaps,requiredUnselected,watched,excluded,unselected} =
      locationAssessment(data,selected);
    const count = (value, label) => `${value} ${label}${value === 1 ? "" : "s"}`;
    const findings = [episodes.length ? count(episodes.length,"linked open problem") : null,
      gaps.length ? count(gaps.length,"monitoring evidence gap") : null,
      related.length ? count(related.length,"defined home function") : null].filter(Boolean);
    const noAssessment = !watched && !related.length;
    const summary = `<div class="house-summary">${findings.length ? `<div><strong>${findings.map(esc).join(" · ")}</strong></div>` : ""}`
      + `<p>${esc(noAssessment ? `Homeostatic has no monitoring or defined home functions for ${selected.name} yet.`
        : `${count(watched,"monitored source")}${watched && !episodes.length && !gaps.length && !requiredUnselected.length ? " · No linked problems or evidence gaps reported by current monitoring." : ""}`)}</p>`
      + `${!related.length && !noAssessment ? `<p>No defined home functions use sources in ${esc(selected.name)}.</p>` : ""}`
      + `${unselected ? `<p class="small">${esc(count(unselected,"item"))} listed below ${unselected === 1 ? "is" : "are"} not selected for monitoring. This does not mean ${unselected === 1 ? "it is" : "they are"} broken or need individual checks.</p>` : ""}`
      + `${excluded ? `<p class="small">${esc(count(excluded,"excluded source"))}.</p>` : ""}`
      + `<div class="house-summary-actions">${watched || gaps.length || requiredUnselected.length ? '<button type="button" class="link" data-location-coverage>Review this location in Monitoring →</button>' : ""}${requiredUnselected.length ? '<button type="button" class="link" data-settings-section="monitoring">Review monitoring choices in Settings →</button>' : ""}</div></div>`;
    const functions = related.length ? `${this.functionsPanel(data,related,`Home functions involving ${selected.name}`)}<p class="small house-functions-note">These functions use a device or entity assigned to this location; the work may happen elsewhere.</p>` : "";
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
    const devices = selected.devices.length
      ? `<div class="house-section"><h3>Home Assistant devices</h3>${selected.devices.map((device) => `<details class="house-group" data-ui-key="device:${esc(device.id)}"${selected.devices.length === 1 ? " open" : ""}><summary>${esc(device.name)} <span class="small">${device.sources.length} source${device.sources.length === 1 ? "" : "s"}</span></summary>${device.sources.map((source) => this.houseSource(registered,source,coverage.get(source.node_id))).join("")}</details>`).join("")}</div>`
      : "";
    const signals = selected.signals.length
      ? `<details class="house-group house-signals"><summary>Entities without a Home Assistant device <span class="small">${selected.signals.length} entit${selected.signals.length === 1 ? "y" : "ies"}</span></summary><p class="sub">Home Assistant associates these entities with the location but not with a device.</p>${selected.signals.map((source) => this.houseSource(registered,source,coverage.get(source.node_id))).join("")}</details>`
      : "";
    const inventory = `<section class="panel"><details class="house-inventory"><summary>Discovered Home Assistant entities <span class="small">${esc(count(sourceRows.length,"entity"))}</span></summary><p class="sub">Device and location associations organize this list. They do not establish physical hardware or health dependencies.</p>${devices}${signals || (!devices ? '<p class="sub">No entities are associated with this location.</p>' : "")}</details></section>`;
    return `<div class="intro"><div><h1>Explore</h1><p class="sub">Choose a location to see its defined functions, monitoring, and problems.</p></div></div><div class="house" style="--house-rail-width:${this.railWidth}px"><section class="panel locations" aria-label="Locations"><div class="location-tree" role="tree">${tree.map((location) => locationBranch(location, selected.id, this.collapsedLocations)).join("")}</div></section><div class="rail-resizer" role="separator" tabindex="0" aria-label="Resize locations panel" aria-orientation="vertical" aria-valuemin="${RAIL_MIN}" aria-valuemax="${RAIL_MAX}" aria-valuenow="${this.railWidth}" aria-valuetext="${this.railWidth} pixels" title="Drag or use arrow keys to resize locations"></div><div class="stack"><section class="panel"><div class="panel-head"><div><p class="small">${esc(selected.parent_name)}</p><h2>${esc(selected.name)}</h2></div><span class="small">${esc(selected.kind === "area" ? "Area" : selected.kind === "floor" ? "Floor" : "Location group")}</span></div>${summary}</section>${functions}${problems}${evidence}${inventory}</div></div>`;
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

  rememberExploreState() {
    if (this.page === "house" && this.renderedCurrent) {
      this.exploreState = {location:this.location,state:this.capturePageState()};
    }
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
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.configToggle !== undefined) {
      const key = button.dataset.configToggle;
      if (this.configExpanded.has(key)) this.configExpanded.delete(key);
      else this.configExpanded.add(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-config-toggle]")].find((item) => item.dataset.configToggle === key)?.focus();
      return;
    }
    if (button.dataset.configSelect !== undefined) {this.selectConfiguration(button.dataset.configSelect); return;}
    if (button.dataset.configPage !== undefined) {
      const key = button.dataset.configPage;
      this.configPages.set(key,Number(button.dataset.pageNumber));
      this.render();
      const controls = [...this.shadowRoot.querySelectorAll("[data-config-page]")].filter((item) => item.dataset.configPage === key);
      (controls.find((item) => !item.disabled) ?? controls[0])?.focus();
      return;
    }
    if (button.dataset.action === "collapse-config") {this.configExpanded.clear(); this.render(); this.shadowRoot.querySelector('[data-action="collapse-config"]')?.focus(); return;}
    if (button.dataset.action === "clear-config-search") {this.configQuery = ""; this.expandConfigurationMatches(""); this.render(); this.shadowRoot.querySelector("[data-config-search]")?.focus(); return;}
    if (button.dataset.coverageToggle) {
      this.coverageDisclosure.set(button.dataset.coverageToggle,button.getAttribute("aria-expanded") !== "true");
      this.render();
    }
    else if (button.dataset.coverageSource) {
      this.rememberExploreState();
      this.coverageSelection = new Set([button.dataset.coverageSource]);
      this.coverageLocation = null;
      this.coverageQuery = "";
      this.page = "coverage";
      this.render();
    }
    else if (button.hasAttribute("data-location-coverage")) {
      this.rememberExploreState();
      const selected = locationList(locationTree(this.current.data)).find((location) => location.id === this.location);
      this.coverageSelection = new Set(selected?.sources.map((source) => source.node_id) ?? []);
      this.coverageLocation = selected?.name ?? null;
      this.coverageQuery = "";
      this.page = "coverage";
      this.render();
    }
    else if (button.dataset.page) {
      this.rememberExploreState();
      if (button.closest(".nav") && button.dataset.page === "coverage") {
        this.coverageSelection = null;
        this.coverageLocation = null;
        this.coverageQuery = "";
      }
      this.page = button.dataset.page;
      this.render();
      if (this.page === "configuration" && this.settingsSection === "monitoring" && !this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.settingsSection) {
      this.rememberExploreState();
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
    else if (button.dataset.action === "clear-coverage-search") {this.coverageQuery = ""; this.coverageSelection = null; this.coverageLocation = null; this.render();}
  }

  keydown(event) {
    if (event.target.matches?.("[data-config-toggle]") && ["ArrowLeft","ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const key = event.target.dataset.configToggle;
      if (event.key === "ArrowRight") this.configExpanded.add(key);
      else this.configExpanded.delete(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-config-toggle]")].find((item) => item.dataset.configToggle === key)?.focus();
      return;
    }
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
      const diagnostic = episode ? null : diagnosticOverview(source, result, currentFunctions);
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
      body.innerHTML = `<section class="detail problem-brief">${problem ? `${source.kind === "integration" ? "" : `<p class="small">${esc(problem.context ?? problem.integration)}</p>`}<h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}
         <div class="next-action"><p>${esc(problem?.nextStep ?? (nativeLink ? "Check the current state in Home Assistant." : "Check the listed requirements to find what needs attention."))}</p>${nativeLink || problem?.deviceUrl ? `<div class="actions">${nativeLink}${problem?.deviceUrl ? `<a class="button" href="${esc(problem.deviceUrl)}">Open device page</a>` : ""}</div>` : ""}</div>
         ${episode ? `<p class="small problem-progress">Open since ${esc(date(episode.opened_at))}</p>` : ""}</section>
         ${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}
         ${problem?.connectionNote ? `<section class="detail"><p>${esc(problem.connectionNote)}</p><button class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button></section>` : ""}
         ${availabilityChoices}
         ${diagnostic ? `<section class="detail evidence-overview" aria-label="Evidence summary"><h3>What Homeostatic knows</h3><dl><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd><dt>What is checked</dt><dd>${esc(diagnostic.checks)}</dd><dt>Current assessment</dt><dd>${esc(diagnostic.assessment)}</dd><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></dl></section>` : ""}
         ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Working on equipment"} until ${esc(date(control.until))}.</p>`).join("")}
        ${this.tools.detailButtons(source, episode, data)}
        <details ${disclosure("technical")}><summary>Technical details</summary>
          ${problem?.reported ? `<div class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">From an earlier attempt; the current activity is shown above.</p>' : ""}<pre>${esc(problem.reported)}</pre></div>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : ""}
          ${problem?.logsUrl ? `<p><a class="button" href="${esc(problem.logsUrl)}">View integration logs</a></p>` : ""}
          ${dependencies.length || unwatched.length ? `<h3>Reported requirements</h3><ul>${dependencies.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · ${esc(node.own)} · ${list(node.reasons)}</li>`).join("")}${unwatched.map((node) => `<li>${esc(nodes.get(node.node_id)?.name ?? node.node_id)} · Not monitored</li>`).join("")}</ul>` : ""}
          ${source.kind === "function" ? `<h3>Requirements</h3><ul>${source.requirements.map((id) => `<li><button class="link" type="button" data-node="${esc(id)}">${esc(nodes.get(id)?.name ?? id)}</button></li>`).join("")}</ul>` : ""}
          <button type="button" class="button" data-copy-diagnostics>Copy diagnostic data</button><p class="small">Diagnostic data contain internal identifiers. Review before sharing.</p><p class="small" data-copy-feedback role="status"></p>
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
