/** Read-model helpers and a shared, lifecycle-bound HA subscription. */
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
  if (data.schema_version !== 2) return new Map(nodes.map(source => [source.node_id, source]));
  if (!sourceMaps.has(nodes)) sourceMaps.set(nodes, new Map(nodes.map(source => [source.node_id, source])));
  return sourceMaps.get(nodes);
}

export function affectedFunctions(data, episode) {
  const impacted = new Set(episode.impact);
  return data.functions.filter((item) =>
    impacted.has(item.node_id) && item.readiness.answer !== "ready");
}

export function sortedEpisodes(data) {
  const importance = {critical: 3, high: 2, normal: 1, low: 0};
  return [...data.inventory.episodes].sort((a, b) =>
    (importance[b.importance] - importance[a.importance]) ||
    a.opened_at.localeCompare(b.opened_at) || a.episode_id.localeCompare(b.episode_id));
}

export function inventoryRows(data) {
  const key = data.inventory.catalog;
  const cached = data.schema_version === 2 ? rowCache.get(key) : null;
  if (cached?.nodes === data.inventory.nodes) return cached.rows;
  const rows = new Map(data.inventory.catalog.candidates.map((row) => [row.node_id, row]));
  for (const row of data.inventory.nodes) rows.set(row.node_id, row);
  const sorted = [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.node_id.localeCompare(b.node_id));
  if (data.schema_version === 2) rowCache.set(key, {nodes:data.inventory.nodes, rows:sorted});
  return sorted;
}

export function monitoringLabel(source) {
  if (source.excluded_by.length) return "Excluded";
  if (source.kind === "function" && source.requirements.length) return "Composite function";
  return source.watched ? "Watched" : "Unwatched";
}

function sameValues(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function enrollmentState(change) {
  const before = change.before ?? {};
  const after = change.after ?? {};
  if (change.reason === "source_enrolled" || (!before.watched && after.watched)) return "enrolled";
  if (before.watched && !after.watched) {
    return after.excluded_by?.length ? "excluded" : "unenrolled";
  }
  if (!sameValues(before.excluded_by, after.excluded_by) ||
      !sameValues(before.attached_by, after.attached_by)) return "rules";
  if (change.reason === "match_attributes_changed") return "attributes";
  return "changed";
}

function evidenceState(data, nodeId, source) {
  if (source?.disabled) return "disabled";
  if ((data.coverage?.never_observed ?? []).some((item) => item.node_id === nodeId)) return "never_observed";
  if ((data.coverage?.stale ?? []).some((item) => item.node_id === nodeId)) return "stale";
  return null;
}

function activityCopy(state, name, evidence, change) {
  if (state === "enrolled") {
    if (evidence === "disabled") return {
      title:`${name} is now monitored`,
      summary:"It is disabled in Home Assistant, so Homeostatic cannot assess its health.",
    };
    if (evidence === "never_observed") return {
      title:`${name} is now monitored`,
      summary:"Homeostatic is waiting for its first health reading.",
    };
    if (evidence === "stale") return {
      title:`${name} is now monitored`,
      summary:"Its latest health evidence is stale and needs review.",
    };
    return {
      title:`${name} is now monitored`,
      summary:"Homeostatic added it automatically using your monitoring rules.",
    };
  }
  if (state === "excluded") return {
    title:`${name} was excluded from monitoring`,
    summary:"Homeostatic will no longer assess this source under the current rules.",
  };
  if (state === "unenrolled") return {
    title:`${name} is no longer monitored`,
    summary:"It no longer matches an active monitoring rule.",
  };
  if (state === "rules") {
    const after = change.after ?? {};
    const summary = after.excluded_by?.length
      ? "It is excluded under the current monitoring rules."
      : after.watched
        ? "It remains monitored under the updated rules."
        : "It is not currently selected for monitoring.";
    return {title:`${name}'s monitoring rules changed`,summary};
  }
  if (state === "attributes") return {
    title:`${name}'s Home Assistant details changed`,
    summary:"Homeostatic reevaluated its monitoring rules after its matching details changed.",
  };
  return {
    title:`${name}'s monitoring changed`,
    summary:"Review the source to see its current monitoring state.",
  };
}

function normalizeActivity(data, change, order, rows, registered) {
  const source = rows.get(change.node_id);
  const snapshot = change.after ?? change.before ?? {};
  const name = source?.name ?? snapshot.name ?? change.node_id;
  const state = enrollmentState(change);
  const evidence = evidenceState(data,change.node_id,source ?? snapshot);
  return {
    kind:"source",
    nodeId:change.node_id,
    registered:registered.has(change.node_id),
    name,
    state,
    evidence,
    at:change.at,
    order,
    ...activityCopy(state,name,evidence,change),
    technical:change,
  };
}

/** Translate bounded runtime enrollment events into concise owner-facing activity. */
export function recentActivity(data, limit = 4) {
  const rows = new Map(inventoryRows(data).map((source) => [source.node_id,source]));
  const registered = sourceMap(data);
  const changes = (data.inventory.enrollment_changes ?? []).map((change, order) =>
    normalizeActivity(data,change,order,rows,registered)).sort((left,right) => {
      const time = Date.parse(right.at) - Date.parse(left.at);
      return time || right.order - left.order;
    });
  const entries = [];
  for (let index = 0; index < changes.length && entries.length < limit;) {
    const current = changes[index];
    if (current.state !== "enrolled") {
      entries.push(current);
      index++;
      continue;
    }
    const cluster = [current];
    let next = index + 1;
    while (next < changes.length && changes[next].state === "enrolled" &&
        Math.abs(Date.parse(current.at) - Date.parse(changes[next].at)) <= 5000) {
      cluster.push(changes[next++]);
    }
    if (cluster.length < 3) entries.push(...cluster.slice(0,limit - entries.length));
    else {
      const waiting = cluster.filter((item) => item.evidence !== null).length;
      entries.push({
        kind:"group",
        at:current.at,
        title:`${cluster.length} sources are now monitored`,
        summary:waiting
          ? `Homeostatic added them automatically. ${waiting} ${waiting === 1 ? "is" : "are"} still waiting for usable health evidence.`
          : "Homeostatic added them automatically using your monitoring rules.",
        names:cluster.map((item) => item.name),
        technical:cluster.map((item) => item.technical),
      });
    }
    index = next;
  }
  return entries.slice(0,limit);
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function uniqueSources(sources) {
  return [...new Map(sources.map((source) => [source.node_id, source])).values()];
}

export function locationTree(data) {
  const rows = inventoryRows(data);
  const cached = treeCache.get(rows);
  if (cached && cached.areas === data.areas && cached.floors === data.floors) return cached.tree;
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
  treeCache.set(rows, {areas:data.areas, floors:data.floors, tree:roots});
  return roots;
}

export function locationList(tree) {
  return tree.flatMap((location) => [location, ...locationList(location.children)]);
}

export function browseHighlights(data) {
  return locationList(locationTree(data)).filter((location) =>
    !location.children.length && location.sources.length).slice(0, 6);
}

export function sourcePage(rows, query = "", page = 0) {
  const search = query.trim().toLocaleLowerCase();
  const matches = search ? rows.filter(source =>
    `${source.name} ${source.node_id} ${source.kind} ${monitoringLabel(source)}`.toLocaleLowerCase().includes(search)) : rows;
  const pages = Math.max(1, Math.ceil(matches.length / 50));
  const index = Math.max(0, Math.min(page, pages - 1));
  return {rows:matches.slice(index * 50, (index + 1) * 50), total:matches.length, page:index, pages};
}

export function mergeDashboard(previous, data) {
  if (data.schema_version === 1 || !data.available) return data;
  if (data.inventory_changed === true) {
    if (!data.inventory?.nodes || !data.inventory?.catalog || !data.areas || !data.floors || !Number.isInteger(data.catalog_revision)) {
      throw new Error("Incomplete Homeostatic catalog. Retry the connection.");
    }
    return data;
  }
  if (data.inventory_changed !== false || !previous?.available ||
      previous.schema_version !== 2 || previous.catalog_revision !== data.catalog_revision) {
    throw new Error("Homeostatic catalog is out of date. Retry the connection.");
  }
  return {...data, inventory:{...previous.inventory, ...data.inventory}, areas:previous.areas, floors:previous.floors};
}

const stores = new WeakMap();

export class DashboardStore {
  constructor(connection) {
    this.connection = connection;
    this.listeners = new Set();
    this.state = {status: "loading", data: null, error: null};
    this.generation = 0;
    this.unsubscribe = null;
    this.disconnected = () => this.update({status: "disconnected", error: null});
    this.ready = () => this.update({status: "loading", error: null});
  }

  update(change) {
    this.state = {...this.state, ...change};
    for (const listener of this.listeners) listener(this.state);
  }

  listen(listener) {
    this.listeners.add(listener);
    listener(this.state);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  start() {
    const generation = ++this.generation;
    this.connection.addEventListener("disconnected", this.disconnected);
    this.connection.addEventListener("ready", this.ready);
    this.update({status: "loading", error: null});
    this.connection.subscribeMessage((data) => {
      if (generation !== this.generation) return;
      if (![1,2].includes(data.schema_version)) {
        this.update({status: "error", error: "Unsupported Homeostatic data version. Reload after updating."});
        return;
      }
      try {
        data = mergeDashboard(this.state.data, data);
        this.update({status: data.available ? "current" : "unavailable", data, error: null});
      } catch (error) {
        this.update({status:"error",data:null,error:error.message});
      }
    }, {type: "homeostatic/subscribe", compact:true}).then((unsubscribe) => {
      if (generation !== this.generation) {
        Promise.resolve(unsubscribe()).catch(() => {});
      } else {
        this.unsubscribe = unsubscribe;
      }
    }).catch((error) => {
      if (generation === this.generation) {
        this.update({status: "error", error: error?.message ?? "Could not subscribe to Homeostatic."});
      }
    });
  }

  stop() {
    this.generation++;
    this.connection.removeEventListener("disconnected", this.disconnected);
    this.connection.removeEventListener("ready", this.ready);
    if (this.unsubscribe) {
      Promise.resolve(this.unsubscribe()).catch(() => {});
      this.unsubscribe = null;
    }
    this.state = {status: "loading", data: null, error: null};
  }

  retry() {
    this.stop();
    this.start();
  }
}

export function dashboardStore(connection) {
  if (!stores.has(connection)) stores.set(connection, new DashboardStore(connection));
  return stores.get(connection);
}
