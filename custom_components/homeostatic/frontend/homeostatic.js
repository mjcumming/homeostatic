import {editReusable, namedPolicies, restoreMethodDialogs, scopedEditorFooter} from "./reusable-editors.mjs?v=74";
import {upsProblem} from "./ups.mjs?v=74";
import {reportingStatus} from "./reporting.mjs?v=74";
import {affectedFunctions, dashboardStore, escapeHtml as esc, sourceMap} from "./model.mjs?v=74";
import {deviceAvailability, deviceAvailabilityStamp, deviceEntityName} from "./device-availability.mjs?v=74";
import {batteryProblem, brokenAutomationProblem, deviceProblem, entityProblem, integrationProblem, repairProblem, vacuumProblem} from "./problem.mjs?v=74";
import {DashboardTools} from "./history-controls.mjs?v=74";
import {diagnosticOverview} from "./evidence.mjs?v=74";
import {styles} from "./styles.mjs?v=74";

import {sourcesBrowser, sourcesTree, sourcePaths, topomationTree, canonicalSourceSelection, editSourceAvailability} from "./sources-workspace.mjs?v=74";

import {installationSettings, editInstallation} from "./installation-settings.mjs?v=74";

import {cardView} from "./notification-navigation.mjs?v=74";
import {WorkspaceNavigation, workspacePage} from "./workspace-navigation.mjs?v=74";
import {initializeScopedConfiguration, rebaseScopedConfiguration, saveScopedConfiguration} from "./scoped-configuration.mjs?v=74";
import {issuesWorkspace, relatedEvidenceDetails} from "./issues-workspace.mjs?v=74";

const VIEWS = ["sources", "problems", "history", "notifications", "policies", "configuration"];
const date = (value) => value ? new Date(value).toLocaleString() : "No completed update";
const ownerStatus = (value) => ({ready:"Available",blocked:"Unavailable",unknown:"Not confirmed",degraded:"Limited"}[value] ?? "Not confirmed");
const icon = (name) => `<ha-icon icon="mdi:${name}" aria-hidden="true"></ha-icon>`;
const SOURCES_GROUPING_KEY = "homeostatic-sources-grouping";

function savedSourcesGrouping() {
  try { const saved=window.sessionStorage.getItem(SOURCES_GROUPING_KEY); return ["integration","location","topomation"].includes(saved) ? saved : "integration"; }
  catch { return "integration"; }
}

class HomeostaticCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this.config = {view: "problems"};
    this.page = "problems";
    this.configuration = null;
    this.configError = null;
    this.configBusy = false;
    this.sourcesGrouping = savedSourcesGrouping();
    this.topomation = null;
    this.topomationLoaded = false;
    this.topomationSequence = 0;
    this.sourcesSelection = null;
    this.sourcesExpanded = new Set();
    this.sourcesQuery = "";
    this.sourcesNeedsReview = false;
    this.sourcesView = "source";
    this.settingsSection = "timing";
    this.settingsDraft = null;
    this.deliveryBusy = false;
    this.deliveryError = null;
    this.settingsBusy = false;
    this.settingsError = null;
    this.sourcesLimits = new Map();
    this.sourcesMobileDetail = false;
    this.sourceDetail = null;
    this.sourceSequence = 0;
    this.issueSort = "newest";
    this.issueQuery = "";
    this.issueGroupsExpanded = new Set();
    this.issueGroupLimits = new Map();
    this.notificationSection = "profiles";
    this.navigation = new WorkspaceNavigation(this);
    this.renderedView = null;
    this.renderedCurrent = false;
    this.renderedContent = null;
    this.rendering = false;
    this.savedPageState = null;
    this.current = {status: "loading", data: null, error: null};
    this.detail = null;
    this.detailSequence = 0;
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="header-line"><div class="brand">${icon("home-heart")}Homeostatic</div><div class="workspace-notifications"></div><button type="button" class="link workspace-settings" data-page="configuration">Settings</button></div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="problems">Issues</button><button type="button" data-page="sources">Sources</button><button type="button" data-page="policies">Policies</button><button type="button" data-page="notifications">Notifications</button></nav><button type="button" class="link workspace-return" data-workspace-return hidden>Back</button><button type="button" class="button" data-action="back" hidden>Back</button></header><p class="workspace-status note" role="status" hidden></p><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
    this.main = this.shadowRoot.querySelector("main");
    this.dialog = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.addEventListener("click", (event) => this.clicked(event));
    this.shadowRoot.addEventListener("keydown", (event) => this.keydown(event));
    this.shadowRoot.addEventListener("input", event => {
      if (this.rendering) return;
      if (event.target.matches("[data-issue-search]")) {
        this.issueQuery = event.target.value;
        this.render();
        return;
      }
      if (editReusable(this,event)) return;
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
    });
    this.shadowRoot.addEventListener("change", (event) => {
      if (this.rendering) return;
      if (editSourceAvailability(this,event)) return;
      if (event.target.matches?.("[data-notifications-switch]")) {
        saveScopedConfiguration(this,{kind:"notifications"},event.target.checked);
        return;
      }
      if (editInstallation(this,event)) return;
      if (event.target.matches?.("[data-issue-sort]")) {this.issueSort=event.target.value;this.render();return;}
      if (event.target.matches?.("[data-sources-group]")) {
        this.sourcesGrouping = event.target.value;
        if (this.sourcesGrouping === "topomation" && !this.topomation) this.loadTopomation();
        try { window.sessionStorage.setItem(SOURCES_GROUPING_KEY,this.sourcesGrouping); } catch { /* Embedded storage may be unavailable. */ }
        this.revealSourcesSelection();
        this.render();
        return;
      }
      if (event.target.matches?.("[data-sources-disabled]")) {
        this.sourcesShowDisabled = event.target.checked;
        this.render();
        return;
      }
      if (event.target.matches?.("[data-sources-excluded]")) {
        this.sourcesExcludedOnly=event.target.checked;
        this.render();return;
      }
      if (event.target.matches?.("[data-sources-review]")) {
        this.sourcesNeedsReview = event.target.checked;
        this.render();
        return;
      }
    });
    this.tools = new DashboardTools(this);
    this.dialog.addEventListener("close", () => {if (!this.dialog.open) {this.detail = null; this.detailSequence++;}});
  }

  static getStubConfig() { return {view: "issues"}; }
  getCardSize() { return 8; }

  setConfig(config) {
    const view = cardView(config.view);
    if (!VIEWS.includes(view)) {
      throw new Error("Homeostatic view must be issues, sources, policies, notifications, settings, or history.");
    }
    this.config = {...config, view};
    this.page = view;
    if (config.view === "house") this.sourcesGrouping = "location";
    if (config.view === "coverage") this.sourcesNeedsReview = true;
    this.render();
  }

  set hass(value) {
    const changed = this._hass?.connection !== value.connection || this._hass?.user?.id !== value.user?.id;
    this._hass = value;
    if (changed) {
      this.release();
      this.connect();
    } else if (!this.removeListener) this.connect();
    else if (this.page === "sources" && this.sourceDetail?.device_availability &&
      !this.sourceDetail.stamp?.endsWith(`:${deviceAvailabilityStamp(this.sourceDetail.device_availability,value.states)}`)) this.loadSource();
  }

  connectedCallback() { this.navigation.connect(); this.connect(); }
  disconnectedCallback() {
    this.navigation.disconnect();
    this.release(false);
    this.detailSequence++;
    this.dialog.close();
  }

  release(clear = true) {
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
    this.current = {status: "loading", data: clear ? null : this.current.data, error: null};
    this.detailSequence++;
  }

  connect() {
    if (!this.isConnected || !this._hass || this.removeListener) return;
    if (!this._hass.user?.is_admin) {
      this.current = {status: "error", data: null, error: "Administrator access is required for the installation-wide dashboard."};
      this.render();
      return;
    }
    this.store = dashboardStore(this._hass.connection, this._hass.user.id);
    this.loadTopomation();
    this.removeListener = this.store.listen((value) => {
      const catalogArrived = value.data?.catalog_loaded &&
        (!this.current.data?.catalog_loaded || this.current.data?.catalog_stale && !value.data?.catalog_stale);
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
      if (value.status === "current" && !this.configuration && !this.configBusy) this.loadConfiguration();
      else if(value.status==="current" && this.configuration && !this.configBusy && !this.settingsBusy && typeof value.data.policy?.notifications_enabled==="boolean" && value.data.policy.notifications_enabled!==this.configuration.settings.notifications)this.loadConfiguration("rebase");
      if (this.pendingEpisode && value.status === "current") {
        const episodeId = this.pendingEpisode;
        this.pendingEpisode = null;
        this.openDetail({episodeId});
      } else if(this.pendingNode && value.status==="current") {
        const nodeId=this.pendingNode;this.pendingNode=null;this.openDetail({nodeId});
      } else if(this.pendingHistory && value.status==="current") {
        const id=this.pendingHistory;this.pendingHistory=null;this.tools.showHistory(id);
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
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.renderPage();
    } finally {
      this.rendering = false;
    }
  }

  renderNotificationControl() {
    const host=this.shadowRoot.querySelector(".workspace-notifications");
    const known=Boolean(this.configuration);
    const enabled=this.configuration?.settings?.notifications===true;
    const pending=this.scopedBusy==="notifications";
    const error=this.scopedStatusScope==="notifications" ? this.scopedError : null;
    if(!host.querySelector("input"))host.innerHTML='<label class="method-switch"><span>Notifications</span><input type="checkbox" role="switch" data-notifications-switch aria-label="Notifications"><span data-notifications-state></span></label><div data-notifications-feedback></div>';
    const input=host.querySelector("input");
    input.checked=enabled;
    input.disabled=!known||this.current.status!=="current"||this.settingsBusy||this.configBusy;
    host.querySelector("[data-notifications-state]").textContent=known ? enabled ? 'On' : 'Off' : 'Loading';
    host.querySelector("[data-notifications-feedback]").innerHTML=pending?'<p class="small" role="status">Saving…</p>':error?`<p class="config-error" role="alert">${esc(error)}</p>`:'';
  }

  renderPage() {
    this.renderNotificationControl();
    this.navigation.updateReturn();
    const view = this.viewIdentity();
    if (view !== this.renderedView) this.savedPageState = null;
    else if (this.renderedCurrent) this.savedPageState = this.capturePageState();
    this.shadowRoot.querySelector(".nav").hidden = this.config.navigation === false;
    const back = this.shadowRoot.querySelector('[data-action="back"]');
    back.hidden = this.config.navigation !== false || this.page === this.config.view;
    back.textContent = `← Back to ${{sources:"Sources",problems:"Issues",history:"History",notifications:"Notifications",policies:"Policies",configuration:"Settings"}[this.config.view]}`;
    this.shadowRoot.querySelectorAll("[data-page]").forEach((button) => {
      if (button.closest(".nav")) {
        if (button.dataset.page === this.page || button.dataset.page === "problems" && this.page === "history") button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });
    const selection=this.definitionSelection;
    const editorScope=this.page==="configuration"?"settings":
      (this.page==="policies"&&selection?.kind==="policies"||this.page==="notifications"&&["methods","profiles"].includes(selection?.kind))?
        `${{policies:"policy",methods:"method",profiles:"profile"}[selection.kind]}:${selection.id}`:null;
    const footer=this.main.querySelector("[data-scoped-editor]");
    const saveError=editorScope&&this.scopedStatusScope===editorScope&&!this.scopedBusy?this.scopedError:null;
    const saveNotice=editorScope&&this.scopedStatusScope===editorScope&&!this.scopedBusy?this.scopedNotice:null;
    if(this.current.status==="current"||this.retainedSave?.scope!==editorScope||this.renderedView!==view||saveError||
      !this.scopedBusy&&(this.current.status==="error"||this.current.data?.error))this.retainedSave=null;
    if(this.current.status!=="current"&&this.renderedCurrent&&this.renderedView===view&&this.settingsBusy&&
      this.scopedBusy===editorScope&&footer?.dataset.scopedEditor===editorScope) {
      this.retainedSave={scope:editorScope,kind:footer.dataset.scopeKind,id:footer.dataset.scopeId,label:footer.dataset.saveLabel};
    }
    const status = this.shadowRoot.querySelector(".workspace-status");
    if(this.retainedSave&&footer?.dataset.scopedEditor===this.retainedSave.scope) {
      const notice=this.current.status==="disconnected"?"Connection lost. Waiting for Home Assistant to reconnect.":
        this.current.status==="error"?`Monitoring is unavailable. ${this.current.error||"Waiting to reconnect."}`:
        this.current.data?.error?`Monitoring is unavailable. ${this.current.data.error}`:
        this.scopedBusy?"Applying changes…":"Finishing update…";
      status.hidden=false;status.textContent=notice;
      this.main.inert=true;
      if(!this.scopedBusy) {
        const saved=this.retainedSave;
        const content=scopedEditorFooter(this,{kind:saved.kind,id:saved.id},saved.label);
        if(footer.outerHTML!==content)footer.outerHTML=content;
        this.renderedContent=null;
      }
      this.renderedCurrent=false;
      return;
    }
    const retained = ["loading", "disconnected"].includes(this.current.status) && this.current.data?.available;
    if (status) {
      status.hidden = !retained;
      status.textContent = retained ? "Refreshing monitoring. Showing the last completed update; controls resume when monitoring reconnects." : "";
    }
    this.main.inert = Boolean(retained);
    if (this.current.status !== "current" && !retained) {
      const messages = {
        loading: ["Loading dashboard", "Receiving the latest monitoring result from Home Assistant."],
        disconnected: ["Connection lost", "Current health is unknown. Reconnecting to Home Assistant."],
        unavailable: ["Monitoring unavailable", this.current.data?.error ? "Homeostatic reported an error. Check its configuration, storage and logs." : "Homeostatic is starting or has been unloaded. During startup, this page will update automatically when monitoring is ready."],
        error: ["Dashboard unavailable", this.current.error],
      };
      const [title, message] = messages[this.current.status];
      const completed = this.current.data?.updated_at;
      this.main.innerHTML = `<div class="banner" role="status"><h2>${esc(title)}</h2><p>${esc(message)}</p>${saveError?`<p class="config-error" role="alert">${esc(saveError)}</p>`:""}${saveNotice?`<p>${esc(saveNotice)}</p>`:""}${completed ? `<p class="small">Last completed update: ${esc(date(completed))}</p>` : ""}${this.store && this.current.status === "error" ? '<button class="link" type="button" data-action="retry">Retry connection</button>' : ""}</div>`;
      this.renderedCurrent = false;
      this.renderedContent = null;
      return;
    }
    const data = this.current.data;
    if (["sources","problems","policies"].includes(this.page) && (data.catalog_stale || !data.catalog_loaded)) this.store?.ensureCatalog();
    if (this.page === "sources" && data.schema_version === 3 && !data.catalog_loaded) {
      this.main.innerHTML = `<div class="banner" role="status"><h2>${this.current.catalogError ? "Sources unavailable" : "Loading sources"}</h2><p>${esc(this.current.catalogError || "Loading the complete source catalog for browsing and search.")}</p>${this.current.catalogError ? '<button class="link" type="button" data-action="retry-catalog">Retry loading sources</button>' : ""}</div>`;
      this.renderedCurrent = false;
      this.renderedContent = null;
      this.store?.ensureCatalog();
      return;
    }
    const content = this.page === "policies" ? this.policiesPage()
      : ["configuration","notifications"].includes(this.page) ? installationSettings(this)
      : this.page === "sources" ? this.sourcesPage()
      : this.page === "history" ? this.history(data) : this.issuesPage(data);
    const replaced = content !== this.renderedContent;
    if (replaced) {
      this.main.innerHTML = content;
      this.renderedContent = content;
      restoreMethodDialogs(this);
    }
    if (!retained && this.savedPageState && (replaced || !this.renderedCurrent)) this.restorePageState(this.savedPageState);
    const configDetail = this.main.querySelector(".config-detail");
    if (configDetail) {
      configDetail.dataset.selection = this.sourcesSelection ?? "";
    }
    this.renderedView = this.viewIdentity();
    this.renderedCurrent = !retained;
    this.resetSourceScroll = false;
    if (replaced) this.observeSourceBranches();
    if (this.page === "sources") queueMicrotask(()=>this.loadSource());
  }

  policiesPage() {
    const intro = `<div class="intro"><div><h1>Policies</h1><p class="sub">Choose what to watch, when it becomes a problem, and who to notify.</p></div></div>`;
    if (!this.configuration) return `${intro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading monitoring rules…")}</p><button type="button" class="button" data-action="load-configuration">Reload configuration</button></div></section>`;
    return `${intro}<section class="panel"><div class="body">${namedPolicies(this)}</div></section>`;
  }

  sourcesPage() {
    const intro = '<div class="intro"><div><h1>Sources</h1></div></div>';
    const catalogStatus = this.current.data.catalog_stale
      ? `<p class="note" role="status">${this.current.catalogError ? `Source list update failed: ${esc(this.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry updating sources</button>` : "Updating sources. You can keep browsing the previous complete list; results may be out of date until the update finishes."}</p>`
      : "";
    return intro + catalogStatus + sourcesBrowser(this);
  }

  revealSourcesSelection() {
    if (this.current.status !== "current" || this.current.data.catalog_loaded === false) return;
    this.sourcesExpanded ??= new Set();
    this.sourcesGrouping ??= "integration";
    const tree=sourcesTree(this.current.data,this.sourcesGrouping,null,this.topomation);
    this.sourcesSelection=canonicalSourceSelection(tree,this.sourcesSelection);
    const paths = sourcePaths(tree);
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

  async loadConfiguration() {
    if (this.configBusy) return;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      const result = await this._hass.callWS({type:"homeostatic/configuration",section:"settings"});
      const previous = this.configuration;
      const fresh = {...result,...Object.fromEntries(["delivery_targets","notification_people","notification_destinations","consumers"].filter(key=>previous && key in previous).map(key=>[key,previous[key]]))};
      if (this.scopedConfiguration) rebaseScopedConfiguration(this,fresh);
      else {
        this.configuration = fresh;
        this.settingsDraft = structuredClone(result.settings);
        initializeScopedConfiguration(this);
      }
    } catch (error) {
      this.configError = error?.message ?? "Could not load configuration.";
    } finally {
      this.configBusy = false;
      this.render();
    }
  }

  async loadDeliveryConfiguration(retry = false) {
    if (!this.configuration || this.deliveryBusy || !retry && this.configuration.delivery_targets) return;
    const connection = this._hass.connection;
    this.deliveryBusy = true;
    this.deliveryError = null;
    this.render();
    try {
      const result = await this._hass.callWS({type:"homeostatic/configuration",section:"delivery"});
      if (this._hass.connection === connection && this.configuration) Object.assign(this.configuration,result);
    } catch (error) {
      this.deliveryError = error?.message ?? "Could not load notification destinations.";
    } finally {
      this.deliveryBusy = false;
      this.render();
    }
  }

  async loadSource(force = false) {
    if (this.page !== "sources" || this.current.status !== "current") return;
    const selected = sourcePaths(sourcesTree(this.current.data,this.sourcesGrouping,null,this.topomation)).get(this.sourcesSelection)?.node;
    const nodeId = selected?.source?.node_id;
    if (!nodeId) return;
    const states = this._hass.states, updatedAt = this.current.data.updated_at;
    const previous = this.sourceDetail?.nodeId === nodeId ? this.sourceDetail : null;
    const stamp = `${updatedAt}:${deviceAvailabilityStamp(previous?.device_availability,states)}`;
    if (!force && this.sourceDetail?.nodeId === nodeId && this.sourceDetail.stamp === stamp) return;
    const sequence = ++this.sourceSequence;
    this.sourceDetail = {...previous,nodeId,stamp,loading:true};
    try {
      const result = await this._hass.callWS({type:"homeostatic/source",node_id:nodeId});
      if (sequence !== this.sourceSequence) return;
      const readStamp = `${updatedAt}:${deviceAvailabilityStamp(result.device_availability,states)}`;
      this.sourceDetail = {...result,nodeId,stamp:readStamp};
    } catch (error) {
      if (sequence !== this.sourceSequence) return;
      this.sourceDetail = {nodeId,stamp,error:error?.message || "Could not read this source."};
    }
    if (this.page === "sources") this.render();
  }

  async loadSourceMore() {
    const detail=this.sourceDetail;
    if(!detail || detail.loading || detail.moreLoading || detail.next_offset == null || this.current.status!=="current")return;
    const sequence=this.sourceSequence,offset=detail.next_offset,updated=this.current.data.updated_at;
    detail.moreLoading=true;detail.moreError=null;this.render();
    try {
      const result=await this._hass.callWS({type:"homeostatic/source",node_id:detail.nodeId,offset,limit:50});
      if(sequence!==this.sourceSequence || this.sourceDetail!==detail)return;
      if(updated!==this.current.data.updated_at || result.updated_at!==detail.updated_at) {this.loadSource(true);return;}
      const members=new Map([...detail.members,...result.members].map(item=>[item.entity_id||item.node_id,item]));
      Object.assign(detail,result,{members:[...members.values()],moreLoading:false});
    } catch(error) {
      if(sequence!==this.sourceSequence)return;
      detail.moreLoading=false;detail.moreError=error?.message||"Could not load more entity readings. Try again.";
    }
    if(this.page==="sources")this.render();
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

  displaySourceName(source) {
    source = sourceMap(this.current.data).get(source?.monitoring_source) || source;
    if (source?.kind !== "integration") return source?.name ?? "Monitored source";
    const provider = integrationProblem(source,[],(key) => this._hass.localize?.(key)).integration;
    if (provider.toLocaleLowerCase().includes(source.name.toLocaleLowerCase())) return provider;
    return provider === "Home Assistant" || source.name.toLocaleLowerCase().includes(provider.toLocaleLowerCase())
      ? source.name : `${provider} · ${source.name}`;
  }

  issueRow(data, episode) {
    const nodes = sourceMap(data);
    const source = nodes.get(episode.anchor);
    const situation = source?.kind === "situation";
    const repair = source?.kind === "repair" || source?.kind === "broken_automation";
    const affected = affectedFunctions(data, episode);
    const problem = upsProblem(source,data.inventory.ups_status?.[episode.anchor]) ?? repairProblem(source, episode.reasons) ?? brokenAutomationProblem(source, episode.reasons) ?? vacuumProblem(source, data.inventory.entity_status?.[episode.anchor], data.areas) ?? batteryProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
      deviceProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
      integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor], true, nodes) ??
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
      connectivity_disconnected:"Connection reports disconnected",
    }[problem?.currentReason] : null;
    const impact = affected.map((item) => `${item.name}: ${ownerStatus(item.readiness.answer).toLowerCase()}`).join("; ");
    return `<article class="issue-row ${esc(tone)}" data-ui-key="issue:${esc(episode.episode_id)}"><div class="issue-copy">${eyebrow ? `<p class="small">${esc(eyebrow)}</p>` : ""}<h3>${esc(sourceName)}</h3><p>${esc(deviceCondition ?? problem?.headline ?? "Current condition needs review")}</p>${impact ? `<p class="impact-line">Function status: ${esc(impact)}</p>` : ""}<p class="small">Open since ${esc(date(episode.opened_at))}</p><p class="small">${esc(reportingStatus(data,episode))}</p></div><div class="actions"><button type="button" class="button" data-episode="${esc(episode.episode_id)}">View details</button>${repair ? `<a class="link" href="${esc(source.fix_url)}">Fix in Home Assistant</a>` : source && !situation ? `<button type="button" class="link" data-source-link="${esc(source.monitoring_source||source.node_id)}">View in Sources</button>` : ""}</div></article>`;
  }

  issuesPage() { return issuesWorkspace(this); }


  history(data) {
    return `<div class="intro"><div><h1>Issues</h1></div></div><nav class="workspace-tabs" aria-label="Issue views"><button class="link" data-page="problems">Current issues</button><button class="link" data-page="history" aria-current="page">History</button></nav>${this.tools.historyPanel(data)}`;
  }

  clicked(event) {
    if (event.target.closest?.("[data-workspace-return]")) {this.navigation.back();return;}
    const previous = this.navigation.capture();
    try {this.handleClick(event);} finally {this.navigation.finish(previous);}
  }

  handleClick(event) {
    if (event.target.matches?.("[data-availability-select]")) return;
    if (editSourceAvailability(this,event)) return;
    if (editInstallation(this,event)) return;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.issueGroup) {
      const key=button.dataset.issueGroup;
      if(this.issueGroupsExpanded.has(key))this.issueGroupsExpanded.delete(key);else this.issueGroupsExpanded.add(key);
      this.render();return;
    }
    if (button.dataset.issueMore) {const key=button.dataset.issueMore;this.issueGroupLimits.set(key,(this.issueGroupLimits.get(key)||40)+40);this.render();return;}
    if (button.dataset.action === "clear-issue-search") {this.issueQuery="";this.render();return;}
    if (button.dataset.sourceMore) {const key=button.dataset.sourceMore;this.sourcesLimits.set(key,(this.sourcesLimits.get(key)||80)+80);this.render();return;}
    if (button.dataset.action === "back-sources") {this.sourcesMobileDetail=false;this.render();[...this.main.querySelectorAll("[data-sources-select]")].find(item=>item.dataset.sourcesSelect===this.sourcesSelection)?.focus();return;}
    if (button.dataset.action === "all-sources") {this.sourcesNeedsReview=false;this.render();return;}
    if (button.dataset.action === "refresh-source") {this.loadSource(true);return;}
    if (button.dataset.action === "more-source-evidence") {this.loadSourceMore();return;}
    if (button.dataset.sourcesToggle !== undefined) {
      const key = button.dataset.sourcesToggle;
      if (this.sourcesExpanded.has(key)) this.sourcesExpanded.delete(key);
      else this.sourcesExpanded.add(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-sources-toggle]")].find((item) => item.dataset.sourcesToggle === key)?.focus();
      return;
    }
    if (button.dataset.sourcesSelect !== undefined) {
      this.sourcesActionError = null;
      this.sourcesSelection = button.dataset.sourcesSelect;
      this.sourcesMobileDetail = true;
      this.resetSourceScroll = true;
      this.revealSourcesSelection();
      this.render();
      this.shadowRoot.querySelector("#sources-detail-title")?.focus({preventScroll:true});
      if (this.getBoundingClientRect().width <= 760) this.shadowRoot.querySelector(".source-heading")?.scrollIntoView({block:"start"});
      return;
    }
    if (button.dataset.action === "collapse-sources") {this.sourcesExpanded.clear(); this.render(); return;}
    if (button.dataset.page) {
      this.detail=null;
      this.dialog.close();
      this.page = workspacePage(button.dataset.page);
      if (button.dataset.page === "coverage") this.sourcesNeedsReview = true;
      if (button.dataset.page === "house") this.sourcesGrouping = "location";
      this.render();
      if (["configuration","notifications","policies"].includes(this.page) && !this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.settingsSection) {
      this.page = button.dataset.settingsSection==="notifications"||button.dataset.settingsSection==="alerts"?"notifications":button.dataset.settingsSection==="policies"?"policies":"configuration";
      if (this.page==="configuration") this.settingsSection = button.dataset.settingsSection;
      this.render();
      if (!this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.sourceLink) {this.detail=null; this.dialog.close(); this.sourcesMobileDetail=true; this.sourcesView="source"; this.resetSourceScroll=true; this.sourcesSelection = `source:${button.dataset.sourceLink}`; this.page = "sources"; this.revealSourcesSelection(); this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) this.openDetail({episodeId: button.dataset.episode});
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") {this.detail=null;this.dialog.close();}
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "retry-catalog") { this.store?.ensureCatalog(true); this.render(); }
    else if (button.dataset.action === "load-configuration") this.loadConfiguration();
  }

  keydown(event) {
    if (event.target.matches?.("[data-sources-toggle]") && ["ArrowLeft","ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const key = event.target.dataset.sourcesToggle;
      if (event.key === "ArrowRight") this.sourcesExpanded.add(key);
      else this.sourcesExpanded.delete(key);
      this.render();
      [...this.shadowRoot.querySelectorAll("[data-sources-toggle]")].find((item) => item.dataset.sourcesToggle === key)?.focus();
      return;
    }
  }

  openDetail(selection) {
    this.detail = selection;
    this.renderedDetailContent = null;
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
    body.inert = connectionStatus !== "current";
    if (connectionStatus !== "current") {
      this.shadowRoot.querySelector("#detail-label").textContent = this.renderedDetailContent && ["loading", "disconnected"].includes(connectionStatus) ? "Last known details · Reconnecting" : "Evidence unavailable";
      if (!this.renderedDetailContent || !["loading", "disconnected"].includes(connectionStatus)) {
        body.innerHTML = "<p>Current evidence is unavailable. Wait for monitoring to reconnect.</p>";
        this.renderedDetailContent = null;
      }
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
      this.renderedDetailContent = null;
      body.innerHTML = '<p>This issue is not in current issues or retained history. Its outcome cannot be determined here.</p><p><a href="/homeostatic/issues">Open Issues</a> · <a href="/homeostatic/history">Open History</a></p>';
      return;
    }
    const nodeId = episode?.anchor ?? selection.nodeId;
    try {
      const result = await this._hass.callWS({type: "homeostatic/node", node_id: nodeId});
      if (sequence !== this.detailSequence || !this.detail) return;
      const source = result.source;
      const nodes = sourceMap(data);
      const detailTitle = this.displaySourceName(source);
      this.shadowRoot.querySelector("#detail-title").textContent = detailTitle;
      this.shadowRoot.querySelector("#detail-label").textContent = source.kind === "situation" ? "Situation" : source.kind === "repair" ? "Home Assistant Repair" : source.kind === "broken_automation" ? "Broken automation" : episode ? "Open issue" : ({device:"Device",entity:"Entity",integration:"Integration"}[source.kind] || "Source");
      const currentFunctions = episode ? affectedFunctions(data, episode) : [];
      const diagnostic = episode ? null : diagnosticOverview(source, result, currentFunctions);
      const findings = result.explanation.findings;
      const problem = upsProblem(source,result.entity_status,Boolean(episode)) ?? repairProblem(source, findings) ?? brokenAutomationProblem(source, findings) ?? vacuumProblem(source, result.entity_status, data.areas, Boolean(episode)) ?? batteryProblem(source, result.entity_status, Boolean(episode)) ??
        deviceProblem(source, result.entity_status, Boolean(episode)) ??
        integrationProblem(source, episode?.reasons ?? findings, (key) => this._hass.localize?.(key), result.integration_evidence, Boolean(episode), nodes) ??
        entityProblem(source, result.entity_status, nodes.get(`entry:${source.owner_id}`), data.areas, (key) => this._hass.localize?.(key), Boolean(episode));

      const memberEvidence = result.device_evidence?.total ? result.device_evidence : null;
      const uncertainMembers = memberEvidence?.members.filter((member) => member.restored || ["unavailable", "missing"].includes(member.state)) ?? [];
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const relatedSources = relatedEvidenceDetails(problem?.relatedEvidence, expanded);
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      const integrationDomains = source.attributes?.integration_domain ?? [];
      const deviceIntegrations = [...new Set(integrationDomains.map((domain) => integrationProblem({kind:"integration",attributes:{domain:[domain]}},[],(key) => this._hass.localize?.(key)).integration))];
      const memberName = (member) => deviceEntityName(member.name, detailTitle);
      const memberState = (member) => member.restored ? "current state unknown" : member.state === "missing" ? "has no current state" : member.state === "unavailable" ? "unavailable in Home Assistant" : member.state;
      const issueTitle = uncertainMembers.length === 1 ? `${memberName(uncertainMembers[0])} ${memberState(uncertainMembers[0])}` : uncertainMembers.length || memberEvidence?.unknown_count || memberEvidence?.unavailable_count ? "Monitored entities need review" : episode ? "Confirming recovery" : "Selected entities available";
      const issueList = uncertainMembers.length > 1 ? `<ul class="problem-evidence">${uncertainMembers.map((member) => `<li><strong>${esc(memberName(member))}</strong> · ${esc(memberState(member))}</li>`).join("")}</ul>` : "";
      const deviceBrief = memberEvidence ? `<p class="problem-origin">${esc(deviceIntegrations.join(", ") || "Home Assistant device")}</p><h3 class="problem-status">${esc(issueTitle)}</h3>${issueList}${memberEvidence.members.length < memberEvidence.total ? `<p class="small">Showing ${memberEvidence.members.length} of ${memberEvidence.total} monitored entity readings.</p><button type="button" class="link" data-source-link="${esc(source.monitoring_source||source.node_id)}">View all entity readings in Sources</button>` : ""}` : "";
      const policyChoices=result.monitoring_policies?.length?result.monitoring_policies:source.monitoring_policy?[{id:source.monitoring_policy,name:"Edit monitoring policy"}]:[];
      const policyActions=`<section class="detail"><h3>Monitoring policies</h3><p>Change monitoring and notifications in the policy that watches this source.</p>${policyChoices.length?policyChoices.map(policy=>`<button class="button" type="button" data-definition-action="open-policy" data-definition-kind="policies" data-definition-id="${esc(policy.id)}">Edit policy: ${esc(policy.name)}</button>`).join(""):'<button class="button" type="button" data-definition-action="open-policy" data-definition-kind="policies" data-definition-id="">View policies</button>'}</section>`;
      const availabilityChoices = policyActions;
      const availabilityExplanation = episode && memberEvidence && uncertainMembers.length && result.device_availability?.status === "available" ? `<details ${disclosure("assessment")}><summary>Why does device availability say Available?</summary><p>Device availability uses enabled operational entities. This problem checks the ${memberEvidence.total} selected ${memberEvidence.total === 1 ? "entity" : "entities"}; ${uncertainMembers.length === 1 ? "one needs" : "some need"} attention. An available sibling does not clear an unavailable or missing entity.</p></details>` : "";
      const nativeLink = source.kind === "repair" || source.kind === "broken_automation" ? `<a class="button primary" href="${esc(source.fix_url)}">Fix in Home Assistant</a>` : source.kind === "device" ? "" : source.kind === "integration" && problem ? (problem.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : problem.relatedFindings.length ? `<a class="link" href="${esc(problem.integrationUrl)}">Open ${esc(problem.integration)} integration</a>` : "") : source.entity_id
        ? `<button class="button primary" type="button" data-entity="${esc(source.entity_id)}">${esc(problem?.entityLabel ?? "View in Home Assistant")}</button>`
        : source.entry_id || source.owner_id ? '<a class="button primary" href="/config/integrations">Review connection</a>' : "";
      const controls = (data.inventory.operator_controls ?? []).filter((control) => [episode?.episode_id, nodeId].includes(control.target));
      const genericSummary = source.kind === "situation" ? (episode ? "This reported condition remains open. Check its current state." : "No open problem is reported for this condition.")
        : result.readiness ? `${ownerStatus(result.readiness.answer)} in Home Assistant.` : "Current status has not been confirmed.";
      const content = `${episode && memberEvidence ? "" : deviceAvailability(result.device_availability)}<section class="detail problem-brief">${memberEvidence ? deviceBrief : problem ? `${source.kind === "integration" ? "" : `<p class="small">${esc(problem.context ?? problem.integration)}</p>`}<h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}
         <div class="next-action"><p>${memberEvidence ? uncertainMembers.length ? "Check the affected entity on the device page." : episode ? "Homeostatic is confirming the current states before clearing this problem." : "No action needed." : esc(problem?.nextStep ?? (nativeLink ? "Check the current state in Home Assistant." : "Check the listed requirements to find what needs attention."))}</p>${nativeLink || problem?.deviceUrl ? `<div class="actions">${nativeLink}${problem?.deviceUrl ? `<a class="button${memberEvidence ? " primary" : ""}" href="${esc(problem.deviceUrl)}">Open device page</a>` : ""}</div>` : ""}</div>
         ${episode ? `<p class="small problem-progress">Open since ${esc(date(episode.opened_at))} · ${esc(reportingStatus(data,episode))}</p>` : ""}</section>
         ${relatedSources}
         ${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}
         ${problem?.connectionNote ? `<section class="detail"><p>${esc(problem.connectionNote)}</p><button class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button></section>` : ""}
         ${diagnostic ? source.kind === "device" ? `<section class="detail evidence-overview" aria-label="Household impact"><h3>What this means at home</h3><p>${esc(diagnostic.impact)}</p></section>` : `<section class="detail evidence-overview" aria-label="Evidence summary"><h3>What Homeostatic knows</h3><dl><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd><dt>What is checked</dt><dd>${esc(diagnostic.checks)}</dd><dt>Current assessment</dt><dd>${esc(diagnostic.assessment)}</dd><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></dl></section>` : ""}
          ${["integration","device","entity","battery","vacuum","ups"].includes(source.kind) ? `<button type="button" class="button" data-source-link="${esc(source.monitoring_source||source.node_id)}">View in Sources</button>` : ""}
         ${controls.map((control) => `<p class="control-notice">${control.action === "shelve" ? "Alerts paused" : "Working on equipment"} until ${esc(date(control.until))}.</p>`).join("")}
        ${this.tools.detailButtons(source, episode, data)}
         ${availabilityExplanation}
         ${availabilityChoices}
        ${problem?.reported || problem?.missingDetail || problem?.logsUrl ? `<details ${disclosure("reported")}><summary>Details from Home Assistant</summary>
          ${problem?.reported ? `<div class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">From an earlier attempt; the current activity is shown above.</p>' : ""}<pre>${esc(problem.reported)}</pre></div>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : ""}
          ${problem?.logsUrl ? `<p><a class="button" href="${esc(problem.logsUrl)}">View integration logs</a></p>` : ""}
        </details>` : ""}`;
      const contentKey = content.replace(/(data-disclosure="[^"]+") open/g, "$1");
      if (contentKey === this.renderedDetailContent) return;
      body.innerHTML = content;
      this.renderedDetailContent = contentKey;
      body.querySelector("[data-entity]")?.addEventListener("click", (event) => {
        this.dialog.close();
        this.dispatchEvent(new CustomEvent("hass-more-info", {bubbles:true,composed:true,detail:{entityId:event.currentTarget.dataset.entity}}));
      });
    } catch (error) {
      if (sequence === this.detailSequence) {this.renderedDetailContent = null; body.innerHTML = `<p>${esc(error?.message ?? "Could not load current evidence.")}</p>`;}
    }
  }
}

class HomeostaticPanel extends HomeostaticCard {
  constructor() {
    super();
    this.navigation.enabled = true;
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
    const path=value?.path ?? "";
    if(path===this.haRoutePath)return;
    this.haRoutePath=path;
    this.navigation.applyPath(path);
  }

}

class HomeostaticStrategy {
  static getCreateSuggestions() { return {title:"Homeostatic",icon:"mdi:home-heart"}; }
  static async generate() {
    return {title:"Homeostatic",views:[
      {title:"Issues",path:"issues",type:"panel",cards:[{type:"custom:homeostatic-card-v22",view:"issues",navigation:false}]},
      {title:"Sources",path:"sources",type:"panel",cards:[{type:"custom:homeostatic-card-v22",view:"sources",navigation:false}]},
      {title:"Policies",path:"policies",type:"panel",cards:[{type:"custom:homeostatic-card-v22",view:"policies",navigation:false}]},
      {title:"Notifications",path:"notifications",type:"panel",cards:[{type:"custom:homeostatic-card-v22",view:"notifications",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v22")) customElements.define("homeostatic-card-v22", HomeostaticCard);
if (!customElements.get("homeostatic-panel-v26")) customElements.define("homeostatic-panel-v26", HomeostaticPanel);
if (!customElements.get("homeostatic-panel-v25")) customElements.define("homeostatic-panel-v25", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v21")) customElements.define("homeostatic-card-v21", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v24")) customElements.define("homeostatic-panel-v24", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v23")) customElements.define("homeostatic-panel-v23", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v22")) customElements.define("homeostatic-panel-v22", class extends HomeostaticPanel {});
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
  type:"homeostatic-card",name:"Homeostatic",description:"Live problems, locations and monitoring coverage.",
});
window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((item) => item.type === "homeostatic")) window.customStrategies.push({
  type:"homeostatic",strategyType:"dashboard",name:"Homeostatic",description:"A dashboard populated from Homeostatic monitoring.",
});
