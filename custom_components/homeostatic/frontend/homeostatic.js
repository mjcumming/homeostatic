import {notProvidedProblem} from "./entity-not-provided.mjs?v=99";
import {retainedProblem, sharedDeviceCondition} from "./check-presentation.mjs?v=99";
import {editReusable, namedPolicies, restoreMethodDialogs, scopedEditorFooter} from "./reusable-editors.mjs?v=99";
import {isTemperatureCheck, temperatureProblem} from "./source-temperature.mjs?v=99";
import {upsProblem} from "./ups.mjs?v=99";
import {issueConfiguration, issuePolicyChoices} from "./issue-configuration.mjs?v=99";
import {affectedFunctions, dashboardStore, editorEvidenceOnly, escapeHtml as esc, inventoryRows, sourceMap} from "./model.mjs?v=99";
import {deviceEntityName,entityReadingsStamp} from "./device-entities.mjs?v=99";
import {batteryProblem, brokenAutomationProblem, entityProblem, integrationProblem, repairProblem, vacuumProblem} from "./problem.mjs?v=99";
import {DashboardTools} from "./history-controls.mjs?v=99";
import {diagnosticOverview} from "./evidence.mjs?v=99";
import {styles} from "./styles.mjs?v=99";

import {sourcesBrowser, sourcesTree, sourcePaths, sourceForSelection, topomationTree, canonicalSourceSelection, editSourceAvailability, editSourcePolicies, restoreSourceFilters, restoreSourcePolicies} from "./sources-workspace.mjs?v=99";

import {installationSettings, editInstallation} from "./installation-settings.mjs?v=99";

import {cardView} from "./notification-navigation.mjs?v=99";
import {WorkspaceNavigation, workspacePage} from "./workspace-navigation.mjs?v=99";
import {initializeScopedConfiguration, rebaseScopedConfiguration, saveScopedConfiguration} from "./scoped-configuration.mjs?v=99";
import {connectPanelDrafts, disconnectPanelDrafts, renderPanelDrafts, resetCardDrafts} from "./panel-drafts.mjs?v=99";
import {issuesWorkspace, recordedIssueSources, relatedEvidenceDetails, relatedEvidenceMonitoring} from "./issues-workspace.mjs?v=99";
import {editIssueAvailability,issueAvailabilityAction,issueAvailabilityNeedsCatalog,renderIssueAvailability,resetIssueAvailability} from "./issue-monitoring.mjs?v=99";
import {editDeviceIssues,readDeviceIssues} from "./device-issues.mjs?v=99";
import {issueDeviceId} from "./device-issue-model.mjs?v=99";

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
    this.sourcesMonitoring = "all";
    this.sourcesView = "source";
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
    this.notificationIssueIds = null;
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
    this.shadowRoot.innerHTML = `<style>${styles}</style><div class="shell"><header class="header"><div class="header-line"><div class="brand">${icon("home-heart")}Homeostatic</div><div class="workspace-notifications"></div><button type="button" class="link workspace-settings" data-page="configuration">Settings</button></div><nav class="nav" aria-label="Homeostatic pages"><button type="button" data-page="problems">Open issues</button><button type="button" data-page="sources">Monitoring</button><button type="button" data-page="policies">Policies</button><button type="button" data-page="notifications">Notifications</button><button type="button" data-page="history">History</button></nav><button type="button" class="link workspace-return" data-workspace-return hidden>Back</button><button type="button" class="button" data-action="back" hidden>Back</button></header><p class="workspace-status note" role="status" hidden></p><main aria-live="polite"></main></div><dialog aria-labelledby="detail-title"><header class="dialog-head"><div><p class="small" id="detail-label"></p><h2 id="detail-title"></h2></div><button type="button" class="button" data-action="close" aria-label="Close detail">Close</button></header><div class="dialog-body"></div></dialog>`;
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
      if (editDeviceIssues(this,event)) return;
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
      if (event.target.matches?.("[data-sources-monitoring]")) {
        this.sourcesMonitoring = event.target.value;
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
    this.dialog.addEventListener("close", () => {if (!this.dialog.open) {this.detail = null; this.detailSequence++; resetIssueAvailability(this);}});
    this.dialog.addEventListener("cancel", event => {
      if(this.detail?.deviceId){event.preventDefault();this.closeDeviceDetail();return;}
      if(this.page === "problems" && this.notificationIssueIds) {
        event.preventDefault();
        const previous=this.navigation.capture();
        resetIssueAvailability(this);this.detail=null;this.dialog.close();
        this.navigation.finish(previous);return;
      }
      resetIssueAvailability(this);
    });
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
    const previous = this._hass;
    const changed = previous?.connection !== value.connection || previous?.user?.id !== value.user?.id || previous?.user?.is_admin !== value.user?.is_admin;
    this._hass = value;
    if (this.retainPanelDrafts && changed) this.configurationNeedsReload = connectPanelDrafts(this);
    else if (changed && previous) resetCardDrafts(this);
    if (changed) {
      this.release();
      this.connect();
    } else if (!this.removeListener) this.connect();
    else if (this.page === "sources" && this.sourceDetail?.members &&
      this.sourceDetail.readingsStamp!==entityReadingsStamp(this.sourceDetail.members,value.states)) this.loadSource();
  }

  connectedCallback() {
    if (this.retainPanelDrafts && this._hass) this.configurationNeedsReload = connectPanelDrafts(this) || this.configurationNeedsReload;
    this.navigation.connect(); this.connect();
  }
  disconnectedCallback() {
    this.sourcesFilterListeners?.abort();
    this.sourcesFiltersOpen=false;
    this.navigation.disconnect();
    this.release(false);
    disconnectPanelDrafts(this);
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
    this.sourceRequest = null;
    this.sourceRefreshPending = false;
    this.detailRequest = null;
    this.detailRefreshPending = false;
    this.dialog.close();
    this.detail = null;
    this.removeListener?.();
    this.removeListener = null;
    this.store = null;
    this.current = {status: "loading", data: clear ? null : this.current.data, error: null};
    this.detailSequence++;
  }

  invalidateReads() {
    this.sourceSequence++;
    this.sourceRequest=null;
    this.sourceRefreshPending=false;
    if(this.sourceDetail)this.sourceDetail={...this.sourceDetail,stamp:null,loading:false,moreLoading:false};
    this.detailSequence++;
    this.detailRequest=null;
    this.detailRefreshPending=false;
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
      if(value.status!=="current"&&this.current.status==="current")this.invalidateReads();
      const retainEditor=["policies","notifications","configuration"].includes(this.page)&&
        this.renderedCurrent&&this.renderedView===this.viewIdentity()&&!this.settingsBusy&&!this.configBusy&&!this.retainedSave&&
        editorEvidenceOnly(this.current,value);
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
      if(!retainEditor)this.render();
      if (value.status === "current" && (!this.configuration || this.configurationNeedsReload) && !this.configBusy && !this.settingsBusy) this.loadConfiguration();
      else if(value.status==="current" && this.configuration && !this.configBusy && !this.settingsBusy && typeof value.data.policy?.notifications_enabled==="boolean" && value.data.policy.notifications_enabled!==this.configuration.settings.notifications)this.loadConfiguration("rebase");
      if (this.pendingEpisode && value.status === "current") {
        const episodeId = this.pendingEpisode;
        this.pendingEpisode = null;
        this.openDetail({episodeId});
      } else if(this.pendingNode && value.status==="current") {
        const nodeId=this.pendingNode;this.pendingNode=null;this.openDetail({nodeId});
      } else if(this.pendingDeviceIssues && value.status==="current") {
        const deviceId=this.pendingDeviceIssues;this.pendingDeviceIssues=null;this.openDetail({deviceId});
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
    return this.page;
  }

  disclosures(root = this.main) {
    const occurrences = new Map();
    return [...root.querySelectorAll("details:not([data-config-group]):not(.config-advanced)")].map((details) => {
      const owner = `${details.closest(".coverage-attention") ? "attention:" : ""}${details.closest("[data-ui-key]")?.dataset.uiKey ?? ""}`;
      const label = details.querySelector(":scope > summary")?.textContent.trim() ?? "";
      const identity = `${owner}:${label}`;
      const count = occurrences.get(identity) ?? 0;
      occurrences.set(identity,count + 1);
      return [details,`${identity}:${count}`];
    });
  }

  capturePageState(root = this.main) {
    const known = new Set();
    const open = new Set();
    const disclosures = this.disclosures(root);
    for (const [details,key] of disclosures) {
      known.add(key);
      if (details.open) open.add(key);
    }
    const active = this.shadowRoot.activeElement;
    const focus = root.contains(active) ? {
      tag:active.tagName,
      attributes:[...active.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => [attribute.name,attribute.value]),
      disclosure:disclosures.find(([details]) => details.querySelector(":scope > summary") === active)?.[1],
      selection:typeof active.selectionStart === "number" ? [active.selectionStart,active.selectionEnd] : null,
    } : null;
    const scroll = [];
    for (let node = root; node; node = node.parentNode ?? node.getRootNode()?.host) {
      if (node.scrollTop || node.scrollLeft) scroll.push([node,node.scrollTop,node.scrollLeft]);
    }
    const innerScroll = [".config-rail",".config-detail",".locations",".policy-picker-options",".source-policy-dialog"].map((selector) => {
      const node = root.querySelector(selector);
      return [selector,node?.scrollTop ?? 0,node?.scrollLeft ?? 0];
    });
    return {known,open,focus,scroll,innerScroll};
  }

  restorePageState(state, root = this.main) {
    const disclosures = this.disclosures(root);
    for (const [details,key] of disclosures) {
      if (state.known.has(key)) details.open = state.open.has(key);
    }
    for (const [node,top,left] of state.scroll) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
    for (const [selector,top,left] of state.innerScroll) {
      const node = root.querySelector(selector);
      if (node) {
        node.scrollTop = selector === ".config-detail" && this.resetSourceScroll ? 0 : top;
        node.scrollLeft = left;
      }
    }
    if (state.focus?.disclosure) {
      disclosures.find(([,key]) => key === state.focus.disclosure)?.[0].querySelector(":scope > summary")?.focus({preventScroll:true});
    } else if (state.focus?.attributes.length) {
      const target = [...root.querySelectorAll(state.focus.tag.toLowerCase())].find((element) =>
        state.focus.attributes.every(([name,value]) => element.getAttribute(name) === value));
      target?.focus({preventScroll:true});
      if (state.focus.selection && target?.setSelectionRange) target.setSelectionRange(...state.focus.selection);
    }
  }

  render() {
    if (!renderPanelDrafts(this)) return;
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.renderPage();
      renderIssueAvailability(this);
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
    back.hidden = this.config.navigation !== false || this.page === this.config.view || Boolean(this.workspaceReturn);
    back.textContent = `← Back to ${{sources:"Monitoring",problems:"Open issues",history:"History",notifications:"Notifications",policies:"Policies",configuration:"Settings"}[this.config.view]}`;
    this.shadowRoot.querySelectorAll("[data-page]").forEach((button) => {
      if (button.closest(".nav")) {
        if (button.dataset.page === this.page) button.setAttribute("aria-current", "page");
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
      status.textContent = retained ? "Reconnecting. Showing the last completed update; changes are temporarily unavailable." : "";
    }
    this.main.inert = Boolean(retained);
    if (this.current.status !== "current" && !retained) {
      const messages = {
        loading: ["Loading dashboard", "Connecting to Home Assistant…"],
        disconnected: ["Connection lost", "Reconnecting to Home Assistant. Current status is unavailable."],
        unavailable: ["Monitoring unavailable", this.current.data?.error ? "Homeostatic reported an error. Check its configuration, storage and logs." : "Homeostatic is not running yet. This page updates when it is ready."],
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
    if ((["sources","policies"].includes(this.page)||this.page==="problems"&&!data.panel_context) && (data.catalog_stale || !data.catalog_loaded)) this.store?.ensureCatalog();
    if (this.page === "sources" && data.schema_version === 3 && !data.catalog_loaded) {
      this.main.innerHTML = `<div class="banner" role="status"><h2>${this.current.catalogError ? "Monitoring list unavailable" : "Loading monitoring list"}</h2><p>${esc(this.current.catalogError || "Loading your devices and entities…")}</p>${this.current.catalogError ? '<button class="link" type="button" data-action="retry-catalog">Retry loading sources</button>' : ""}</div>`;
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
      restoreSourceFilters(this);
      restoreSourcePolicies(this);
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
    const intro = this.definitionSelection?.kind === "policies" && this.settingsDraft?.monitoring_policies?.some(policy => policy.id === this.definitionSelection.id) ? "" : '<div class="intro"><h1>Monitoring policies</h1></div>';
    if (!this.configuration) return `${intro}<section class="panel"><div class="body"><p>${esc(this.configError ?? "Loading policies…")}</p>${this.configError ? '<button type="button" class="button" data-action="load-configuration">Try again</button>' : ""}</div></section>`;
    return `${intro}<section class="panel"><div class="body">${namedPolicies(this)}</div></section>`;
  }

  sourcesPage() {
    const intro = '<div class="intro"><div><h1>Monitoring</h1><p class="page-description">Devices, entities and integrations.</p></div></div>';
    const catalogStatus = this.current.data.catalog_stale
      ? `<p class="note" role="status">${this.current.catalogError ? `Source list update failed: ${esc(this.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry updating sources</button>` : "Updating sources. The list below may be out of date."}</p>`
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
    const paths = sourcePaths(sourcesTree(this.current.data,this.sourcesGrouping,this._hass?.localize||null,this.topomation));
    for (const {node,parents} of paths.values()) {
      if ([node.name,node.source?.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)) {
        for (const parent of parents) this.sourcesExpanded.add(parent.key);
      }
    }
  }

  async loadConfiguration() {
    if (this.configBusy) return;
    const hass = this._hass, session = this.panelDraftSession, userId = hass.user?.id, admin = hass.user?.is_admin;
    const current = () => this._hass.connection === hass.connection && this._hass.user?.id === userId && this._hass.user?.is_admin === admin && this.panelDraftSession === session;
    this.configBusy = true;
    this.configError = null;
    this.render();
    try {
      const result = await hass.callWS({type:"homeostatic/configuration",section:"settings"});
      if (!current()) return;
      const previous = this.configuration;
      const fresh = {...result,...Object.fromEntries(["delivery_targets","notification_people","notification_destinations","consumers"].filter(key=>previous && key in previous).map(key=>[key,previous[key]]))};
      if (this.scopedConfiguration) rebaseScopedConfiguration(this,fresh);
      else {
        this.configuration = fresh;
        this.settingsDraft = structuredClone(result.settings);
        initializeScopedConfiguration(this);
      }
      this.configurationNeedsReload = false;
    } catch (error) {
      if (current()) this.configError = error?.message ?? "Could not load configuration.";
    } finally {
      if (current()) {this.configBusy = false;this.render();}
    }
  }

  async loadDeliveryConfiguration(retry = false) {
    if (!this.configuration || this.deliveryBusy || !retry && this.configuration.delivery_targets) return;
    const hass = this._hass, connection = hass.connection, userId = hass.user?.id, admin = hass.user?.is_admin, session = this.panelDraftSession;
    const current = () => this._hass.connection === connection && this._hass.user?.id === userId && this._hass.user?.is_admin === admin && this.panelDraftSession === session;
    this.deliveryBusy = true;
    this.deliveryError = null;
    this.render();
    try {
      const result = await hass.callWS({type:"homeostatic/configuration",section:"delivery"});
      if (current() && this.configuration) Object.assign(this.configuration,result);
    } catch (error) {
      if (current()) this.deliveryError = error?.message ?? "Could not load notification destinations.";
    } finally {
      if (current()) {this.deliveryBusy = false;this.render();}
    }
  }

  async loadSource(force = false) {
    if (this.page !== "sources" || this.current.status !== "current") return;
    const nodeId = sourceForSelection(this.current.data,this.sourcesSelection)?.node_id;
    if (!nodeId) return;
    const updatedAt = this.current.data.updated_at;
    const previous = this.sourceDetail?.nodeId === nodeId ? this.sourceDetail : null;
    const stamp = `${updatedAt}:${entityReadingsStamp(previous?.members,this._hass.states)}`;
    if(this.sourceRequest) {
      if(force||this.sourceRequest.nodeId!==nodeId||this.sourceRequest.stamp!==stamp)this.sourceRefreshPending=true;
      return;
    }
    if (!force && this.sourceDetail?.nodeId === nodeId && this.sourceDetail.stamp === stamp) return;
    const sequence = ++this.sourceSequence;
    const request=this.sourceRequest={nodeId,stamp,connection:this._hass.connection,selection:this.sourcesSelection};
    const current=()=>sequence===this.sourceSequence&&this._hass.connection===request.connection&&this.page==="sources"&&this.current.status==="current"&&sourceForSelection(this.current.data,this.sourcesSelection)?.node_id===nodeId;
    this.sourceDetail = {...previous,nodeId,stamp,loading:true};
    try {
      const result = await this._hass.callWS({type:"homeostatic/source",node_id:nodeId});
      if (!current()) return;
      const readingsStamp=entityReadingsStamp(result.members,this._hass.states);
      this.sourceDetail = {...result,nodeId,stamp:`${updatedAt}:${readingsStamp}`,readingsStamp};
    } catch (error) {
      if (!current()) return;
      this.sourceDetail = {nodeId,stamp,error:error?.message || "Could not read this source."};
    } finally {
      if(this.sourceRequest===request) {
        if(!current()&&this.sourceDetail?.loading&&this.sourceDetail.nodeId===nodeId)this.sourceDetail=previous;
        this.sourceRequest=null;
        const pending=this.sourceRefreshPending;
        this.sourceRefreshPending=false;
        if(pending)this.loadSource(true);
      }
    }
    if (this.page === "sources") this.render();
  }

  async loadSourceMore() {
    const detail=this.sourceDetail;
    if(!detail || detail.loading || detail.moreLoading || this.sourceRequest || detail.next_offset == null || this.current.status!=="current")return;
    const sequence=this.sourceSequence,offset=detail.next_offset,updated=this.current.data.updated_at;
    const request=this.sourceRequest={nodeId:detail.nodeId,stamp:detail.stamp,connection:this._hass.connection};
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
    } finally {
      detail.moreLoading=false;
      if(this.sourceRequest===request) {
        this.sourceRequest=null;
        const pending=this.sourceRefreshPending;
        this.sourceRefreshPending=false;
        if(pending)this.loadSource(true);
      }
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
    if (source && isTemperatureCheck(source)) {
      source = inventoryRows(this.current.data).find(item => item.kind === "entity" && source.entity_id && item.entity_id === source.entity_id) || source;
    }
    if (source?.kind !== "integration") return source?.name ?? "Monitored source";
    const provider = integrationProblem(source,[],(key) => this._hass.localize?.(key)).integration;
    if (provider.toLocaleLowerCase().includes(source.name.toLocaleLowerCase())) return provider;
    return provider === "Home Assistant" || source.name.toLocaleLowerCase().includes(provider.toLocaleLowerCase())
      ? source.name : `${provider} · ${source.name}`;
  }

  issueRow(data, episode, nodes, deviceGroup = null, {interactive = true} = {}) {
    const source = nodes.get(episode.anchor);
    const situation = source?.kind === "situation";
    const currentProblem = notProvidedProblem(source,data.inventory.entity_status?.[episode.anchor]) ?? temperatureProblem(source,data.inventory.entity_status?.[episode.anchor]) ?? upsProblem(source,data.inventory.ups_status?.[episode.anchor]) ?? repairProblem(source, episode.reasons) ?? brokenAutomationProblem(source, episode.reasons) ?? vacuumProblem(source, data.inventory.entity_status?.[episode.anchor], data.areas) ?? batteryProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
      integrationProblem(source, episode.reasons, (key) => this._hass.localize?.(key), data.inventory.integration_evidence?.[episode.anchor], true, nodes) ??
      entityProblem(source, data.inventory.entity_status?.[episode.anchor], nodes.get(`entry:${source?.owner_id}`), data.areas, (key) => this._hass.localize?.(key));
    const problem = retainedProblem(currentProblem,data.inventory.entity_status?.[episode.anchor],episode.reasons);
    const tone = situation ? "situation" : problem?.tone ?? "uncertain";
    const importance = ["high","critical"].includes(episode.importance) ? episode.importance === "critical" ? "Critical" : "Important" : null;
    const evidence = source?.kind === "integration" && problem?.currentReason === "loaded" ? problem.relatedEvidence : null;
    const device = evidence?.groups.length === 1 && evidence.groups[0].deviceId ? evidence.groups[0] : null;
    const onlyMember = source?.kind === "device" && source.availability_entities?.length === 1
      ? [...nodes.values()].find(item => item.entity_id === source.availability_entities[0]) : null;
    const fullMemberName = onlyMember?.name ?? null;
    const canonical = nodes.get(source?.monitoring_source) || source;
    const sourceName = device?.name || this.displaySourceName(canonical);
    const shortName = deviceGroup && sourceName.startsWith(`${deviceGroup.name} `) ? sourceName.slice(deviceGroup.name.length + 1) : sourceName;
    const findingType = source?.kind === "device" ? "Entity availability"
      : source?.kind === "integration" ? "Related findings"
      : source && isTemperatureCheck(source) ? "Temperature"
      : {battery:"Battery",vacuum:"Vacuum",ups:"UPS"}[source?.kind] || (source?.kind === "entity" ? problem?.context?.split(" · ")[0] : null) || "Finding";
    const title = deviceGroup ? source?.kind === "integration" ? "Availability" : source?.kind === "device" || sourceName === deviceGroup.name ? findingType : shortName : sourceName;
    const memberName = fullMemberName?.startsWith(`${sourceName} `) ? fullMemberName.slice(sourceName.length + 1) : fullMemberName;
    const deviceCondition = source?.kind === "device" ? {
      incomplete_evidence:memberName ? `${memberName} has no current value` : "Selected entities have no current value",
      some_unavailable:memberName ? `${memberName} is unavailable` : "Some selected entities are unavailable",
      all_unavailable:memberName ? `${memberName} is unavailable` : "All selected entities are unavailable",
      connectivity_disconnected:"Connection reports disconnected",
    }[problem?.currentReason] : null;
    const groupedDeviceCondition = deviceGroup && source?.kind === "device" ? {incomplete_evidence:"Monitored entities have no current value",some_unavailable:"Some monitored entities are unavailable",all_unavailable:"All monitored entities are unavailable"}[problem?.currentReason] : null;
    const condition = device && evidence.unavailableOnly && evidence.counts.entities
      ? `${evidence.counts.entities} ${evidence.counts.entities === 1 ? "entity" : "entities"} unavailable`
      : sharedDeviceCondition(data,episode,problem) ?? groupedDeviceCondition ?? deviceCondition ?? problem?.headline ?? "Current condition needs review";
    const opened = new Date(episode.opened_at).toLocaleString(undefined, {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    const redundantTitle = !interactive && deviceGroup && source?.kind === "entity" && sourceName === deviceGroup.name;
    const copy = `<span class="issue-copy">${redundantTitle ? "" : `<strong class="issue-title">${esc(title)}</strong>`}<span class="issue-condition">${esc(condition)}</span><span class="small">${importance ? `${esc(importance)} · ` : ""}Since ${esc(opened)}</span></span>`;
    if (!interactive) return `<div class="issue-row issue-finding ${esc(tone)}" data-ui-key="issue:${esc(episode.episode_id)}">${copy}</div>`;
    return `<button type="button" class="issue-row ${esc(tone)}" data-ui-key="issue:${esc(episode.episode_id)}" data-episode="${esc(episode.episode_id)}"${deviceGroup ? ` aria-label="${esc(`${deviceGroup.name}: ${title}. ${condition}. ${importance ? `${importance}. ` : ""}Since ${opened}. Open issue`)}"` : ""}>${copy}<span class="issue-open">Open</span></button>`;
  }

  issuesPage() { return issuesWorkspace(this); }


  history(data) {
    return `<div class="intro"><div><h1>History</h1></div></div>${this.tools.historyPanel(data)}`;
  }

  clicked(event) {
    if(this.detail?.deviceId&&event.target.closest?.('[data-action="close"]')){this.closeDeviceDetail();return;}
    if (event.target.closest?.("[data-workspace-return]")) {this.navigation.back();return;}
    const previous = this.navigation.capture();
    try {this.handleClick(event);} finally {this.navigation.finish(previous);}
  }

  handleClick(event) {
    if(editDeviceIssues(this,event))return;
    const allIssues = event.target.closest?.("a[data-all-issues]");
    if(allIssues) {
      if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();this.notificationIssueIds=null;this.issueQuery="";this.render();return;
    }
    const sourceView=event.target.closest?.("a[data-sources-view]");
    if(sourceView) {
      if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();this.sourcesView=sourceView.dataset.sourcesView;this.render();
      this.shadowRoot.querySelector(this.sourcesView==="history"?"#source-history-title":"[data-sources-view]")?.focus({preventScroll:true});
      return;
    }
    if (editIssueAvailability(this,event)) return;
    if (event.target.matches?.("[data-availability-select]")) return;
    if (editSourceAvailability(this,event)) return;
    if (editSourcePolicies(this,event)) return;
    if (editInstallation(this,event)) return;
    const button = event.target.closest("button");
    if (!button) return;
    if(button.dataset.deviceIssues){this.openDetail({deviceId:button.dataset.deviceIssues});return;}
    if (button.dataset.action === "retry-issue-configuration") {void this.loadConfiguration().then(()=>this.loadDetail());return;}
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
      this.sourcesView = "source";
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
      if(this.page === "problems")this.notificationIssueIds=null;
      if (button.dataset.configureMonitoring!==undefined) {this.definitionSelection=null;this.policyCreating=false;this.policyPicker=null;}
      if (button.closest(".nav")) {
        if (["policies","notifications"].includes(this.page)) {this.definitionSelection=null;this.policyCreating=false;this.policyPicker=null;}
        if (this.page === "sources") this.sourcesMobileDetail=false;
      }
      if (button.dataset.page === "coverage") this.sourcesNeedsReview = true;
      if (button.dataset.page === "house") this.sourcesGrouping = "location";
      this.render();
      if (["configuration","notifications","policies"].includes(this.page) && !this.configuration) this.loadConfiguration();
    }
    else if (button.dataset.sourceLink) {this.detail=null; this.dialog.close(); this.sourcesMobileDetail=true; this.sourcesView="source"; this.resetSourceScroll=true; this.sourcesSelection = `source:${button.dataset.sourceLink}`; this.page = "sources"; this.revealSourcesSelection(); this.render();}
    else if (button.dataset.node) this.openDetail({nodeId: button.dataset.node});
    else if (button.dataset.episode) {
      const episode = this.current.data?.inventory.episodes.find(item => item.episode_id === button.dataset.episode);
      const deviceId = !(this.page === "problems" && this.notificationIssueIds) && episode && issueDeviceId(this.current.data, episode);
      this.openDetail(deviceId ? {deviceId} : {episodeId: button.dataset.episode});
    }
    else if (button.dataset.action === "back") {this.page = this.config.view; this.render();}
    else if (button.dataset.action === "close") {if(this.detail?.deviceId&&this.deviceIssues?.busy)return;resetIssueAvailability(this);this.detail=null;this.dialog.close();}
    else if (button.dataset.action === "retry") this.store?.retry();
    else if (button.dataset.action === "retry-catalog") { this.store?.ensureCatalog(true); this.render(); }
    else if (button.dataset.action === "load-configuration") this.loadConfiguration();
  }

  keydown(event) {
    if (event.key === "Escape" && event.target.closest?.(".policy-picker")) {
      event.preventDefault();
      this.main.querySelector('[data-definition-action="finish-pick"]')?.click();
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
  }

  openDetail(selection) {
    resetIssueAvailability(this);
    this.deviceIssues=null;
    this.deviceIssueContext=null;
    this.detail = selection;
    this.renderedDetailContent = null;
    this.shadowRoot.querySelector("#detail-title").textContent = "Problem details";
    this.shadowRoot.querySelector("#detail-label").textContent = "Current status";
    this.shadowRoot.querySelector(".dialog-body").innerHTML = "<p>Loading current status…</p>";
    if (!this.dialog.open) this.dialog.showModal();
    this.loadDetail();
  }

  closeDeviceDetail() {
    if(this.deviceIssues?.busy)return;
    if(this.navigation.back())return;
    const previous=this.navigation.capture();
    resetIssueAvailability(this);this.detail=null;this.dialog.close();
    this.navigation.finish(previous);
  }

  async loadDetail() {
    if(!this.detail||this.current.status!=="current")return this.readDetail();
    if(this.detailRequest) {
      if(this.detailRequest.selection!==this.detail||this.detailRequest.data!==this.current.data)this.detailRefreshPending=true;
      return;
    }
    const request=this.detailRequest={selection:this.detail,data:this.current.data};
    try {
      await this.readDetail();
    } finally {
      if(this.detailRequest===request) {
        this.detailRequest=null;
        const pending=this.detailRefreshPending;
        this.detailRefreshPending=false;
        if(pending&&this.detail&&this.current.status==="current")this.loadDetail();
      }
    }
  }

  async readDetail() {
    const sequence = ++this.detailSequence;
    const body = this.shadowRoot.querySelector(".dialog-body");
    const selection = this.detail;
    if (!selection) return;
    const connection=this._hass?.connection;
    const current=()=>sequence===this.detailSequence&&this.detail===selection&&this._hass?.connection===connection&&this.current.status==="current";
    const {status: connectionStatus, data} = this.current;
    body.inert = connectionStatus !== "current";
    if (connectionStatus !== "current") {
      this.shadowRoot.querySelector("#detail-label").hidden = false;
      this.shadowRoot.querySelector("#detail-label").textContent = this.renderedDetailContent && ["loading", "disconnected"].includes(connectionStatus) ? "Last known details · Reconnecting" : "Evidence unavailable";
      if (!this.renderedDetailContent || !["loading", "disconnected"].includes(connectionStatus)) {
        body.innerHTML = "<p>Current evidence is unavailable. Wait for monitoring to reconnect.</p>";
        this.renderedDetailContent = null;
      }
      return;
    }
    const episode = selection.episodeId ? data.inventory.episodes.find((item) => item.episode_id === selection.episodeId) : null;
    if (selection.episodeId && !episode) {
      if (this.issueAvailabilityEpisode === selection.episodeId) {
        const label = this.shadowRoot.querySelector("#detail-label");
        label.hidden = false;
        label.textContent = "Issue no longer current";
        if (!this.dialog.querySelector(".issue-availability")) {
          body.innerHTML = issueAvailabilityAction(this, {episode_id: selection.episodeId});
        }
        renderIssueAvailability(this);
        return;
      }
      const retained = data.inventory.resolved_history?.episodes.some((item) => item.episode.episode_id === selection.episodeId);
      if(this.page === "problems" && this.notificationIssueIds) {
        this.shadowRoot.querySelector("#detail-label").hidden = false;
        this.shadowRoot.querySelector("#detail-label").textContent = "Issue no longer current";
        this.renderedDetailContent = null;
        body.innerHTML = `<p>This included issue is no longer open.</p>${retained ? `<button type="button" class="button" data-history="${esc(selection.episodeId)}">View issue history</button>` : "<p>Its outcome is not available in retained history.</p>"}`;
        return;
      }
      if (retained) {
        this.page = "history";
        this.render();
        this.tools.showHistory(selection.episodeId);
        return;
      }
      this.shadowRoot.querySelector("#detail-label").hidden = false;
      this.shadowRoot.querySelector("#detail-label").textContent = "History unavailable";
      this.renderedDetailContent = null;
      body.innerHTML = '<p>This issue is not in current issues or retained history. Its outcome cannot be determined here.</p><p><a href="/homeostatic/issues">Open issues</a> · <a href="/homeostatic/history">Open History</a></p>';
      return;
    }
    if(issueAvailabilityNeedsCatalog(this,episode))this.store?.ensureCatalog();
    const nodeId = episode?.anchor ?? selection.nodeId;
    try {
      if(selection.deviceId){await readDeviceIssues(this,current);return;}
      const result = await this._hass.callWS({type: "homeostatic/node", node_id: nodeId});
      if (!current()) return;
      const source = result.source;
      const nodes = sourceMap(data);
      let coverage=result.monitoring_policies||[],coverageUnavailable=false;
      if(episode&&source.entity_id) {
        const canonical=inventoryRows(data).find(item=>item.kind==="entity"&&item.entity_id===source.entity_id&&!item.monitoring_policy);
        try {
          const context=await this._hass.callWS({type:"homeostatic/source",node_id:canonical?.node_id||source.monitoring_source||source.node_id});
          coverage=context.monitoring_policies||[];
        } catch {coverageUnavailable=true;}
        if(!current())return;
      }
      coverage=issuePolicyChoices(this,[source,...(episode?.reasons||[]).map(finding=>nodes.get(finding.node_id))],coverage);
      const detailTitle = this.displaySourceName(source);
      this.shadowRoot.querySelector("#detail-title").textContent = detailTitle;
      this.shadowRoot.querySelector("#detail-label").textContent = source.kind === "situation" ? "Situation" : source.kind === "repair" ? "Home Assistant Repair" : source.kind === "broken_automation" ? "Broken automation" : episode ? "Open issue" : ({device:"Device",entity:"Entity",integration:"Integration"}[source.kind] || "Source");
      const currentFunctions = episode ? affectedFunctions(data, episode) : [];
      const diagnostic = episode ? null : diagnosticOverview(source, result, currentFunctions);
      const findings = result.explanation.findings;
      const temperature = temperatureProblem(source,result.entity_status,result.temperature_status,Boolean(episode));
      const currentProblem = notProvidedProblem(source,result.entity_status,Boolean(episode)) ?? temperature ?? upsProblem(source,result.entity_status,Boolean(episode)) ?? repairProblem(source, findings) ?? brokenAutomationProblem(source, findings) ?? vacuumProblem(source, result.entity_status, data.areas, Boolean(episode)) ?? batteryProblem(source, result.entity_status, Boolean(episode)) ??
        integrationProblem(source, episode?.reasons ?? findings, (key) => this._hass.localize?.(key), result.integration_evidence, Boolean(episode), nodes) ??
        entityProblem(source, result.entity_status, nodes.get(`entry:${source.owner_id}`), data.areas, (key) => this._hass.localize?.(key), Boolean(episode));

      const problem = retainedProblem(currentProblem,result.entity_status,(episode?.reasons || findings).filter(item=>item.node_id === source.node_id));
      const expanded = new Set([...body.querySelectorAll("details[open][data-disclosure]")].map((item) => item.dataset.disclosure));
      const compactIssue = Boolean(episode && source.kind === "integration" && problem?.currentReason === "loaded" && problem.relatedEvidence.groups.length);
      const singleDevice = compactIssue && problem.relatedEvidence.groups.length === 1 && problem.relatedEvidence.groups[0].deviceId;
      const affectedDevice = singleDevice ? problem.relatedEvidence.groups[0] : null;
      if (compactIssue && !affectedDevice) this.shadowRoot.querySelector("#detail-title").textContent = "Entity availability";
      if (affectedDevice) this.shadowRoot.querySelector("#detail-title").textContent = affectedDevice.name;
      this.shadowRoot.querySelector("#detail-label").hidden = true;
      const relatedSources = relatedEvidenceDetails(problem?.relatedEvidence, {singleDevice:Boolean(singleDevice)});
      const disclosure = (key) => `data-disclosure="${key}"${expanded.has(key) ? " open" : ""}`;
      const policyActions=issueConfiguration(this,coverage,{unavailable:coverageUnavailable});
      const monitoringDetails = `${problem?.relatedEvidence?.groups.length ? relatedEvidenceMonitoring(problem.relatedEvidence) : ""}${episode ? recordedIssueSources(data,episode,problem?.relatedEvidence) : ""}`;
      const nativeLink = source.kind === "repair" || source.kind === "broken_automation" ? `<a class="button primary" href="${esc(source.fix_url)}">Fix in Home Assistant</a>` : source.kind === "device" ? "" : source.kind === "integration" && problem ? (problem.needsAction ? `<a class="button primary" href="${esc(problem.integrationUrl)}">${esc(problem.integrationLabel)}</a>` : problem.relatedFindings.length ? `<a class="link" href="${esc(problem.integrationUrl)}">Open ${esc(problem.integration)} integration</a>` : "") : source.entity_id
        ? `<button class="button primary" type="button" data-entity="${esc(source.entity_id)}">Open Entity</button>`
        : source.entry_id || source.owner_id ? '<a class="button primary" href="/config/integrations">Review connection</a>' : "";
      const genericSummary = source.kind === "situation" ? (episode ? "This reported condition remains open. Check its current state." : "No open problem is reported for this condition.")
        : result.readiness ? `${ownerStatus(result.readiness.answer)} in Home Assistant.` : "Current status has not been confirmed.";
      const compactHeadline = affectedDevice && problem.relatedEvidence.unavailableOnly && problem.relatedEvidence.counts.entities
        ? `${problem.relatedEvidence.counts.entities} ${problem.relatedEvidence.counts.entities === 1 ? "entity" : "entities"} unavailable`
        : problem?.headline;
      const opened = episode ? `<dl class="source-facts issue-facts problem-progress"><div class="source-fact"><dt>Opened</dt><dd>${esc(date(episode.opened_at))}</dd></div></dl>` : "";
      const sharedScope = compactIssue && problem.relatedEvidence.groups.length > 1 ? '<p class="small">Acknowledge and pause apply to the entire issue.</p>' : "";
      const controls = sharedScope + this.tools.detailButtons(source,episode,data) + (episode ? issueAvailabilityAction(this,episode) : "");
      const deviceId=source.attributes?.device?.[0];
      const deviceUrl=problem?.deviceUrl||(deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:null);
      const deviceAction = deviceUrl ? `<a class="button${nativeLink?"":" primary"}" href="${esc(deviceUrl)}">Open Device</a>` : "";
      const primaryAction = nativeLink + deviceAction;
      const reportedDetails = problem?.reported ? `<section class="reported-error"><h3>${problem.historical ? "Last reported error" : "Reported error"}</h3>${problem.reportedAt ? `<p class="small">${esc(date(problem.reportedAt))}</p>` : ""}${problem.historical ? '<p class="small">Reported earlier; recovery has not been confirmed.</p>' : ""}<pre>${esc(problem.reported)}</pre></section>` : problem?.missingDetail ? "<p>Home Assistant did not report a specific cause.</p>" : "";
      const navigation = problem?.logsUrl ? `<div class="issue-detail-links"><a href="${esc(problem.logsUrl)}">View integration logs</a></div>` : "";
      const details = (contents) => contents ? episode ? `<section class="issue-supporting">${contents}</section>` : `<details class="issue-disclosure" ${disclosure("issue-details")}><summary>Details</summary>${contents}</details>` : "";
      const temperatureContent = temperature && episode ? `<section class="detail problem-brief temperature-issue"><h3 class="problem-headline">${esc(temperature.headline)}</h3><p>${esc(temperature.summary)}</p>${temperature.timing ? `<p>${esc(temperature.timing)}.</p>` : ""}${temperature.detail ? `<p>${esc(temperature.detail)}.</p>` : ""}${opened}${primaryAction?`<div class="actions issue-native-actions">${primaryAction}</div>`:""}</section>${controls}${policyActions}${details(monitoringDetails)}` : null;
      const supporting = `${problem?.nextStep && source.kind !== "entity" ? `<p>${esc(problem.nextStep)}</p>` : ""}${problem?.connectionNote ? `<p>${esc(problem.connectionNote)}</p><button type="button" class="link" data-node="${esc(problem.connectionNode)}">${esc(problem.connectionLabel)}</button>` : ""}${diagnostic ? `<dl class="source-facts"><div class="source-fact"><dt>Monitoring</dt><dd>${esc(diagnostic.monitoring)}</dd></div><div class="source-fact"><dt>Checks</dt><dd>${esc(diagnostic.checks)}</dd></div><div class="source-fact"><dt>Assessment</dt><dd>${esc(diagnostic.assessment)}</dd></div><div class="source-fact"><dt>Household impact</dt><dd>${esc(diagnostic.impact)}</dd></div></dl>` : ""}${monitoringDetails}${reportedDetails}${navigation}`;
      const content = temperatureContent ?? (compactIssue ? `<section class="detail problem-brief compact-issue"><h3 class="problem-headline">${esc(compactHeadline)}</h3>${opened}${affectedDevice ? `<div class="actions"><a class="button primary" href="/config/devices/device/${encodeURIComponent(affectedDevice.deviceId)}">Open Device</a></div>` : ""}</section>${relatedSources}${controls}${policyActions}${details(`${monitoringDetails}<div class="issue-detail-links"><a href="${esc(problem.integrationUrl)}">Open integration</a>${problem.logsUrl ? `<a href="${esc(problem.logsUrl)}">View integration logs</a>` : ""}</div>`)}` : `<section class="detail problem-brief">${problem ? `<h3 class="problem-headline">${esc(problem.headline)}</h3><p>${esc(problem.summary)}</p>` : `<p>${esc(genericSummary)}</p>`}${opened}${primaryAction ? `<div class="actions issue-native-actions">${primaryAction}</div>` : ""}</section>${relatedSources}${controls}${currentFunctions.length ? `<section class="detail"><h3>What is affected</h3><ul>${currentFunctions.map((item) => `<li><strong>${esc(item.name)}</strong> · ${esc(ownerStatus(item.readiness.answer))}</li>`).join("")}</ul></section>` : ""}${policyActions}${details(supporting)}`);
      const contentKey = content.replace(/(data-disclosure="[^"]+") open/g, "$1");
      if (contentKey === this.renderedDetailContent) return;
      const detailState = this.capturePageState(body);
      body.innerHTML = content;
      this.restorePageState(detailState,body);
      this.renderedDetailContent = contentKey;
      body.querySelector("[data-entity]")?.addEventListener("click", (event) => {
        this.dialog.close();
        this.dispatchEvent(new CustomEvent("hass-more-info", {bubbles:true,composed:true,detail:{entityId:event.currentTarget.dataset.entity}}));
      });
    } catch (error) {
      if (current()) {this.renderedDetailContent = null; body.innerHTML = `<p>${esc(error?.message ?? "Could not load current evidence.")}</p>`;}
    }
  }
}

class HomeostaticPanel extends HomeostaticCard {
  constructor() {
    super();
    this.retainPanelDrafts = true;
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
      {title:"Open issues",path:"issues",type:"panel",cards:[{type:"custom:homeostatic-card-v47",view:"issues",navigation:false}]},
      {title:"Monitoring",path:"sources",type:"panel",cards:[{type:"custom:homeostatic-card-v47",view:"sources",navigation:false}]},
      {title:"Policies",path:"policies",type:"panel",cards:[{type:"custom:homeostatic-card-v47",view:"policies",navigation:false}]},
      {title:"Notifications",path:"notifications",type:"panel",cards:[{type:"custom:homeostatic-card-v47",view:"notifications",navigation:false}]},
      {title:"History",path:"history",type:"panel",cards:[{type:"custom:homeostatic-card-v47",view:"history",navigation:false}]},
    ]};
  }
}

if (!customElements.get("homeostatic-card-v47")) customElements.define("homeostatic-card-v47", HomeostaticCard);
if (!customElements.get("homeostatic-card-v46")) customElements.define("homeostatic-card-v46", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v45")) customElements.define("homeostatic-card-v45", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v44")) customElements.define("homeostatic-card-v44", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v43")) customElements.define("homeostatic-card-v43", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v42")) customElements.define("homeostatic-card-v42", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v41")) customElements.define("homeostatic-card-v41", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v40")) customElements.define("homeostatic-card-v40", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v39")) customElements.define("homeostatic-card-v39", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v38")) customElements.define("homeostatic-card-v38", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-card-v37")) customElements.define("homeostatic-card-v37", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v51")) customElements.define("homeostatic-panel-v51", HomeostaticPanel);
if (!customElements.get("homeostatic-panel-v50")) customElements.define("homeostatic-panel-v50", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v49")) customElements.define("homeostatic-panel-v49", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v48")) customElements.define("homeostatic-panel-v48", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v47")) customElements.define("homeostatic-panel-v47", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v46")) customElements.define("homeostatic-panel-v46", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v45")) customElements.define("homeostatic-panel-v45", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v44")) customElements.define("homeostatic-panel-v44", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v43")) customElements.define("homeostatic-panel-v43", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-panel-v42")) customElements.define("homeostatic-panel-v42", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v30")) customElements.define("homeostatic-card-v30", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v34")) customElements.define("homeostatic-panel-v34", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v29")) customElements.define("homeostatic-card-v29", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v33")) customElements.define("homeostatic-panel-v33", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v28")) customElements.define("homeostatic-card-v28", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v32")) customElements.define("homeostatic-panel-v32", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v27")) customElements.define("homeostatic-card-v27", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v31")) customElements.define("homeostatic-panel-v31", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v26")) customElements.define("homeostatic-card-v26", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v30")) customElements.define("homeostatic-panel-v30", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v25")) customElements.define("homeostatic-card-v25", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v29")) customElements.define("homeostatic-panel-v29", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v24")) customElements.define("homeostatic-card-v24", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v28")) customElements.define("homeostatic-panel-v28", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v23")) customElements.define("homeostatic-card-v23", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v27")) customElements.define("homeostatic-panel-v27", class extends HomeostaticPanel {});
if (!customElements.get("homeostatic-card-v22")) customElements.define("homeostatic-card-v22", class extends HomeostaticCard {});
if (!customElements.get("homeostatic-panel-v26")) customElements.define("homeostatic-panel-v26", class extends HomeostaticPanel {});
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
