import {monitoringPolicies} from "./monitoring-policies.mjs?v=43";
import {sourceSettingsAction} from "./source-settings.mjs?v=43";
import {reportingOverview, reportingStatus} from "./reporting.mjs?v=43";
import {affectedFunctions, coverageInventory, dashboardStore, deviceRegistryCoverage, escapeHtml as esc,
  inventoryRows, locationAssessment, locationList, locationTree, monitoringLabel, recentEpisodes, sortedEpisodes,
  sourceMap} from "./model\.mjs?v=43";
import {deviceProblem, entityProblem, integrationProblem} from "./problem\.mjs?v=43";
import {DashboardTools, controlsPanel} from "./history-controls\.mjs?v=43";
import {diagnosticOverview} from "./evidence\.mjs?v=43";
import {editCatalogRule, monitoringScope,
  newCatalogRule, scopeChoice, setScopeChoice} from "./configuration\.mjs?v=43";
import {styles} from "./styles\.mjs?v=43";
import {locationBranch, setBranchExpanded} from "./tree\.mjs?v=43";

import {configurationBrowser, monitoringNavigation, monitoringIndex, revealMonitoringPath} from "./monitoring-browser\.mjs?v=43";
import {sourcesBrowser, sourcesTree, sourcePaths, topomationTree} from "./sources-workspace\.mjs?v=43";

import {installationSettings, editInstallation} from "./installation-settings\.mjs?v=43";

import {applyNotificationRoute} from "./notification-navigation.mjs?v=43";

const VIEWS = ["overview", "sources", "house", "coverage", "functions", "problems", "history", "notifications", "configuration"];
const homeostaticOptionsUrl = (entryId) => `/config/integrations/integration/homeostatic#config_entry=${encodeURIComponent(entryId)}`;
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
const SOURCES_GROUPING_KEY = "homeostatic-sources-grouping";
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

function savedSourcesGrouping() {
  try { const saved=window.sessionStorage.getItem(SOURCES_GROUPING_KEY); return ["integration","location","topomation"].includes(saved) ? saved : "integration"; }
  catch { return "integration"; }
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
    this.configSelection = null;
    this.sourcesGrouping = savedSourcesGrouping();
    this.topomation = null;
    this.topomationLoaded = false;
    this.topomationSequence = 0;
    this.sourcesSelection = null;
    this.sourcesExpanded = new Set();
    this.sourcesQuery = "";
    this.sourcesNeedsReview = false;
    this.sourcesEdit = false;
    this.sourcesView = "source";
    this.sourcesSettingsPanel = "";
    this.sourceSettingsReview = null;
    this.sourceSettingsError = null;
    this.sourceSettingsNotice = null;
    this.settingsSection = "timing";
    this.settingsDraft = null;
    this.settingsPreview = null;
    this.settingsBusy = false;
    this.settingsError = null;
    this.settingsNotice = null;
    this.sourcesLimits = new Map();
    this.sourcesMobileDetail = false;
    this.sourceDetail = null;
    this.sourceSequence = 0;
    this.issueSort = "oldest";
    this.configAdvancedOpen = false;
    this.configScopes = [];
    this.alertDraft = null;
    this.alertPreview = null;
    this.alertBusy = false;
    this.alertError = null;
    this.coverageDisclosure = new Map();
    this.renderedView = null;
    this.renderedCurrent = false;
    this.savedPageState = null;
    this.exploreState = null;
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="brand">${icon("home-heart")}Homeostatic</div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="overview">Overview</button><button type="button" data-page="problems">Issues</button><button type="button" data-page="sources">Sources</button><button type="button" data-page="history">History</button><button type="button" data-page="notifications">Notifications</button><button type="button" data-page="configuration">Settings</button></nav><button type="button" class="button" data-action="back" hidden>Back</button></header><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
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
      if (event.target.matches("[data-sources-search]")) {
        this.sourcesQuery = event.target.value;
        const position = event.target.selectionStart;
        this.revealSourcesSearch();
        this.render();
        const search = this.shadowRoot.querySelector("[data-sources-search]");
        search?.focus();
        search?.setSelectionRange(position,position);
        return;
      }
      if (event.target.matches("[data-coverage-search]")) {
        this.coverageQuery = event.target.value;
        this.render();
      }
    });
    this.shadowRoot.addEventListener("change", (event) => {
      if (editInstallation(this,event)) return;
      if (event.target.matches?.("[data-issue-sort]")) {this.issueSort=event.target.value;this.render();return;}
      if (this.editAlert(event)) return;
      if (event.target.matches?.("[data-sources-group]")) {
        this.sourcesGrouping = event.target.value;
        if (this.sourcesGrouping === "topomation" && !this.topomation) this.loadTopomation();
        try { window.sessionStorage.setItem(SOURCES_GROUPING_KEY,this.sourcesGrouping); } catch { /* Embedded storage may be unavailable. */ }
        this.revealSourcesSelection();
        this.render();
        return;
      }
      if (event.target.matches?.("[data-sources-review]")) {
        this.sourcesNeedsReview = event.target.checked;
        this.render();
        return;
      }
      if (!this.editScope(event)) this.editRule(event);
    });
    this.shadowRoot.addEventListener("pointerdown", (event) => this.startRailResize(event));
    this.shadowRoot.addEventListener("pointermove", (event) => this.moveRailResize(event));
    this.shadowRoot.addEventListener("pointerup", (event) => this.endRailResize(event));
    this.shadowRoot.addEventListener("pointercancel", (event) => this.endRailResize(event));
    this.tools = new DashboardTools(this);
    this.dialog.addEventListener("close", () => {if (!this.dialog.open) {this.detail = null; this.detailSequence++;}});
  }

  static getStubConfig() { return {view: "overview"}; }
  getCardSize() { return this.config.view === "functions" ? 4 : 8; }

  setConfig(config) {
    if (config.view !== undefined && !VIEWS.includes(config.view)) {
      throw new Error("Homeostatic view must be overview, sources, history, notifications, configuration, functions, problems, house, or coverage.");
    }
    this.config = {...config, view: config.view ?? "overview"};
    this.page = ["house","coverage"].includes(this.config.view) ? "sources" : this.config.view;
    if (this.config.view === "house") {
      this.sourcesGrouping = "location";
      if (this.location) this.sourcesSelection = `location:${this.location}`;
    }
    if (this.config.view === "coverage") this.sourcesNeedsReview = true;
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
    this.topomationSequence++;
    this.topomation = null;
    this.topomationLoaded = false;
    this.tools.disconnect();
    this.sourceObserver?.disconnect();
    this.sourceSequence++;
    this.sourceDetail = null;
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
    this.loadTopomation();
    this.removeListener = this.store.listen((value) => {
      const catalogArrived = value.data?.catalog_loaded && !this.current.data?.catalog_loaded;
      this.current = value;
      if (catalogArrived) {
        this.revealSourcesSelection();
        if (this.sourcesQuery) this.revealSourcesSearch();
      }
      if(value.status==="current"&&value.data.catalog_loaded!==false&&this.topomationLoaded&&this.sourcesGrouping==="topomation"&&!topomationTree(value.data,this.topomation)) {
        this.sourcesGrouping="location";
        try { window.sessionStorage.setItem(SOURCES_GROUPING_KEY,this.sourcesGrouping); } catch { /* Embedded storage may be unavailable. */ }
        this.revealSourcesSelection();
      }
      this.tools.update(value);
      this.render();
      if ((["configuration","notifications"].includes(this.page) || this.page === "sources" && this.sourcesView === "settings") && value.status === "current" && !this.configuration && !this.configBusy) this.loadConfiguration();
      if (this.pendingEpisode && value.status === "current") {
        const episodeId = this.pendingEpisode;
        this.pendingEpisode = null;
        this.openDetail({episodeId});
      } else if (this.detail) this.loadDetail();
    });
  }

  async loadTopomation() {
    const sequence=++this.topomationSequence;
    try {
      const result=await this._hass.callWS({type:"topomation/locations/list"});
      if(sequence!==this.topomationSequence||!this.isConnected)return;
      this.topomation=Array.isArray(result?.locations)&&result.locations.length?result:null;
    } catch {
      if(sequence!==this.topomationSequence||!this.isConnected)return;
      this.topomation=null;
    }
    this.topomationLoaded=true;
    if(this.current.status==="current"&&this.current.data.catalog_loaded!==false&&this.sourcesGrouping==="topomation"&&!topomationTree(this.current.data,this.topomation)) {
      this.sourcesGrouping="location";
      try { window.sessionStorage.setItem(SOURCES_GROUPING_KEY,this.sourcesGrouping); } catch { /* Embedded storage may be unavailable. */ }
    }
    this.revealSourcesSelection();
    this.render();
  }

  viewIdentity() {
    return `${this.page}:${this.page === "configuration" ? this.settingsSection : ""}`;
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
    const innerScroll = [".config-rail",".config-detail",".locations"].map((selector) => {
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
        node.scrollTop = selector === ".config-detail" && this.resetSourceScroll ? 0 : top;
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
    const view = this.viewIdentity();
    if (view !== this.renderedView) this.savedPageState = this.page === "house" && this.exploreState?.location === this.location ? this.exploreState.state : null;
    else if (this.renderedCurrent) this.savedPageState = this.capturePageState();
    const minimal = ["functions", "problems"].includes(this.config.view);
    this.shadowRoot.querySelector(".nav").hidden = minimal || this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = this.config.view === "house" && this.locationName
      ? `← Back to ${this.locationName} in Explore`
      : `← Back to ${{overview:"Overview",house:"Sources",coverage:"Sources",sources:"Sources",functions:"Functions",problems:"Issues",history:"History",notifications:"Notifications",configuration:"Settings"}[this.config.view]}`;
    this.shadowRoot.querySelectorAll("[data-page]").forEach((button) => {
      if (button.closest(".nav")) {
        if (button.dataset.page === this.page) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });
    if (this.current.status !== "current") {
      const messages = {
        loading: ["Loading dashboard", "Receiving the latest monitoring result from Home Assistant."],
        disconnected: ["Connection lost", "Current health is unknown. Reconnecting to Home Assistant."],
        unavailable: ["Monitoring unavailable", this.current.data?.error ? "Homeostatic reported an error. Check its configuration, storage and logs." : "Homeostatic is starting or has been unloaded."],
        error: ["Dashboard unavailable", this.current.error],
      };
      const [title, message] = messages[this.current.status];
      const completed = this.current.data?.updated_at;
      this.main.innerHTML = `<div class="banner" role="status"><h2>${esc(title)}</h2><p>${esc(message)}</p>${completed ? `<p class="small">Last completed update: ${esc(date(completed))}</p>` : ""}${this.store && this.current.status === "error" ? '<button class="link" type="button" data-action="retry">Retry connection</button>' : ""}</div>`;
      this.renderedCurrent = false;
      return;
    }
    const data = this.current.data;
    if (["sources","coverage","house","configuration","functions"].includes(this.page) && data.schema_version === 3 && !data.catalog_loaded) {
      this.main.innerHTML = `<div class="banner" role="status"><h2>${this.current.catalogError ? "Sources unavailable" : "Loading sources"}</h2><p>${esc(this.current.catalogError || "Loading the complete source catalog for browsing and search.")}</p>${this.current.catalogError ? '<button class="link" type="button" data-action="retry-catalog">Retry loading sources</button>' : ""}</div>`;
      this.renderedCurrent = false;
      this.store?.ensureCatalog();
      return;
    }
    if (["configuration","notifications"].includes(this.page)) this.main.innerHTML = installationSettings(this);
    else if (this.page === "sources") this.main.innerHTML = this.sourcesPage();
    else if (this.page === "history") this.main.innerHTML = this.history(data);
    else if (this.page === "functions") this.main.innerHTML = this.functionsPanel(data);
    else if (this.page === "problems") this.main.innerHTML = this.issuesPage(data);
    else if (this.page === "coverage") this.main.innerHTML = this.coverage(data);
    else if (this.page === "house") this.main.innerHTML = this.house(data);
    else this.main.innerHTML = this.overview(data);
    if (this.savedPageState) this.restorePageState(this.savedPageState);
    const configDetail = this.main.querySelector(".config-detail");
    if (configDetail) {
      configDetail.dataset.selection = this.page === "sources" ? this.sourcesSelection ?? "" : this.configSelection ?? "";
    }
    this.renderedView = this.viewIdentity();
    this.renderedCurrent = true;
    this.resetSourceScroll = false;
    this.observeSourceBranches();
    if (this.page === "sources") queueMicrotask(()=>this.loadSource());
  }

  configurationChoice(label, scope, current, detail = "") {
    if (!scope) return `<span class="small">${esc(label)} · no stable identity available</span>`;
    const index = this.configScopes.push(scope) - 1;
    const choice = scopeChoice(this.configDraft,scope);
    const option = (value, name) => `<option value="${value}"${choice === value ? " selected" : ""}>${name}</option>`;
    const devices = scope.kind === "integration_devices";
    const choices = choice === "multiple"
      ? '<option selected>Multiple direct policies; review in Settings</option>'
      : `${option("inherit","Follow broader choice")}${option("attach",devices ? "Watch these devices" : "Watch")}${option("exclude",devices ? "Leave these devices unmonitored" : "Do not monitor")}`;
    const original = scopeChoice(this.configuration.rules,scope);
    const pending = original !== choice ? " · Unsaved choice" : "";
    return `<label class="config-choice"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ""}<small>Currently: ${esc(current)}${pending}</small></span><select data-scope-index="${index}" aria-label="${esc(label)} monitoring choice"${this.configBusy || choice === "multiple" ? " disabled" : ""}>${choices}</select></label>`;
  }

  monitoringEditor(global = false) {
    const data = this.current.data;
    const intro = '<div class="intro"><div><h1>Settings</h1><p class="sub">Choose what Homeostatic watches and how it responds.</p></div></div>';
    if (!this.configuration) return `${intro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring rules…")}</p><button type="button" class="button" data-action="load-configuration">Reload configuration</button></div></section>`;
    if (this.main.querySelector(".config-advanced")) {
      this.configAdvancedOpen = this.main.querySelector(".config-advanced")?.open ?? false;
    }
    const preview = this.configPreview;
    const changes = (items, count, label) => count ? `<div><strong>${count} ${label}</strong><ul>${items.map((item) => `<li>${esc(item.name)}</li>`).join("")}</ul>${count > items.length ? `<p class="small">Showing the first ${items.length}.</p>` : ""}</div>` : "";
    const selected = !global ? sourcePaths(sourcesTree(data,this.sourcesGrouping,null,this.topomation)).get(this.sourcesSelection)?.node : null;
    const entity = selected?.source?.kind === "entity" ? selected.source : null;
    const entityChoice = entity ? scopeChoice(this.configDraft,monitoringScope("entity",entity.node_id,entity)) : null;
    const subject = entity ? `<p><strong>${esc(selected.name)}</strong><br><small>${esc(entity.entity_id)}</small></p><p>Selected choice: ${entityChoice === "exclude" ? "Exclude this entity" : entityChoice === "attach" ? "Monitor this entity separately" : "Use device and integration choices"}.</p>` : "";
    const noCountChange = !preview?.added_count && !preview?.removed_count ? `<p>No sources are newly watched or stopped by this draft.${entityChoice === "exclude" ? " This exclusion can still change which entities a device availability check uses, or keep this entity out of future device monitoring." : ""}</p>` : "";
    const result = preview ? `<section class="panel config-preview" aria-live="polite"><div class="panel-head"><h2>Review monitoring choices</h2></div><div class="body">${subject}<p><strong>${preview.watched}</strong> watched sources after this change.</p>${noCountChange}<div class="config-change-list">${changes(preview.added,preview.added_count,"newly watched")}${changes(preview.removed,preview.removed_count,"no longer watched")}</div>${preview.functions.length ? `<details><summary>Function readiness from current evidence</summary><ul>${preview.functions.map((item) => `<li>${esc(item.name)}: ${esc(item.readiness.answer)}${item.requirements.some((source) => source.monitoring === "excluded" || source.monitoring === "unwatched") ? " · has an unwatched requirement" : ""}</li>`).join("")}</ul><p class="small">This preview does not replay existing holds or episode history.</p></details>` : ""}<p class="small">This preview uses current Home Assistant evidence. New devices may match these rules later.</p></div></section>` : "";
    const policies = global ? monitoringPolicies(this) : "";
    const changed=JSON.stringify(this.configDraft)!==JSON.stringify(this.configuration.rules);
    const actions = `<section class="config-review">${changed?`<div class="config-actions"><span class="small">Unsaved monitoring choices</span><button type="button" class="button primary" data-action="${preview?'save-configuration':'preview-configuration'}"${this.configBusy?' disabled':''}>${preview?'Save choices':'Review changes'}</button><button type="button" class="link" data-action="discard-monitoring"${this.configBusy?' disabled':''}>Discard</button></div>`:'<p class="small">Changes are reviewed before saving.</p>'}${this.configError?`<p class="config-error" role="alert">${esc(this.configError)}</p>`:''}</section>`;
    return global ? `${policies}${result}${actions}` : `${result}${actions}`;
  }

  sourcesPage() {
    const intro = '<div class="intro"><div><h1>Sources</h1></div></div>';
    this.configScopes = [];
    this.sourcesSettingsPanel = this.sourcesView === "settings"
      ? this.configuration ? this.monitoringEditor()
        : `<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring choices…")}</p><button type="button" class="button" data-action="load-configuration">Reload choices</button></div></section>` : "";
    return intro + sourcesBrowser(this);
  }

  revealSourcesSelection() {
    if (this.current.status !== "current" || this.current.data.catalog_loaded === false) return;
    this.sourcesExpanded ??= new Set();
    this.sourcesGrouping ??= "integration";
    const paths = sourcePaths(sourcesTree(this.current.data,this.sourcesGrouping,null,this.topomation));
    if(this.sourcesSelection?.startsWith("location:")&&!paths.has(this.sourcesSelection)) {
      const areaId=this.sourcesSelection.startsWith("location:area:")?this.sourcesSelection.slice(14):null;
      const topoId=this.sourcesSelection.startsWith("location:topomation:")?this.sourcesSelection.slice(20):null;
      const mapped=areaId&&this.sourcesGrouping==="topomation"?this.topomation?.locations?.find(item=>item.ha_area_id===areaId)?.id:null;
      const nativeArea=topoId&&this.sourcesGrouping==="location"?this.topomation?.locations?.find(item=>item.id===topoId)?.ha_area_id:null;
      const preferred=mapped?`location:topomation:${mapped}`:nativeArea?`location:area:${nativeArea}`:null;
      this.sourcesSelection=preferred&&paths.has(preferred)?preferred:paths.keys().next().value??null;
    }
    const selected = paths.get(this.sourcesSelection);
    if (selected) for (const parent of selected.parents) this.sourcesExpanded.add(parent.key);
  }

  revealSourcesSearch() {
    if (this.current.status !== "current") return;
    const needle = this.sourcesQuery.trim().toLocaleLowerCase();
    if (!needle) return;
    const paths = sourcePaths(sourcesTree(this.current.data,this.sourcesGrouping,key=>this._hass?.localize?.(key),this.topomation));
    for (const {node,parents} of paths.values()) {
      if ([node.name,node.source?.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)) {
        for (const parent of parents) this.sourcesExpanded.add(parent.key);
      }
    }
  }

  alertSettingsPage(data, intro, sections) {
    if (!this.configuration || !this.alertDraft) return `${intro}${sections}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading alert settings…")}</p><button type="button" class="button" data-action="load-configuration">Reload settings</button></div></section>`;
    const saved = this.configuration.alerts;
    const draft = this.alertDraft;
    const policy = saved.policy;
    const consumers = this.configuration.consumers;
    const selected = consumers.some((item) => item.entity_id === draft.consumer);
    const options = [`<option value="">Choose a consumer automation</option>`,
      ...(!selected && draft.consumer ? [`<option value="${esc(draft.consumer)}" selected>${esc(draft.consumer)} (missing)</option>`] : []),
      ...consumers.map((item) => `<option value="${esc(item.entity_id)}"${item.entity_id === draft.consumer ? " selected" : ""}>${esc(item.name)} · ${esc(item.state === "on" ? "enabled" : "not enabled")}</option>`)].join("");
    const consumer = saved.consumer ? `Consumer automation: ${esc(saved.consumer)} (${esc(saved.consumer_state === "on" ? "enabled" : "missing or not enabled")}).` : "No consumer automation selected.";
    const routes = Object.entries(policy.recipients).flatMap(([name,item]) => item.channels.map((channel) => `${name} via ${channel}`));
    const recipients = Object.entries(policy.recipients).map(([name,item]) => `<li><strong>${esc(name)}</strong>: ${esc(item.channels.join(", "))}${item.quiet_hours ? ` · quiet ${esc(item.quiet_hours.start)}–${esc(item.quiet_hours.end)}` : ""}</li>`).join("");
    const digests = Object.entries(policy.digests ?? {}).map(([name,item]) => `<li><strong>${esc(name)}</strong>: ${esc(item.at)} to ${esc(item.to)}</li>`).join("");
    const routingDetails = `<details><summary>Recipients, quiet hours and digests</summary><h3>Recipients and channels</h3><ul>${recipients || "<li>None configured</li>"}</ul><h3>Digests</h3><ul>${digests || "<li>None configured</li>"}</ul></details>`;
    const unchanged = saved.notifications === draft.notifications && saved.consumer === draft.consumer;
    const previewCopy = this.alertPreview?.activating
      ? `Turning requests on: ${this.alertPreview.open_problems} open ${this.alertPreview.open_problems === 1 ? "problem" : "problems"} remain. The current policy would request ${this.alertPreview.requests_now} ${this.alertPreview.requests_now === 1 ? "message" : "messages"} immediately.`
      : this.alertPreview?.notifications
        ? "Requests stay on. Changing the consumer affects future requests; existing problems stay open."
        : "With requests off, Homeostatic will not request new alert messages. Open problems remain visible.";
    const preview = this.alertPreview ? `<section class="panel config-preview" aria-live="polite"><div class="panel-head"><h2>Preview</h2></div><div class="body"><p>${previewCopy}</p>${this.alertPreview.next_deadline ? `<p>Next policy decision: ${esc(date(this.alertPreview.next_deadline))}.</p>` : ""}<p class="small">This preview uses current problems and does not send messages. Future changes may produce different requests.</p></div></section>` : "";
    const link = homeostaticOptionsUrl(data.entry_id);
    return `${intro}${sections}<section class="panel"><div class="panel-head"><h2>Alert requests</h2></div><div class="body"><p><strong>Requests are currently ${saved.notifications ? "on" : "off"}.</strong> Open problems remain visible in Homeostatic. ${consumer}</p><fieldset class="alert-editor"${this.alertBusy ? " disabled" : ""}><label class="alert-toggle"><input type="checkbox" data-alert-field="notifications"${draft.notifications ? " checked" : ""}> Request alerts for open problems</label><label class="alert-consumer"><span>Consumer automation</span><select data-alert-field="consumer">${options}</select></label></fieldset><p class="sub">The selected Home Assistant automation receives Homeostatic requests and handles delivery. Turning requests on can alert you about problems already open.</p><div class="config-actions"><button type="button" class="button" data-action="preview-alerts"${this.alertBusy || unchanged ? " disabled" : ""}>Preview changes</button><button type="button" class="button primary" data-action="save-alerts"${this.alertBusy || !this.alertPreview ? " disabled" : ""}>Save alert settings</button><button type="button" class="link" data-action="load-configuration"${this.alertBusy ? " disabled" : ""}>Discard edits and reload</button></div>${this.alertError ? `<p class="config-error" role="alert">${esc(this.alertError)}</p>` : ""}</div></section>${preview}<section class="panel settings-following"><div class="panel-head"><h2>Current routing policy</h2></div><div class="body"><p>${policy.rules.length} ${policy.rules.length === 1 ? "rule" : "rules"} · ${routes.length} recipient/channel ${routes.length === 1 ? "route" : "routes"} · ${Object.keys(policy.digests ?? {}).length} ${Object.keys(policy.digests ?? {}).length === 1 ? "digest" : "digests"} · Time zone: ${esc(policy.timezone)}</p>${routingDetails}<p class="sub">Homeostatic records requests, not proof that a phone received or displayed a message.</p><p>Detailed routing, functions, situations, and timing are still edited in Home Assistant's Homeostatic options.</p><a class="button" href="${esc(link)}">Open Homeostatic in Home Assistant</a></div></section>`;
  }

  expandConfigurationMatches(query) {
    this.configExpanded = new Set();
    if (!query.trim()) return;
    const index = monitoringIndex(monitoringNavigation(this.current.data,query));
    for (const node of index.values()) {
      if (node.children.length && node.type === "integration") this.configExpanded.add(node.key);
    }
    const exact = [...index.values()].find((node) => node.source?.entity_id === query || node.source?.name === query);
    this.configSelection = exact?.key ?? index.keys().next().value;
    if (exact) revealMonitoringPath(monitoringNavigation(this.current.data,query),exact.key,this.configExpanded);
  }

  selectConfiguration(key) {
    this.configSelection = key;
    let tree = monitoringNavigation(this.current.data,this.configQuery);
    if (!monitoringIndex(tree).has(key)) {
      this.configQuery = "";
      tree = monitoringNavigation(this.current.data);
    }
    revealMonitoringPath(tree,key,this.configExpanded);
    this.render();
    this.shadowRoot.querySelector("#config-detail-title")?.focus({preventScroll:true});
    if (this.getBoundingClientRect().width <= 900) {
      this.shadowRoot.querySelector(".config-detail")?.scrollIntoView({block:"start"});
    }
  }

  async loadConfiguration(reset = "all") {
    if (this.configBusy) return;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      const result = await this._hass.callWS({type:"homeostatic/configuration"});
      const previous = this.configuration;
      const monitoringDirty = previous && JSON.stringify(this.configDraft) !== JSON.stringify(previous.rules);
      const settingsDirty = previous && JSON.stringify(this.settingsDraft) !== JSON.stringify(previous.settings);
      this.configuration = result;
      if (reset !== "settings" || !monitoringDirty) this.configDraft = structuredClone(result.rules);
      if (reset !== "monitoring" || !settingsDirty) this.settingsDraft = structuredClone(result.settings);
      this.settingsPreview = null;
      this.configPreview = null;
      this.sourceSettingsReview = null;
      this.alertDraft = {notifications:result.alerts.notifications,consumer:result.alerts.consumer};
      this.alertPreview = null;
      this.alertError = null;
    } catch (error) {
      this.configError = error?.message ?? "Could not load configuration.";
    } finally {
      this.configBusy = false;
      if (["configuration","notifications","sources"].includes(this.page)) this.render();
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
    const action=this.shadowRoot.querySelector('[data-action="save-configuration"],[data-action="preview-configuration"]');
    if(action){action.dataset.action="preview-configuration";action.textContent="Review changes";}
    if (!action || event.type === "change" || field === "enabled" || field === "action") this.render();
    else for (const control of this.main.querySelectorAll(`[data-rule-index="${index}"][data-rule-field="${field}"]`)) {
      if (control !== event.target) control.value = event.target.value;
    }
    return true;
  }

  editAlert(event) {
    const field = event.target.dataset.alertField;
    if (!field || !this.alertDraft) return false;
    this.alertDraft[field] = field === "notifications" ? event.target.checked : event.target.value || null;
    this.alertPreview = null;
    this.alertError = null;
    this.render();
    return true;
  }

  editScope(event) {
    if (!event.target.matches?.("[data-scope-index]")) return false;
    if (this.configBusy || this.settingsBusy) return true;
    const index = Number(event.target.dataset.scopeIndex);
    const scope = this.configScopes[index];
    const value = event.target.hasAttribute("data-integration-master") ? event.target.checked ? "inherit" : "exclude" : event.target.value;
    if (!scope || !setScopeChoice(this.configDraft,scope,value)) return false;
    this.configPreview = null;
    this.sourceSettingsReview = null;
    this.sourceSettingsNotice = null;
    this.sourceSettingsError = null;
    this.render();
    this.shadowRoot.querySelector(`[data-scope-index="${index}"]${event.target.hasAttribute("data-integration-master")?'':`[value="${value}"]`}`)?.focus({preventScroll:true});
    return true;
  }

  async previewConfiguration() {
    if (this.current.status !== "current" || !this.configuration || this.configBusy) return;
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
    if (this.current.status !== "current" || !this.configPreview || this.configBusy || this.settingsBusy) return;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      await this._hass.callWS({type:"homeostatic/save_configuration",revision:this.configuration.revision,preview_token:this.configPreview.preview_token,rules:this.configDraft});
      this.configBusy = false;
      await this.loadConfiguration("monitoring");
      return;
    } catch (error) {
      this.configError = error?.message ?? "Could not save monitoring rules.";
    } finally {
      this.configBusy = false;
      this.render();
    }
  }

  async previewAlerts() {
    if (!this.configuration || !this.alertDraft || this.alertBusy) return;
    this.alertBusy = true;
    this.alertError = null;
    this.render();
    try {
      this.alertPreview = await this._hass.callWS({
        type:"homeostatic/preview_alerts",revision:this.configuration.revision,...this.alertDraft,
      });
    } catch (error) {
      this.alertPreview = null;
      this.alertError = error?.message ?? "Could not preview alert settings.";
    } finally {
      this.alertBusy = false;
      this.render();
    }
  }

  async saveAlerts() {
    if (!this.alertPreview || this.alertBusy) return;
    this.alertBusy = true;
    this.alertError = null;
    this.render();
    try {
      await this._hass.callWS({
        type:"homeostatic/save_alerts",revision:this.configuration.revision,
        preview_token:this.alertPreview.preview_token,...this.alertDraft,
      });
      this.alertBusy = false;
      await this.loadConfiguration();
    } catch (error) {
      this.alertError = error?.message ?? "Could not save alert settings.";
    } finally {
      this.alertBusy = false;
      this.render();
    }
  }

  async loadSource(force = false) {
    if (this.page !== "sources" || this.sourcesView !== "source" || this.current.status !== "current") return;
    const selected = sourcePaths(sourcesTree(this.current.data,this.sourcesGrouping,null,this.topomation)).get(this.sourcesSelection)?.node;
    const nodeId = selected?.source?.node_id;
    if (!nodeId) return;
    const stamp = this.current.data.updated_at;
    if (!force && this.sourceDetail?.nodeId === nodeId && this.sourceDetail.stamp === stamp) return;
    const sequence = ++this.sourceSequence;
    this.sourceDetail = {nodeId,stamp,loading:true};
    try {
      const result = await this._hass.callWS({type:"homeostatic/source",node_id:nodeId});
      if (sequence !== this.sourceSequence) return;
      this.sourceDetail = {...result,nodeId,stamp};
    } catch (error) {
      if (sequence !== this.sourceSequence) return;
      this.sourceDetail = {nodeId,stamp,error:error?.message || "Could not read this source."};
    }
    if (this.page === "sources") this.render();
  }

  observeSourceBranches() {
    this.sourceObserver?.disconnect();
    if (this.page !== "sources" || typeof IntersectionObserver === "undefined") return;
    const rail = this.main.querySelector(".config-rail");
    const desktop = this.getBoundingClientRect().width > 760;
    this.sourceObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry=>entry.isIntersecting && entry.target.isConnected);
      if (!visible.length) return;
      for (const entry of visible) {
        const key = entry.target.dataset.sourceMore;
        this.sourcesLimits.set(key,(this.sourcesLimits.get(key)||80)+80);
      }
      this.render();
    },{root:desktop?rail:null,rootMargin:"120px"});
    this.main.querySelectorAll("[data-source-more]").forEach(element=>this.sourceObserver.observe(element));
  }

  async previewSettings() {
    if (!this.settingsDraft || this.settingsBusy || this.configBusy || this.current.status !== "current") return;
    if ([...this.main.querySelectorAll(".installation-editor input")].some(input=>!input.reportValidity())) return;
    this.settingsBusy = true;this.settingsError = null;this.render();
    try {
      this.settingsPreview = await this._hass.callWS({type:"homeostatic/preview_settings",revision:this.configuration.revision,settings:this.settingsDraft});
    } catch (error) {this.settingsError=error?.message||"Could not preview settings.";this.settingsPreview=null;}
    finally {this.settingsBusy=false;this.render();this.main.querySelector(".settings-preview")?.scrollIntoView({block:"nearest"});}
  }

  async saveSettings() {
    if (!this.settingsPreview || this.settingsBusy || this.configBusy) return;
    this.settingsBusy=true;this.settingsError=null;this.render();
    try {
      await this._hass.callWS({type:"homeostatic/save_settings",revision:this.configuration.revision,preview_token:this.settingsPreview.preview_token,settings:this.settingsDraft});
      await this.loadConfiguration("settings");
      this.settingsNotice=this.page==="notifications"?"Notifications saved.":"Settings saved.";
    } catch(error) {this.settingsError=error?.message||"Could not save settings.";}
    finally {this.settingsBusy=false;this.render();}
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
    const context = source?.kind === "device" ? null : problem?.context ?? problem?.integration ?? (situation ? "Situation" : "Home Assistant");
    const importance = ["high","critical"].includes(episode.importance) ? episode.importance === "critical" ? "Critical" : "Important" : null;
    const eyebrow = [context,importance].filter(Boolean).join(" · ");
    const onlyMember = source?.kind === "device" && source.availability_entities?.length === 1
      ? [...nodes.values()].find(item => item.entity_id === source.availability_entities[0]) : null;
    const fullMemberName = onlyMember?.name ?? null;
    const sourceName = this.displaySourceName(source);
    const memberName = fullMemberName?.startsWith(`${sourceName} `) ? fullMemberName.slice(sourceName.length + 1) : fullMemberName;
    const deviceCondition = source?.kind === "device" ? {
      incomplete_evidence:memberName ? `${memberName} has no current value` : "Selected entities have no current value",
      some_unavailable:memberName ? `${memberName} is unavailable` : "Some selected entities are unavailable",
      all_unavailable:memberName ? `${memberName} is unavailable` : "All selected entities are unavailable",
    }[problem?.currentReason] : null;
    const impact = affected.map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`).join("; ");
    return `<article class="issue-row ${esc(tone)}" data-ui-key="issue:${esc(episode.episode_id)}"><div class="issue-copy">${eyebrow ? `<p class="small">${esc(eyebrow)}</p>` : ""}<h3>${esc(sourceName)}</h3><p>${esc(deviceCondition ?? problem?.headline ?? "Current condition needs review")}</p>${impact ? `<p class="impact-line">Function status: ${esc(impact)}</p>` : ""}<p class="small">Open since ${esc(date(episode.opened_at))}</p><p class="small">${esc(reportingStatus(data,episode))}</p></div><div class="actions"><button type="button" class="button" data-episode="${esc(episode.episode_id)}">View details</button>${source && !situation ? `<button type="button" class="link" data-source-link="${esc(source.node_id)}">View in Sources</button>` : ""}</div></article>`;
  }

  issuesPanel(data, episodes, recent = false) {
    const total = data.inventory.episodes.length;
    const rows = episodes.map(episode => this.issueRow(data,episode)).join("");
    return `<section class="panel issues-panel">${recent?'<div class="panel-head"><h2>Recent issues</h2></div>':''}${rows||'<div class="body"><p>No open issues.</p></div>'}${recent&&total?'<div class="body issues-footer"><button type="button" class="link" data-page="problems">View all issues →</button></div>':''}</section>`;
  }

  issuesPage(data) {
    let episodes = sortedEpisodes(data);
    if(this.issueSort==="newest") episodes=episodes.sort((a,b)=>b.opened_at.localeCompare(a.opened_at));
    else if(this.issueSort==="name") {const nodes=sourceMap(data);episodes=episodes.sort((a,b)=>this.displaySourceName(nodes.get(a.anchor)).localeCompare(this.displaySourceName(nodes.get(b.anchor))));}
    else if(this.issueSort==="oldest") episodes=episodes.sort((a,b)=>a.opened_at.localeCompare(b.opened_at));
    return `<div class="intro"><h1>Issues</h1></div><div class="issues-toolbar"><span>${episodes.length} open</span><label>Sort by <select data-issue-sort>${[["oldest","Longest open"],["newest","Newest first"],["name","Device name"],["importance","Importance, then longest open"]].map(([id,label])=>`<option value="${id}"${this.issueSort===id?' selected':''}>${label}</option>`).join('')}</select></label></div>${this.issueSort==="importance"?'<p class="small">Uses each source’s configured importance: critical, high, normal, then low. Sources default to normal.</p>':''}${this.issuesPanel(data,episodes)}`;
  }


  functionsPanel(data, selected = data.functions, heading = "Home functions") {
    const nodes = sourceMap(data);
    return `<section class="panel"><div class="panel-head"><h2>${esc(heading)}</h2><span class="small">${selected.length} defined</span></div>${selected.length ? selected.map((item) => {
      const causes = item.readiness.nodes.map((node) => nodes.get(node.node_id)?.name ?? node.node_id);
      return `<button type="button" class="row" data-node="${esc(item.node_id)}">${icon("check-network-outline")}<span class="row-main">${esc(item.name)}<small>${esc(causes.join(", ") || "Declared requirements pass their current checks")}</small></span>${status(item.readiness.answer)}</button>`;
    }).join("") : `<div class="body"><p class="sub">Define the important jobs your house should perform and the sources they require.</p><a href="${esc(homeostaticOptionsUrl(data.entry_id))}">Define home functions in Home Assistant →</a></div>`}</section>`;
  }

  overview(data) {
    const total = data.inventory.episodes.length;
    const activeControls = (data.inventory.operator_controls ?? []).length;
    return `<div class="intro"><h1>Overview</h1><span class="small">Updated ${esc(date(data.updated_at))}</span></div><div class="overview-stats"><button type="button" class="overview-stat" data-page="problems"><span>Open issues</span><strong>${total}</strong><small>${total?'Review what needs attention':'No open problems reported'}</small></button></div>${reportingOverview(data)}${this.issuesPanel(data,recentEpisodes(data),true)}${activeControls?controlsPanel(data):''}`;
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
        : `<a href="${esc(homeostaticOptionsUrl(this.current.data.entry_id))}">Review definitions in Home Assistant</a>`;
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
    if (editInstallation(this,event)) return;
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
    if (sourceSettingsAction(this,button)) return;
    if (button.dataset.sourceMore) {const key=button.dataset.sourceMore;this.sourcesLimits.set(key,(this.sourcesLimits.get(key)||80)+80);this.render();return;}
    if (button.dataset.action === "back-sources") {this.sourcesMobileDetail=false;this.render();[...this.main.querySelectorAll("[data-sources-select]")].find(item=>item.dataset.sourcesSelect===this.sourcesSelection)?.focus();return;}
    if (button.dataset.action === "all-sources") {this.sourcesNeedsReview=false;this.render();return;}
    if (button.dataset.action === "refresh-source") {this.loadSource(true);return;}
    if (button.dataset.action === "preview-settings") {this.previewSettings();return;}
    if (button.dataset.action === "save-settings") {this.saveSettings();return;}
    if (button.dataset.action === "discard-settings") {this.loadConfiguration("settings");return;}
    if (button.dataset.action === "discard-monitoring") {this.loadConfiguration("monitoring");return;}
    if (button.dataset.sourcesToggle !== undefined) {
      const key = button.dataset.sourcesToggle;
      if (this.sourcesExpanded.has(key)) this.sourcesExpanded.delete(key);
      else this.sourcesExpanded.add(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-sources-toggle]")].find((item) => item.dataset.sourcesToggle === key)?.focus();
      return;
    }
    if (button.dataset.sourcesSelect !== undefined) {
      this.sourcesSelection = button.dataset.sourcesSelect;
      this.sourcesMobileDetail = true;
      this.resetSourceScroll = true;
      this.revealSourcesSelection();
      this.render();
      this.shadowRoot.querySelector("#sources-detail-title")?.focus({preventScroll:true});
      if (this.getBoundingClientRect().width <= 760) this.shadowRoot.querySelector(".source-heading")?.scrollIntoView({block:"start"});
      return;
    }
    if (button.dataset.sourcesView) {
      this.sourcesView = button.dataset.sourcesView;
      this.resetSourceScroll = true;
      this.render();
      if (this.sourcesView === "settings" && !this.configuration) this.loadConfiguration();
      return;
    }
    if (button.dataset.action === "collapse-sources") {this.sourcesExpanded.clear(); this.render(); return;}
    if (button.dataset.action === "edit-sources") {
      this.sourcesEdit = true;
      this.sourcesView = "settings";
      this.render();
      if (!this.configuration) this.loadConfiguration();
      return;
    }
    if (button.dataset.configToggle !== undefined) {
      const key = button.dataset.configToggle;
      if (this.configExpanded.has(key)) this.configExpanded.delete(key);
      else this.configExpanded.add(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-config-toggle]")].find((item) => item.dataset.configToggle === key)?.focus();
      return;
    }
    if (button.dataset.configSelect !== undefined) {this.selectConfiguration(button.dataset.configSelect); return;}
    if (button.dataset.action === "collapse-config") {this.configExpanded.clear(); this.render(); this.shadowRoot.querySelector('[data-action="collapse-config"]')?.focus(); return;}
    if (button.dataset.action === "clear-config-search") {this.configQuery = ""; this.expandConfigurationMatches(""); this.render(); this.shadowRoot.querySelector("[data-config-search]")?.focus(); return;}
    if (button.dataset.coverageToggle) {
      this.coverageDisclosure.set(button.dataset.coverageToggle,button.getAttribute("aria-expanded") !== "true");
      this.render();
    }
    else if (button.dataset.coverageSource) {
      this.sourcesSelection = `source:${button.dataset.coverageSource}`;
      this.page = "sources";
      this.revealSourcesSelection();
      this.render();
    }
    else if (button.hasAttribute("data-location-coverage")) {
      this.rememberExploreState();
      const selected = locationList(locationTree(this.current.data)).find((location) => location.id === this.location);
      this.coverageSelection = new Set(selected?.sources.map((source) => source.node_id) ?? []);
      this.coverageLocation = selected?.name ?? null;
      this.coverageQuery = "";
      this.page = "sources";
      this.sourcesGrouping = "location";
      this.sourcesSelection = selected ? `location:${selected.id}` : null;
      this.revealSourcesSelection();
      this.render();
    }
    else if (button.dataset.page) {
      this.rememberExploreState();
      if (button.closest(".nav") && button.dataset.page === "coverage") {
        this.coverageSelection = null;
        this.coverageLocation = null;
        this.coverageQuery = "";
      }
      this.page = ["house","coverage"].includes(button.dataset.page) ? "sources" : button.dataset.page;
      if (button.dataset.page === "coverage") this.sourcesNeedsReview = true;
      if (button.dataset.page === "house") this.sourcesGrouping = "location";
      this.render();
      if (["configuration","notifications"].includes(this.page) && !this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.settingsSection === "monitoring") {
      this.page = "sources";
      this.sourcesEdit = true;
      this.sourcesView = "settings";
      this.render();
      if (!this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.settingsSection) {
      this.rememberExploreState();
      this.page = button.dataset.settingsSection==="notifications"||button.dataset.settingsSection==="alerts"?"notifications":"configuration";
      if (this.page==="configuration") this.settingsSection = button.dataset.settingsSection;
      this.render();
      if (!this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.removeRule !== undefined) {this.configDraft.splice(Number(button.dataset.removeRule),1); this.configPreview = null; this.render();}
    else if (button.dataset.ignoreAvailability) this.ignoreAvailability(button.dataset.ignoreAvailability);
    else if (button.dataset.configSource) {
      this.dialog.close();
      const source = this.current.status === "current" ? inventoryRows(this.current.data).find((item) => item.node_id === button.dataset.configSource) : null;
      if (source) {this.sourcesSelection = `source:${source.node_id}`; this.sourcesQuery = ""; this.revealSourcesSelection();}
      else {this.sourcesQuery = button.dataset.configSource; this.revealSourcesSearch();}
      this.page = "sources";
      this.sourcesEdit = true;
      this.sourcesView = "settings";
      this.render();
      if (!this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.sourceLink) {this.dialog.close(); this.sourcesMobileDetail=true; this.sourcesView="source"; this.resetSourceScroll=true; this.sourcesSelection = `source:${button.dataset.sourceLink}`; this.page = "sources"; this.revealSourcesSelection(); this.render();}
    else if (button.dataset.location) {this.location = button.dataset.location; this.sourcesGrouping = "location"; this.sourcesSelection = `location:${this.location}`; this.page = "sources"; this.revealSourcesSelection(); this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = ["house","coverage"].includes(this.config.view) ? "sources" : this.config.view; this.render();}
    else if (button.dataset.action === "close") this.dialog.close();
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "retry-catalog") { this.store?.ensureCatalog(true); this.render(); }
    else if (button.dataset.action === "add-rule") {const rule = newCatalogRule(this.configDraft); this.configDraft.push(rule); this.configEditingRule = rule.id; this.configPreview = null; this.render();}
    else if (button.dataset.action === "load-configuration") this.loadConfiguration();
    else if (button.dataset.action === "preview-alerts") this.previewAlerts();
    else if (button.dataset.action === "save-alerts") this.saveAlerts();
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
    if (event.target.matches?.("[data-sources-toggle]") && ["ArrowLeft","ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const key = event.target.dataset.sourcesToggle;
      if (event.key === "ArrowRight") this.sourcesExpanded.add(key);
      else this.sourcesExpanded.delete(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-sources-toggle]")].find((item) => item.dataset.sourcesToggle === key)?.focus();
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
    this.sourcesEdit = true;
    this.sourcesView = "settings";
    this.page = "sources";
    if (!this.configuration) await this.loadConfiguration();
    if (!this.configuration || this.current.status !== "current") return;
    const scope = monitoringScope("entity",nodeId,source);
    if (!scope || !setScopeChoice(this.configDraft,scope,"exclude")) {
      this.configError = "Multiple direct choices apply. Review this entity in the advanced rules before ignoring availability.";
    } else {
      this.configError = null;
    }
    this.sourcesSelection = `source:${source.node_id}`;
    this.revealSourcesSelection();
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
      const retained = data.inventory.resolved_history?.episodes.some((item) => item.episode.episode_id === selection.episodeId);
      if (retained) {
        this.page = "history";
        this.render();
        this.tools.showHistory(selection.episodeId);
        return;
      }
      this.shadowRoot.querySelector("#detail-label").textContent = "History unavailable";
      body.innerHTML = '<p>This issue is not in current issues or retained history. Its outcome cannot be determined here.</p><p><a href="/homeostatic/issues">Open Issues</a> · <a href="/homeostatic/history">Open History</a></p>';
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
      const memberEvidence = result.device_evidence?.total ? result.device_evidence : null;
      const uncertainMembers = memberEvidence?.members.filter((member) => member.restored || ["unknown", "unavailable", "missing"].includes(member.state)) ?? [];
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      const integrationDomains = source.attributes?.integration_domain ?? [];
      const deviceIntegrations = [...new Set(integrationDomains.map((domain) => integrationProblem({kind:"integration",attributes:{domain:[domain]}},[],(key) => this._hass.localize?.(key)).integration))];
      const availabilityChoices = memberEvidence ? `<details ${disclosure("selected-readings")}><summary>${memberEvidence.total} selected ${memberEvidence.total === 1 ? "entity" : "entities"} and monitoring choices</summary><ul>${memberEvidence.members.map((member) => `<li><strong>${esc(member.name)}</strong> · ${esc(member.restored ? "Restored; current value unknown" : member.state)} <button class="link" type="button" data-ignore-availability="${esc(member.node_id)}">Ignore availability…</button></li>`).join("")}</ul>${memberEvidence.members.length < memberEvidence.total ? `<p class="small">Showing ${memberEvidence.members.length} of ${memberEvidence.total} selected entities.</p>` : ""}<p class="small">Changes to monitoring are previewed before saving.</p><div class="actions"><button class="link" type="button" data-config-source="${esc(source.node_id)}">Review monitoring choices</button><button class="link" type="button" data-source-link="${esc(source.node_id)}">View in Sources</button></div></details>` : source.kind === "entity" ? `<section class="detail"><button class="button" type="button" data-ignore-availability="${esc(source.node_id)}">Ignore this availability check…</button><p class="small">Opens a draft monitoring change for preview and save. Home Assistant state stays unchanged.</p></section>` : "";
      const dependencies = result.explanation.nodes.filter((node) => node.node_id !== nodeId);
      const unwatched = result.readiness?.nodes.filter((node) => !node.watched) ?? [];
      const nativeLink = source.kind === "device" ? "" : source.kind === "integration" && problem ? (problem.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : "") : source.entity_id
        ? `<button class="button primary" type="button" data-entity="${esc(source.entity_id)}">${esc(problem?.entityLabel ?? "View in Home Assistant")}</button>`
        : source.entry_id || source.owner_id ? '<a class="button primary" href="/config/integrations">Review connection</a>' : "";
      const explanation = episode ? data.policy.episodes.find((item) => item.episode_id === episode.episode_id) : null;
      const controls = (data.inventory.operator_controls ?? []).filter((control) => [episode?.episode_id, nodeId].includes(control.target));
      const diagnosticData = {evidence:result,policy:explanation,notifications_enabled:data.policy.notifications_enabled,controls};
      const genericSummary = source.kind === "situation" ? (episode ? "This reported condition remains open. Check its current state." : "No open problem is reported for this condition.")
        : result.readiness ? `${ownerStatus(result.readiness.answer)} in Home Assistant.` : "Current status has not been confirmed.";
      body.innerHTML = `<section class="detail problem-brief">${memberEvidence ? `<h3 class="problem-integration">${deviceIntegrations.length ? `<span>Integration</span> ${esc(deviceIntegrations.join(", "))}` : "Home Assistant device"}</h3>${uncertainMembers.length === 1 ? `<p><strong>${esc(uncertainMembers[0].name)}</strong> · ${esc(uncertainMembers[0].restored ? "restored; current value unknown" : uncertainMembers[0].state)} in Home Assistant</p>` : uncertainMembers.length ? `<p>Entities needing review:</p><ul>${uncertainMembers.map((member) => `<li><strong>${esc(member.name)}</strong> · ${esc(member.restored ? "restored; current value unknown" : member.state)}</li>`).join("")}</ul>` : `<p>All selected entities have current Home Assistant states.</p>`}${memberEvidence.members.length < memberEvidence.total ? `<p class="small">Showing the first 50 selected entities. More may need review.</p>` : ""}` : problem ? `${source.kind === "integration" ? "" : `<p class="small">${esc(problem.context ?? problem.integration)}</p>`}<h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}
         <div class="next-action"><p>${memberEvidence ? "Check the affected entities on the device page; review monitoring if this state is expected." : esc(problem?.nextStep ?? (nativeLink ? "Check the current state in Home Assistant." : "Check the listed requirements to find what needs attention."))}</p>${nativeLink || problem?.deviceUrl ? `<div class="actions">${nativeLink}${problem?.deviceUrl ? `<a class="button${memberEvidence ? " primary" : ""}" href="${esc(problem.deviceUrl)}">Open device page</a>` : ""}</div>` : ""}</div>
         ${episode ? `<p class="small problem-progress">Open since ${esc(date(episode.opened_at))}</p><p class="small">${esc(reportingStatus(data,episode))}</p>` : ""}</section>
         ${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}
         ${problem?.connectionNote ? `<section class="detail"><p>${esc(problem.connectionNote)}</p><button class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button></section>` : ""}
         ${availabilityChoices}
         ${diagnostic ? source.kind === "device" ? `<section class="detail evidence-overview" aria-label="Household impact"><h3>What this means at home</h3><p>${esc(diagnostic.impact)}</p></section>` : `<section class="detail evidence-overview" aria-label="Evidence summary"><h3>What Homeostatic knows</h3><dl><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd><dt>What is checked</dt><dd>${esc(diagnostic.checks)}</dd><dt>Current assessment</dt><dd>${esc(diagnostic.assessment)}</dd><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></dl></section>` : ""}
          ${["integration","entity"].includes(source.kind) ? `<button type="button" class="button" data-source-link="${esc(source.node_id)}">View in Sources</button>` : ""}
         ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Working on equipment"} until ${esc(date(control.until))}.</p>`).join("")}
        ${this.tools.detailButtons(source, episode, data)}
        <details ${disclosure("technical")}><summary>Technical details</summary>
           ${memberEvidence ? `<h3>Assessment rule</h3><p>A current Home Assistant state counts as reporting. Unknown, missing, restored, and unavailable states need review. These states do not verify physical connectivity or device health.</p>` : ""}
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
    this.shadowRoot.querySelector(".shell").classList.add("panel-shell");
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
    applyNotificationRoute(this, value?.path ?? "");
  }

}

class HomeostaticStrategy {
  static getCreateSuggestions() { return {title:"Homeostatic",icon:"mdi:home-heart"}; }
  static async generate() {
    return {title:"Homeostatic",views:[
      {title:"Home",path:"overview",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"overview",navigation:false}]},
      {title:"Issues",path:"issues",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"problems",navigation:false}]},
      {title:"Sources",path:"sources",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"sources",navigation:false}]},
      {title:"History",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"history",navigation:false}]},
      {title:"Notifications",path:"notifications",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"notifications",navigation:false}]},
      {title:"Settings",path:"configuration",type:"panel",cards:[{type:"custom:homeostatic-card-v21",view:"configuration",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v21")) customElements.define("homeostatic-card-v21", HomeostaticCard);
if (!customElements.get("homeostatic-panel-v22")) customElements.define("homeostatic-panel-v22", HomeostaticPanel);
if (!customElements.get("homeostatic-panel-v21")) customElements.define("homeostatic-panel-v21", class extends HomeostaticPanel {});
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
