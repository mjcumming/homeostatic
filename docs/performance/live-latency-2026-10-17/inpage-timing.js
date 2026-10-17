// In-page WebSocket timing wrapper for Homeostatic (phase 1, step 3).
// Records every sendMessagePromise and subscription event with timestamps.
(() => {
  const ha = document.querySelector("home-assistant");
  const conn = ha?.hass?.connection;
  if (!conn) return "no connection";
  if (conn.__hperfWrapped) return "already wrapped";
  const log = (window.__hperf = window.__hperf || []);
  const t0 = performance.timeOrigin;
  const original = conn.sendMessagePromise.bind(conn);
  conn.sendMessagePromise = (msg) => {
    const sent = performance.now();
    const row = {kind: "request", type: msg?.type, section: msg?.section, offset: msg?.offset, revision: msg?.revision, sent: sent + t0, done: null, ms: null, ok: null, items: null};
    log.push(row);
    return original(msg).then((result) => {
      row.done = performance.now() + t0; row.ms = row.done - row.sent; row.ok = true;
      row.items = Array.isArray(result?.items) ? result.items.length : null;
      row.saved = result?.saved; row.revision_out = result?.revision ?? result?.catalog_revision;
      return result;
    }, (err) => { row.done = performance.now() + t0; row.ms = row.done - row.sent; row.ok = false; row.error = err?.code || String(err); throw err; });
  };
  const origSub = conn.subscribeMessage.bind(conn);
  conn.subscribeMessage = (callback, msg, options) => {
    const wrapped = (data) => {
      if (msg?.type?.startsWith("homeostatic/")) log.push({kind: "event", type: msg.type, at: performance.now() + t0, catalog_revision: data?.catalog_revision, inventory_changed: data?.inventory_changed, available: data?.available, schema: data?.schema_version});
      return callback(data);
    };
    return origSub(wrapped, msg, options);
  };
  // DOM settle tracking: last mutation time inside the panel.
  const obs = new MutationObserver(() => { window.__hperfLastMutation = performance.now() + t0; });
  obs.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
  conn.__hperfWrapped = true;
  window.__hperfMark = (label) => log.push({kind: "mark", label, at: performance.now() + t0});
  window.__hperfSummary = () => {
    const rows = log.filter(r => r.kind === "request");
    const by = {};
    for (const r of rows) { const k = r.type; by[k] = by[k] || {n: 0, ms: 0, fail: 0}; by[k].n++; by[k].ms += r.ms || 0; if (r.ok === false) by[k].fail++; }
    return {requests: rows.length, byType: by, events: log.filter(r => r.kind === "event").length, lastMutation: window.__hperfLastMutation};
  };
  return "wrapped";
})();
