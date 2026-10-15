import test from "node:test";
import assert from "node:assert/strict";
import {installationSettings} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

function fixture() {
  const settings=notificationSettings();
  settings.timings={settle:120,unknown_hold:900,retry_hold:120,clear_hold:120,rejoin_grace:60,startup_grace:120,startup_quiet_max:600,coalesce_count:3,coalesce_window:60,batch:30};
  return {page:"configuration",settingsSection:"timing",configuration:{revision:"one",settings:structuredClone(settings)},settingsDraft:settings};
}

const fields=html=>[...html.matchAll(/data-setting-path="timings\.([^"]+)"/g)].map(match=>match[1]);

test("timing starts with the ordinary waits and keeps advanced values available on demand",()=>{
  const card=fixture(),before=structuredClone(card.settingsDraft),html=installationSettings(card);
  const advanced=html.match(/<details[^>]*data-ui-key="settings-advanced-timing"[^>]*>(.*?)<\/details>/s);
  assert.ok(advanced);
  assert.doesNotMatch(advanced[0].slice(0,advanced[0].indexOf(">")),/\bopen\b/);
  assert.deepEqual(fields(html.replace(advanced[0],"")),["retry_hold","clear_hold","startup_grace"]);
  assert.deepEqual(fields(advanced[1]),["settle","unknown_hold","rejoin_grace","startup_quiet_max","batch"]);
  assert.match(html,/Zero removes a wait/);
  assert.match(html,/Hold new issues and notifications during startup/);
  assert.match(advanced[1],/Standard notification batching/);
  assert.deepEqual(card.settingsDraft,before);
});

test("problem grouping retains only its two controls and their different units",()=>{
  const card=fixture();card.settingsSection="grouping";
  const html=installationSettings(card);
  assert.deepEqual(fields(html),["coalesce_count","coalesce_window"]);
  assert.match(html,/data-setting-path="timings.coalesce_count" value="3" min="2" step="1" required data-setting-scale="1"/);
  assert.match(html,/data-setting-path="timings.coalesce_window" value="1" min="0" step="1" required data-setting-scale="60"/);
  assert.doesNotMatch(html,/Advanced timing/);
});

test("initial settings load waits without offering a competing reload action",()=>{
  const html=installationSettings({page:"configuration"});
  assert.match(html,/<p role="status">Loading settings…<\/p>/);
  assert.doesNotMatch(html,/<button/);
});

test("failed settings load exposes its error and retry action",()=>{
  const html=installationSettings({page:"configuration",configError:"Settings could not be read."});
  assert.match(html,/<p role="alert">Settings could not be read\.<\/p>/);
  assert.match(html,/data-action="load-configuration">Retry loading settings<\/button>/);
});

test("advanced edits keep dirty state and failed-save feedback outside the disclosure",()=>{
  const card=fixture();
  card.settingsDraft.timings.settle=180;
  card.scopedStatusScope="settings";card.scopedError="Changes could not be saved.";
  const html=installationSettings(card),outside=html.replace(/<details\b.*?<\/details>/s,"");
  assert.match(outside,/Unsaved changes/);
  assert.match(outside,/>Save settings<\/button>/);
  assert.match(outside,/>Discard changes<\/button>/);
  assert.match(outside,/<p class="config-error" role="alert">Changes could not be saved\.<\/p>/);
});
