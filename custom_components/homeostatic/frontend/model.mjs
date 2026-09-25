/** Read-model helpers and a shared, lifecycle-bound HA subscription. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function sourceMap(data) {
  return new Map((data.inventory?.nodes ?? []).map((source) => [source.node_id, source]));
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
  const rows = new Map(data.inventory.catalog.candidates.map((row) => [row.node_id, row]));
  for (const row of data.inventory.nodes) rows.set(row.node_id, row);
  return [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.node_id.localeCompare(b.node_id));
}

export function monitoringLabel(source) {
  if (source.excluded_by.length) return "Excluded";
  if (source.kind === "function" && source.requirements.length) return "Composite function";
  return source.watched ? "Watched" : "Unwatched";
}

export function areaGroups(data) {
  const floors = new Map(data.floors.map((floor) => [floor.id, floor.name]));
  const rows = inventoryRows(data);
  const areas = data.areas.map((area) => ({
    ...area,
    floor: floors.get(area.floor_id) ?? "Areas",
    sources: rows.filter((source) => source.attributes.area?.includes(area.id)),
  })).filter((area) => area.sources.length);
  const ids = new Set(data.areas.map((area) => area.id));
  const unassigned = rows.filter((source) =>
    !source.attributes.area?.some((id) => ids.has(id)));
  if (unassigned.length) areas.push({
    id: "", name: "Unassigned / shared", floor: "Other", sources: unassigned,
  });
  return areas.sort((a, b) => a.floor.localeCompare(b.floor) || a.name.localeCompare(b.name));
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
      if (data.schema_version !== 1) {
        this.update({status: "error", error: "Unsupported Homeostatic data version. Reload after updating."});
        return;
      }
      this.update({status: data.available ? "current" : "unavailable", data, error: null});
    }, {type: "homeostatic/subscribe"}).then((unsubscribe) => {
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
