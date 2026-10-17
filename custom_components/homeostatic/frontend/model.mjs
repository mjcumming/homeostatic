/** Read-model helpers and a shared, lifecycle-bound HA subscription. */
import {deviceProblem, entityProblem, integrationProblem} from "./problem.mjs?v=94";
import {waitingOnly} from "./check-presentation.mjs?v=94";
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const sourceMaps = new WeakMap();
const rowCache = new WeakMap();
const treeCache = new WeakMap();

export function sourceMap(data) {
  const nodes = data.inventory?.nodes;
  if (!nodes) return new Map();
  if (![2,3].includes(data.schema_version)) return new Map(nodes.map(source => [source.node_id, source]));
  if (!sourceMaps.has(nodes)) sourceMaps.set(nodes, new Map(nodes.map(source => [source.node_id, source])));
  return sourceMaps.get(nodes);
}

export function affectedFunctions(data, episode) {
  const impacted = new Set(episode.impact);
  return data.functions.filter((item) =>
    impacted.has(item.node_id) && item.readiness.answer !== "ready");
}

/** Evidence gaps remain inspectable without becoming an owner-facing fault. */
export function availabilityEvidenceGap(data, episode) {
  const nodes = sourceMap(data), findings = (episode.reasons || []).filter(item=>item.status !== "pass");
  const gaps = new Set(["unknown","stale","source_missing","restored_state","state_unknown","incomplete_evidence"]);
  return findings.length > 0 && findings.every(finding=>{
    const source=nodes.get(finding.node_id), check=finding.check_id || source?.check_id;
    const evidence=data.inventory.entity_status?.[finding.node_id] || data.inventory.integration_evidence?.[finding.node_id];
    const current=evidence?.current;
    return source && ["entity","device","integration"].includes(source.kind) && check === "availability" &&
      (!evidence || Object.hasOwn(evidence,"last_failure") && !evidence.last_failure) &&
      finding.status === "unknown" && gaps.has(finding.reason) && (!current || gaps.has(current.reason));
  });
}

export function visibleEpisodes(data) {
  const nodes = sourceMap(data);
  return data.inventory.episodes.filter(episode => {
    const source = nodes.get(episode.anchor);
    if (!source) return true;
    if (waitingOnly(data, episode)) return false;
    if (availabilityEvidenceGap(data, episode)) return false;
    const findings = episode.reasons ?? [];
    if (findings.some(item => item.node_id && item.node_id !== episode.anchor && item.status !== "pass")) return true;
    const problem = integrationProblem(source, findings, () => null, data.inventory.integration_evidence?.[episode.anchor]) ??
      deviceProblem(source, data.inventory.entity_status?.[episode.anchor]) ??
      entityProblem(source, data.inventory.entity_status?.[episode.anchor], nodes.get(`entry:${source.owner_id}`), data.areas ?? []);
    return problem?.tone !== "recovering" && !(source.kind === "entity" && problem?.currentReason === "value_unknown");
  });
}

export function sortedEpisodes(data) {
  const importance = {critical: 3, high: 2, normal: 1, low: 0};
  return [...visibleEpisodes(data)].sort((a, b) =>
    (importance[b.importance] - importance[a.importance]) ||
    a.opened_at.localeCompare(b.opened_at) || a.episode_id.localeCompare(b.episode_id));
}

export function inventoryRows(data) {
  const key = data.inventory.catalog;
  const cached = [2,3].includes(data.schema_version) ? rowCache.get(key) : null;
  if (cached?.nodes === data.inventory.nodes) return cached.rows;
  const rows = new Map(data.inventory.catalog.candidates.filter((row) => row.kind !== "function").map((row) => [row.node_id, row]));
  for (const row of data.inventory.nodes) if (row.kind !== "function") rows.set(row.node_id, row);
  const sorted = [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.node_id.localeCompare(b.node_id));
  if ([2,3].includes(data.schema_version)) rowCache.set(key, {nodes:data.inventory.nodes, rows:sorted});
  return sorted;
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function uniqueSources(sources) {
  return [...new Map(sources.map((source) => [source.node_id, source])).values()];
}

export function locationTree(data) {
  const inventory = inventoryRows(data);
  const cached = treeCache.get(inventory);
  if (cached && cached.areas === data.areas && cached.floors === data.floors &&
      cached.devices === data.devices && cached.functions === data.functions) return cached.tree;
  const rows = inventory.filter((source) => ["entity","device","battery","vacuum"].includes(source.kind));
  const deviceNames = new Map((data.devices ?? []).map((device) => [device.id, device.name]));
  const describe = (location) => {
    const devices = new Map();
    const signals = [];
    const ids = new Set(location.sources.map((source) => source.node_id));
    for (const source of location.sources) {
      const deviceId = source.attributes.device?.[0];
      if (!deviceNames.has(deviceId)) {
        signals.push(source);
        continue;
      }
      if (!devices.has(deviceId)) devices.set(deviceId, {
        id:deviceId, name:deviceNames.get(deviceId), sources:[],
      });
      devices.get(deviceId).sources.push(source);
    }
    location.devices = [...devices.values()].sort(byName);
    location.signals = signals;
    location.functions = (data.functions ?? []).filter((item) =>
      item.requirements?.some((id) => ids.has(id)));
    const count = (value, name) => value ? `${value} ${name}${value === 1 ? "" : "s"}` : null;
    location.summary = [count(location.devices.length,"device"),
      count(location.functions.length,"function"),signals.length ? `${signals.length} ${signals.length === 1 ? "entity" : "entities"} without a device` : null]
      .filter(Boolean).join(" · ") || "Empty";
    for (const child of location.children) describe(child);
  };
  const sourceAreas = new Map((data.areas ?? []).map((area) => [area.id, []]));
  const unassigned = [];
  for (const source of rows) {
    let assigned = false;
    for (const areaId of source.attributes.area ?? []) {
      const sources = sourceAreas.get(areaId);
      if (!sources) continue;
      sources.push(source);
      assigned = true;
    }
    if (!assigned) unassigned.push(source);
  }

  const floorNames = new Map((data.floors ?? []).map((floor) => [floor.id, floor.name]));
  const floorIds = new Set(floorNames.keys());
  const areas = (data.areas ?? []).map((area) => ({
    id: `area:${area.id}`,
    registry_id: area.id,
    name: area.name,
    kind: "area",
    sources: sourceAreas.get(area.id) ?? [],
    children: [],
    floor_id: area.floor_id,
    parent_name: floorNames.get(area.floor_id) ?? "Areas without a floor",
  })).sort(byName);
  const roots = (data.floors ?? []).map((floor) => {
    const children = areas.filter((area) => area.floor_id === floor.id);
    return {
      id: `floor:${floor.id}`,
      registry_id: floor.id,
      name: floor.name,
      kind: "floor",
      parent_name: "Floor",
      sources: uniqueSources(children.flatMap((area) => area.sources)),
      children,
    };
  }).sort(byName);
  const floorless = areas.filter((area) => !area.floor_id || !floorIds.has(area.floor_id));
  if (floorless.length) roots.push({
    id: "group:floorless",
    registry_id: null,
    name: "Areas without a floor",
    kind: "group",
    parent_name: "Home Assistant areas",
    sources: uniqueSources(floorless.flatMap((area) => area.sources)),
    children: floorless,
  });
  if (unassigned.length) roots.push({
    id: "group:unassigned",
    registry_id: null,
    name: "Unassigned",
    kind: "unassigned",
    parent_name: "Sources without an area",
    sources: unassigned,
    children: [],
  });
  for (const root of roots) describe(root);
  treeCache.set(inventory, {areas:data.areas, floors:data.floors, devices:data.devices,
    functions:data.functions, tree:roots});
  return roots;
}

export function locationList(tree) {
  return tree.flatMap((location) => [location, ...locationList(location.children)]);
}

export function mergeDashboard(previous, data) {
  if (data.schema_version === 1 || !data.available) return data;
  if (data.schema_version === 3) {
    if (!Number.isInteger(data.catalog_revision) || !data.inventory?.nodes || !data.inventory?.catalog ||
        !CATALOG_SECTIONS.every(section => Number.isInteger(data.catalog_sections?.[section]) && data.catalog_sections[section] >= 0)) {
      throw new Error("Incomplete Homeostatic catalog summary. Retry the connection.");
    }
    if (previous?.schema_version !== 3 || !previous.catalog_loaded) return data;
    const stale = Boolean(previous.catalog_stale || previous.catalog_revision !== data.catalog_revision);
    const overlay=(saved,current,key)=>[...new Map([...saved,...current].map(row=>[row[key],row])).values()];
    const context=stale&&data.panel_context;
    return {...data,catalog_loaded:true,
      catalog_stale:stale,
      inventory:{...data.inventory,
      nodes:context?overlay(previous.inventory.nodes,data.inventory.nodes,"node_id"):previous.inventory.nodes,
      catalog:stale ? {...data.inventory.catalog,candidates:context?overlay(previous.inventory.catalog.candidates,data.inventory.catalog.candidates,"node_id"):previous.inventory.catalog.candidates} : previous.inventory.catalog,
      targets:previous.inventory.targets,enrollment_changes:previous.inventory.enrollment_changes},
      areas:context?overlay(previous.areas,data.areas,"id"):previous.areas,
      devices:context?overlay(previous.devices,data.devices,"id"):previous.devices,
      floors:context?overlay(previous.floors,data.floors,"id"):previous.floors};
  }
  if (data.inventory_changed === true) {
    if (!data.inventory?.nodes || !data.inventory?.catalog || !data.areas || !data.floors || !data.devices || !Number.isInteger(data.catalog_revision)) {
      throw new Error("Incomplete Homeostatic catalog. Retry the connection.");
    }
    return data;
  }
  if (data.inventory_changed !== false || !previous?.available ||
      previous.schema_version !== 2 || previous.catalog_revision !== data.catalog_revision) {
    throw new Error("Homeostatic catalog is out of date. Retry the connection.");
  }
  return {...data, inventory:{...previous.inventory, ...data.inventory}, areas:previous.areas, floors:previous.floors, devices:previous.devices};
}

/** Saved editors depend on catalog/configuration changes, not new issue evidence. */
export function editorEvidenceOnly(previous,next) {
  const before=previous?.data,after=next?.data;
  const reports=before?.policy?.reports||[],nextReports=after?.policy?.reports||[];
  return previous?.status==="current"&&next?.status==="current"&&
    [2,3].includes(after?.schema_version)&&before.schema_version===after.schema_version&&
    before.catalog_revision===after.catalog_revision&&before.catalog_loaded===after.catalog_loaded&&
    before.catalog_stale===after.catalog_stale&&previous.catalogError===next.catalogError&&
    before.policy?.notifications_enabled===after.policy?.notifications_enabled&&
    reports.length===nextReports.length&&reports.every((report,index)=>
      report.name===nextReports[index].name&&report.next_at===nextReports[index].next_at);
}

const stores = new WeakMap();
const CATALOG_SECTIONS = ["nodes","candidates","targets","enrollment_changes","areas","devices","floors"];

export class DashboardStore {
  constructor(connection) {
    this.connection = connection;
    this.listeners = new Set();
    this.state = {status: "loading", data: null, error: null};
    this.generation = 0;
    this.unsubscribe = null;
    this.active = false;
    this.baseline = null;
    this.catalogWanted = false;
    this.catalogGeneration = 0;
    this.catalogTask = null;
    this.disconnected = () => {
      this.baseline = null;
      this.catalogGeneration++;
      this.catalogTask = null;
      this.catalogWanted = false;
      this.update({status: "disconnected", error: null});
    };
    this.ready = () => {
      if (this.state.status === "disconnected") this.update({status: "loading", error: null});
    };
  }

  update(change) {
    this.state = {...this.state, ...change};
    for (const listener of this.listeners) listener(this.state);
  }

  listen(listener) {
    this.listeners.add(listener);
    listener(this.state);
    if (!this.active) this.start();
    return () => {
      this.listeners.delete(listener);
      // HA can replace a card within one navigation turn without losing its stream.
      queueMicrotask(() => {
        if (!this.listeners.size) this.stop();
      });
    };
  }

  start() {
    this.active = true;
    const generation = ++this.generation;
    this.connection.addEventListener("disconnected", this.disconnected);
    this.connection.addEventListener("ready", this.ready);
    this.update({status: "loading", error: null});
    this.connection.subscribeMessage((data) => {
      if (generation !== this.generation) return;
      if (![1,2,3].includes(data.schema_version)) {
        this.baseline = null;
        this.update({status: "error", error: "Unsupported Homeostatic data version. Reload after updating."});
        return;
      }
      try {
        if (!data.available || this.baseline?.catalog_revision !== data.catalog_revision) {
          this.catalogGeneration++;
          this.state = {...this.state,catalogError:null};
        }
        data = mergeDashboard(this.baseline, data);
        this.baseline = data.available ? data : null;
        this.update({status: data.available ? "current" : "unavailable", data, error: null});
      } catch (error) {
        this.baseline = null;
        this.update({status:"error",data:null,error:error.message});
      }
    }, {type: "homeostatic/subscribe", paged:true,panel:true}).then((unsubscribe) => {
      if (generation !== this.generation) {
        Promise.resolve(unsubscribe()).catch(() => {});
      } else {
        this.unsubscribe = unsubscribe;
      }
    }).catch((error) => {
      if (generation === this.generation) {
        const versionMismatch = error?.code === "invalid_format" && /not a valid option at '(paged|panel)'/.test(error?.message ?? "");
        const message = versionMismatch
          ? "The Homeostatic dashboard and integration are out of sync. If Home Assistant is updating or restarting, let it finish, then refresh this page. If this continues, check that the dashboard and integration are from the same version."
          : error?.message ?? "Could not subscribe to Homeostatic.";
        this.update({status: "error", error: message});
      }
    });
  }

  stop() {
    this.active = false;
    this.baseline = null;
    this.catalogGeneration++;
    this.catalogWanted = false;
    this.catalogTask = null;
    this.generation++;
    this.connection.removeEventListener("disconnected", this.disconnected);
    this.connection.removeEventListener("ready", this.ready);
    if (this.unsubscribe) {
      Promise.resolve(this.unsubscribe()).catch(() => {});
      this.unsubscribe = null;
    }
    this.state = {status: "loading", data: this.state.data?.available ? this.state.data : null, error: null};
  }

  retry() {
    this.stop();
    this.start();
  }

  ensureCatalog(retry = false) {
    if (retry) this.state = {...this.state,catalogError:null};
    if (this.catalogTask) {this.catalogWanted = true;return this.catalogTask;}
    const data = this.baseline;
    if (this.state.status !== "current" || data?.schema_version !== 3 || data.catalog_loaded && !data.catalog_stale || this.state.catalogError) return Promise.resolve();
    this.catalogWanted = true;
    const token = this.catalogGeneration;
    const revision = data.catalog_revision;
    const current = () => token === this.catalogGeneration && this.active && this.state.status === "current";
    const task = Promise.resolve().then(async () => {
      const sections = Object.fromEntries(CATALOG_SECTIONS.map(section=>[section,new Array(data.catalog_sections[section])]));
      const pages = CATALOG_SECTIONS.flatMap(section=>Array.from({length:Math.ceil(data.catalog_sections[section]/200)},(_,index)=>({section,offset:index*200})));
      let nextPage = 0;
      const fetchPages = async () => {
        while (nextPage < pages.length && current()) {
          const {section,offset} = pages[nextPage++];
          const total = data.catalog_sections[section];
          const page = await this.connection.sendMessagePromise({type:"homeostatic/catalog",revision,section,offset,limit:200});
          if (!current()) return;
          const end = Math.min(offset + 200,total);
          if (page.revision !== revision || page.section !== section || page.offset !== offset ||
              page.total !== total || !Array.isArray(page.items) || page.items.length !== end - offset ||
              page.next_offset !== (end < total ? end : null)) throw new Error("Incomplete source catalog. Retry loading sources.");
          page.items.forEach((item,index)=>{sections[section][offset+index]=item;});
        }
      };
      await Promise.all(Array.from({length:Math.min(4,pages.length)},fetchPages));
      if (!current()) return;
      const latest = this.baseline;
      this.baseline = {...latest,catalog_loaded:true,catalog_stale:false,inventory:{...latest.inventory,
        nodes:sections.nodes,catalog:{...latest.inventory.catalog,candidates:sections.candidates},
        targets:sections.targets,enrollment_changes:sections.enrollment_changes},
        areas:sections.areas,devices:sections.devices,floors:sections.floors};
      this.update({data:this.baseline,catalogError:null});
    }).catch(error => {
      if (current()) this.update({catalogError:error?.message ?? "Could not load sources. Retry loading sources."});
    }).finally(() => {
      if (this.catalogTask !== task) return;
      this.catalogTask = null;
      if (token !== this.catalogGeneration && this.catalogWanted) this.ensureCatalog();
      else this.catalogWanted = false;
    });
    this.catalogTask = task;
    if (retry) this.update({catalogError:null});
    return this.catalogTask;
  }
}

export function dashboardStore(connection, userId = null) {
  if (!stores.has(connection) || stores.get(connection).userId !== userId) {
    const store = new DashboardStore(connection);
    store.userId = userId;
    stores.set(connection, store);
  }
  return stores.get(connection);
}
