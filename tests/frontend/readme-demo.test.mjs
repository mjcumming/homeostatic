import assert from "node:assert/strict";
import test from "node:test";

import {configuration,snapshot} from "./readme-demo-data.mjs";

test("the fictional source graph and watched count agree", () => {
  const sources = snapshot.inventory.nodes;
  const ids = new Set(sources.map(source => source.node_id));
  assert.equal(ids.size, sources.length);
  assert.equal(snapshot.inventory.catalog.watched, sources.filter(source => source.watched).length);
  for (const source of sources) for (const requirement of source.requirements) assert.ok(ids.has(requirement));
  for (const impact of snapshot.inventory.episodes[0].impact) assert.ok(ids.has(impact));
  assert.ok(ids.has(snapshot.inventory.episodes[0].anchor));
});

test("prior recoveries end before the new shared issue", () => {
  const open = snapshot.inventory.episodes[0];
  const ended = snapshot.inventory.resolved_history.episodes;
  assert.equal(ended.length, 3);
  assert.ok(Date.parse(open.opened_at) < Date.parse(snapshot.updated_at));
  for (const item of ended) {
    assert.ok(Date.parse(item.episode.opened_at) < Date.parse(item.resolved_at));
    assert.ok(Date.parse(item.resolved_at) < Date.parse(open.opened_at));
    assert.equal(item.resolution, "cleared");
    assert.notEqual(item.episode.episode_id, open.episode_id);
  }
});

test("the notification request uses a configured fictional destination", () => {
  const request = snapshot.policy.episodes[0];
  assert.equal(request.episode_id, snapshot.inventory.episodes[0].episode_id);
  assert.deepEqual(request.sent_to, configuration.settings.reporting.people.alex);
  assert.equal(configuration.settings.reporting.assignments["entry:zigbee"].default, "acknowledge");
});
