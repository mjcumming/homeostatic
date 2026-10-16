const pageAliases = {overview:"problems", issues:"problems", settings:"configuration", house:"sources", coverage:"sources", functions:"problems"};
export const workspacePage = page => pageAliases[page] || page || "problems";

const decode = value => {try {return decodeURIComponent(value);} catch {return null;}};

/** Keep meaningful destinations in the URL; filters and expansion are view state. */
export function parseWorkspacePath(path = "") {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if(parts[0] === "homeostatic")parts.shift();
  const [name,encoded,extra] = parts;
  const id = encoded ? decode(encoded) : null;
  if(name === "episode" && id)return {page:"problems",detail:{episodeId:id}};
  if(name === "node" && id)return {page:"sources",detail:{nodeId:id}};
  if(name === "history")return {page:"history",historyId:id};
  if(name === "sources")return {page:"sources",source:id,sourcesView:extra === "history" ? "history" : "source"};
  if(name === "policies")return {page:"policies",definition:id ? {kind:"policies",id} : null};
  if(name === "notifications") {
    if(encoded === "policies")return {page:"policies",definition:extra&&decode(extra)?{kind:"policies",id:decode(extra)}:null};
    const kind=encoded === "methods"?"methods":"profiles", identity=extra?decode(extra):null;
    return {page:"notifications",notificationSection:kind,definition:identity?{kind,id:identity}:null};
  }
  if(name === "settings")return {page:"configuration"};
  return {page:"problems"};
}

export function workspacePath(route) {
  const encode = encodeURIComponent;
  if(route.detail?.episodeId)return `/episode/${encode(route.detail.episodeId)}`;
  if(route.detail?.nodeId)return `/node/${encode(route.detail.nodeId)}`;
  const page = workspacePage(route.page);
  if(page === "sources")return `/sources${route.source ? `/${encode(route.source)}` : ""}${route.source && route.sourcesView === "history" ? "/history" : ""}`;
  if(page === "policies")return `/policies${route.definition?.kind === "policies" ? `/${encode(route.definition.id)}` : ""}`;
  if(page === "notifications") {
    if(["profiles","methods"].includes(route.definition?.kind))return `/notifications/${route.definition.kind}/${encode(route.definition.id)}`;
    return route.notificationSection === "methods"?"/notifications/methods":"/notifications";
  }
  if(page === "history")return `/history${route.historyId ? `/${encode(route.historyId)}` : ""}`;
  if(page === "configuration")return "/settings/timing";
  return "/issues";
}

export function workspaceRoute(card) {
  const page = workspacePage(card.page);
  return {
    page,
    source:page === "sources" ? card.sourcesSelection : null,
    sourcesView:card.sourcesView,
    definition:page === "policies" && card.definitionSelection?.kind === "policies" || page === "notifications" && ["profiles","methods"].includes(card.definitionSelection?.kind) ? card.definitionSelection : null,
    notificationSection:card.notificationSection || "profiles",
    historyId:page === "history" ? card.tools?.historyId || null : null,
    detail:card.detail ? {...card.detail} : null,
  };
}

const viewFields = ["sourcesQuery","sourcesGrouping","sourcesNeedsReview","sourcesShowDisabled","sourcesExcludedOnly","sourcesMonitoring","sourcesMobileDetail","issueQuery","issueSort","notificationSection"];
const setFields = ["sourcesExpanded","issueGroupsExpanded"];
const mapFields = ["sourcesLimits","issueGroupLimits"];

export function hasWorkspaceDrafts(card) {
  if(!card.configuration)return false;
  return Boolean(card.settingsDraft && JSON.stringify(card.settingsDraft)!==JSON.stringify(card.configuration.settings));
}

export function workspaceContext(card) {
  return {
    ...Object.fromEntries(viewFields.map(key => [key,card[key]])),
    ...Object.fromEntries(setFields.map(key => [key,[...(card[key] || [])]])),
    ...Object.fromEntries(mapFields.map(key => [key,[...(card[key] || new Map())]])),
    history:card.tools ? {query:card.tools.query,resolution:card.tools.resolution,page:card.tools.page} : null,
  };
}

/** Restore views without touching configuration drafts or mutating Home Assistant. */
export function restoreWorkspaceContext(card,context = {}) {
  for(const key of viewFields)if(context[key] !== undefined)card[key] = context[key];
  for(const key of setFields)if(context[key])card[key] = new Set(context[key]);
  for(const key of mapFields)if(context[key])card[key] = new Map(context[key]);
  if(context.history && card.tools)Object.assign(card.tools,context.history);
}

export class WorkspaceNavigation {
  constructor(card) {
    this.card = card;
    this.enabled = false;
    this.restoring = false;
    this.entries = new Map();
    this.origins = new Map();
    this.sequence = 0;
    this.currentId = null;
    this.lastPath = null;
    this.onUnload = event => {
      if(!hasWorkspaceDrafts(this.card))return;
      event.preventDefault();event.returnValue="";
    };
    this.onPop = event => {
      if(!this.enabled || !window.location.pathname.startsWith("/homeostatic"))return;
      this.capture(false);
      const state = event.state?.homeostatic;
      this.applyPath(window.location.pathname.slice("/homeostatic".length),state);
    };
  }

  connect() {
    if(this.connected)return;
    this.connected = true;
    window.addEventListener("popstate",this.onPop);
    window.addEventListener("beforeunload",this.onUnload);
  }

  disconnect() {window.removeEventListener("popstate",this.onPop);window.removeEventListener("beforeunload",this.onUnload);this.connected = false;}

  capture(persist = true) {
    if(this.restoring)return null;
    const card = this.card;
    const entry = {id:this.currentId || `view-${++this.sequence}`,route:workspaceRoute(card),context:workspaceContext(card),pageState:card.renderedCurrent ? card.capturePageState() : null};
    this.entries.set(entry.id,entry);
    this.currentId = entry.id;
    if(persist && this.enabled && window.location.pathname.startsWith("/homeostatic"))window.history.replaceState({...window.history.state,homeostatic:{id:entry.id,route:entry.route,context:entry.context}},"",window.location.href);
    return entry;
  }

  finish(previous) {
    if(this.restoring || !previous)return;
    const route = workspaceRoute(this.card), path = workspacePath(route);
    if(path === workspacePath(previous.route))return;
    const id = `view-${++this.sequence}`;
    this.currentId = id;
    this.lastPath = path;
    this.origins.set(id,previous.id);
    const entry = {id,route,context:workspaceContext(this.card),pageState:null};
    this.entries.set(id,entry);
    if(this.enabled)window.history.pushState({...window.history.state,homeostatic:{id,route,context:entry.context}},"",`/homeostatic${path}`);
    this.updateReturn();
  }

  updateReturn() {
    const route=workspaceRoute(this.card);
    const focused=route.detail || route.definition || route.source && this.card.sourcesMobileDetail || route.historyId;
    const candidate = focused ? this.entries.get(this.origins.get(this.currentId)) : null;
    const inlineHistory = route.page === "history" && candidate?.route.page === "history" && !candidate.route.detail;
    const origin = inlineHistory ? null : route.page === "sources" && !candidate?.route.detail && !candidate?.route.historyId ? null : candidate;
    this.card.workspaceReturn = origin ? {id:origin.id,label:origin.route.detail?.episodeId ? "Back to issue" : origin.route.page === "sources" ? origin.route.source ? "Back to source" : "Back to Monitoring" : ({policies:"Back to Policies",notifications:"Back to Notifications",history:"Back to history"})[origin.route.page] || "Back to Open issues"} : null;
    const control = this.card.shadowRoot?.querySelector("[data-workspace-return]");
    if(control){control.hidden = !origin;control.textContent = this.card.workspaceReturn?.label || "Back";}
  }

  back() {
    const origin = this.entries.get(this.origins.get(this.currentId));
    if(!origin)return false;
    if(this.enabled){window.history.back();return true;}
    this.applyPath(workspacePath(origin.route),origin);
    return true;
  }

  applyPath(path,historyState = null) {
    const route = historyState?.route || parseWorkspacePath(path);
    const normalized = workspacePath(route);
    if(normalized === this.lastPath && (!historyState?.id || historyState.id === this.currentId))return;
    const cached = historyState?.id ? this.entries.get(historyState.id) : null;
    const card = this.card;
    this.restoring = true;
    try {
      this.lastPath = normalized;
      this.currentId = historyState?.id || `view-${++this.sequence}`;
      restoreWorkspaceContext(card,cached?.context || historyState?.context);
      card.page = route.page;
      if(route.source !== undefined)card.sourcesSelection = route.source;
      if(route.sourcesView)card.sourcesView = route.sourcesView;
      card.definitionSelection = route.definition || null;
      if(route.notificationSection)card.notificationSection = route.notificationSection;
      card.pendingEpisode = null;
      card.pendingNode = null;
      card.pendingHistory = null;
      card.detailSequence++;
      card.detail = null;
      card.dialog.close();
      card.tools?.close();
      if(card.page === "sources") {
        card.sourcesMobileDetail = Boolean(route.source);
        card.revealSourcesSelection?.();
      }
      card.render();
      if(cached?.pageState && !route.historyId)card.restorePageState(cached.pageState);
      this.entries.set(this.currentId,{id:this.currentId,route,context:workspaceContext(card),pageState:cached?.pageState || null});
      if(route.detail?.episodeId) {
        if(card.isConnected && card.current.status === "current")card.openDetail(route.detail);
        else card.pendingEpisode = route.detail.episodeId;
      } else if(route.detail?.nodeId) {
        if(card.current.status === "current")card.openDetail(route.detail);
        else card.pendingNode=route.detail.nodeId;
      }
      if(route.historyId) {
        if(card.current.status === "current")card.tools.showHistory(route.historyId, {focus:!cached?.pageState});
        else card.pendingHistory=route.historyId;
        if(cached?.pageState)card.restorePageState(cached.pageState);
      }
      if(card.current.status === "current" && !card.configuration && !card.configBusy)card.loadConfiguration?.();
      this.updateReturn();
    } finally {this.restoring = false;}
  }
}
