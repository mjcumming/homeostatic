const pageAliases = {overview:"problems", issues:"problems", settings:"configuration", house:"sources", coverage:"sources", functions:"problems"};
export const workspacePage = page => pageAliases[page] || page || "problems";

const decode = value => {try {return decodeURIComponent(value);} catch {return null;}};

/** Keep meaningful destinations in the URL; filters and expansion are view state. */
export function parseWorkspacePath(path = "") {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if(parts[0] === "homeostatic")parts.shift();
  const [name,encoded,extra] = parts;
  const id = encoded ? decode(encoded) : null;
  if(name === "notification") {
    const episodeId=extra === "episode" && parts[3] ? decode(parts[3]) : null;
    return {page:"problems",notificationReference:id || "invalid",...(episodeId ? {detail:{episodeId}} : {})};
  }
  if(name === "issues" && encoded === "notification") {
    const members = extra ? extra.split(",").map(decode) : [];
    const issueIds = members.every(Boolean) ? [...new Set(members)] : [];
    const episodeId = parts[3] === "episode" && parts[4] ? decode(parts[4]) : null;
    return {page:"problems",issueIds,...(episodeId && issueIds.includes(episodeId) ? {detail:{episodeId}} : {})};
  }
  if(name === "episode" && id)return {page:"problems",detail:{episodeId:id}};
  if(name === "node" && id)return {page:"sources",detail:{nodeId:id}};
  if(name === "device-issues" && id)return {page:"sources",detail:{deviceId:id}};
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
  if(workspacePage(route.page) === "problems" && route.notificationReference)return `/notification/${encode(route.notificationReference)}${route.detail?.episodeId ? `/episode/${encode(route.detail.episodeId)}` : ""}`;
  if(workspacePage(route.page) === "problems" && Array.isArray(route.issueIds) && (!route.detail || route.issueIds.includes(route.detail.episodeId))) {
    const members = route.issueIds.map(encode).join(",");
    const detail = route.issueIds.includes(route.detail?.episodeId) ? `/episode/${encode(route.detail.episodeId)}` : "";
    return `/issues/notification/${members}${detail}`;
  }
  if(route.detail?.episodeId)return `/episode/${encode(route.detail.episodeId)}`;
  if(route.detail?.nodeId)return `/node/${encode(route.detail.nodeId)}`;
  if(route.detail?.deviceId)return `/device-issues/${encode(route.detail.deviceId)}`;
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
    ...(page === "problems" && card.notificationReference ? {notificationReference:card.notificationReference} : {}),
    issueIds:page === "problems" && Array.isArray(card.notificationIssueIds) ? [...card.notificationIssueIds] : null,
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
  if(!card.editors.configuration)return false;
  return Boolean(card.editors.settingsDraft && JSON.stringify(card.editors.settingsDraft)!==JSON.stringify(card.editors.configuration.settings));
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

  disconnect() {this.invalidateNotificationReport();window.removeEventListener("popstate",this.onPop);window.removeEventListener("beforeunload",this.onUnload);this.connected = false;}

  invalidateNotificationReport() {
    this.reportSequence=(this.reportSequence || 0)+1;
    this.reportRequest=null;
    if(this.card.notificationReference){this.card.notificationIssueIds=[];this.card.notificationReportStatus="loading";}
  }

  clearNotificationReport() {
    this.invalidateNotificationReport();
    this.card.notificationReference=null;
    this.card.notificationReportStatus=null;
    this.card.notificationIssueIds=null;
    this.pendingReportEpisode=null;
  }

  loadNotificationReport() {
    const card=this.card,reference=card.notificationReference;
    if(!reference || card.current.status!=="current" || !card.isConnected || !card._hass?.callWS)return;
    if(this.reportRequest || ["available","expired","error"].includes(card.notificationReportStatus))return this.reportRequest;
    const sequence=this.reportSequence=(this.reportSequence || 0)+1;
    card.notificationReportStatus="loading";
    const current=()=>sequence===this.reportSequence && reference===card.notificationReference && card.isConnected;
    this.reportRequest=(async()=>{
      try {
        if(!/^[0-9a-f]{32}$/.test(reference)){card.notificationReportStatus="expired";return;}
        const members=[];let offset=0,total=null;
        do {
          const result=await card._hass.callWS({type:"homeostatic/notification_report",reference,offset,limit:200});
          if(!current())return;
          if(result.status==="expired"){card.notificationReportStatus="expired";return;}
          if(result.status!=="available" || result.reference!==reference || !Array.isArray(result.episodes) || result.episodes.some(id=>typeof id!=="string" || !id) || !Number.isInteger(result.total) || result.total<1 || result.total>20000 || total!==null&&total!==result.total)throw Error("Invalid notification membership");
          total=result.total;members.push(...result.episodes);
          const next=result.next_offset;
          if(members.length>total || next!==null&&(next!==members.length || next<=offset) || next===null&&members.length!==total)throw Error("Incomplete notification membership");
          offset=next;
        } while(offset!==null);
        if(new Set(members).size!==members.length)throw Error("Repeated notification membership");
        card.notificationIssueIds=members;card.notificationReportStatus="available";
        const episodeId=this.pendingReportEpisode;this.pendingReportEpisode=null;
        if(episodeId && members.includes(episodeId))card.openDetail({episodeId});
      } catch {
        if(current())card.notificationReportStatus="error";
      } finally {
        if(current()){this.reportRequest=null;card.render();}
      }
    })();
    return this.reportRequest;
  }

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
    this.card.workspaceReturn = origin ? {id:origin.id,label:origin.route.detail?.episodeId || origin.route.detail?.deviceId ? "Back to issue" : origin.route.page === "sources" ? origin.route.source ? "Back to source" : "Back to Monitoring" : ({policies:"Back to Policies",notifications:"Back to Notifications",history:"Back to history"})[origin.route.page] || "Back to Open issues"} : null;
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
    if(!historyState && this.enabled && window.location.pathname === `/homeostatic${path.split("?")[0]}`) {
      const saved=window.history?.state?.homeostatic;
      // A native HA visit can recreate the panel before its popstate listener exists.
      if(saved?.route && workspacePath(saved.route) === workspacePath(parseWorkspacePath(path)))historyState=saved;
    }
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
      this.clearNotificationReport();
      card.notificationReference=route.notificationReference || null;
      card.notificationIssueIds = card.notificationReference ? [] : Array.isArray(route.issueIds) ? [...route.issueIds] : null;
      if(card.notificationReference)card.notificationReportStatus="loading";
      if(!cached && !historyState?.context && card.notificationIssueIds)card.issueQuery = "";
      if(route.source !== undefined)card.sourcesSelection = route.source;
      if(route.sourcesView)card.sourcesView = route.sourcesView;
      card.definitionSelection = route.definition || null;
      if(route.notificationSection)card.notificationSection = route.notificationSection;
      card.pendingEpisode = null;
      card.pendingNode = null;
      card.pendingDeviceIssues = null;
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
        if(card.notificationReference)this.pendingReportEpisode=route.detail.episodeId;
        else if(card.isConnected && card.current.status === "current")card.openDetail(route.detail);
        else card.pendingEpisode = route.detail.episodeId;
      } else if(route.detail?.nodeId) {
        if(card.current.status === "current")card.openDetail(route.detail);
        else card.pendingNode=route.detail.nodeId;
      } else if(route.detail?.deviceId) {
        if(card.current.status === "current")card.openDetail(route.detail);
        else card.pendingDeviceIssues=route.detail.deviceId;
      }
      if(route.historyId) {
        if(card.current.status === "current")card.tools.showHistory(route.historyId, {focus:!cached?.pageState});
        else card.pendingHistory=route.historyId;
        if(cached?.pageState)card.restorePageState(cached.pageState);
      }
      if(card.current.status === "current" && !card.editors.configuration && !card.editors.configBusy)card.loadConfiguration?.();
      this.loadNotificationReport();
      this.updateReturn();
    } finally {this.restoring = false;}
  }
}
