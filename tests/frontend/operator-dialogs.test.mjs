import assert from "node:assert/strict";
import test from "node:test";
import {controlsPanel,DashboardTools} from "../../custom_components/homeostatic/frontend/history-controls.mjs";

const source={node_id:"source:one",name:"Hall thermostat - temperature policy",kind:"entity"};
const episode={episode_id:"issue:one",anchor:source.node_id};
const pause={control_id:"pause:one",action:"shelve",target:episode.episode_id,until:"2026-10-15T17:30:00Z",reason:"Checking the sensor"};
const maintenance={control_id:"maintenance:one",action:"maintenance",target:source.node_id,until:"2026-10-15T18:00:00Z",include_dependents:true,reason:"Replacing the sensor"};
const data=()=>({inventory:{nodes:[source],episodes:[episode],attention_controls_supported:true,operator_controls:[pause,maintenance]},policy:{episodes:[]}});

function actionTools() {
  const title={textContent:""};
  const tools={
    card:{current:{status:"current",data:data()},_hass:{user:{is_admin:true}},detail:episode,detailSequence:0,dialog:{close(){}},displaySourceName:()=>"Hall thermostat"},
    body:{innerHTML:""},dialog:{open:false,querySelector:()=>title,showModal(){}},
    refreshImmediate(){},clearSelection:DashboardTools.prototype.clearSelection,
  };
  return {tools,title};
}

test("scoped controls list maintenance only and leave issue pauses to the issue response",()=>{
  const html=controlsPanel(data(),[source.node_id,episode.episode_id]);
  assert.match(html,/class="active-controls"/);
  assert.match(html,/Working on equipment/);
  assert.match(html,/data-cancel-control="maintenance:one">End maintenance…<\/button>/);
  assert.match(html,/Replacing the sensor/);
  assert.doesNotMatch(html,/pause:one|Notifications paused|>Resume<|Hall thermostat/);
});

test("unscoped controls name equipment and retain dependent maintenance scope",()=>{
  const html=controlsPanel(data());
  assert.match(html,/class="control-target">Hall thermostat/);
  assert.match(html,/Also covers dependent equipment/);
  assert.match(html,/Existing problems and notifications remain active/);
  assert.doesNotMatch(html,/pause:one/);
});

for(const kind of ["entity","integration","external","device","ups"])test(`${kind} details retain active maintenance without issue response or creation controls`,()=>{
  const current=data(),selected={...source,kind};
  const html=DashboardTools.prototype.maintenanceControls(selected,current);
  assert.match(html,/data-cancel-control="maintenance:one"/);
  assert.match(html,/Until /);
  assert.doesNotMatch(html,/data-maintenance|Start maintenance|data-device-response|Acknowledge|Pause notifications/);
  current.inventory.operator_controls=[pause];
  assert.equal(DashboardTools.prototype.maintenanceControls(selected,current),"");
});

test("End maintenance confirmation names one target and retains its consequence",()=>{
  const {tools,title}=actionTools();
  DashboardTools.prototype.openImmediate.call(tools,maintenance.control_id);
  assert.equal(title.textContent,"End maintenance");
  assert.equal(tools.body.innerHTML.match(/Hall thermostat/g).length,1);
  assert.doesNotMatch(tools.body.innerHTML,/temperature policy/);
  assert.match(tools.body.innerHTML,/Problems still present may open now.*Other overlapping maintenance windows remain active/);
  assert.match(tools.body.innerHTML,/<form class="tool-form">/);
  assert.match(tools.body.innerHTML,/data-immediate-feedback role="status" hidden/);
  assert.equal(tools.immediate.target,maintenance.control_id);
});

test("issue targets cannot open a tools confirmation",()=>{
  const {tools,title}=actionTools();
  DashboardTools.prototype.openImmediate.call(tools,episode.episode_id);
  assert.equal(tools.body.innerHTML,"");
  assert.equal(title.textContent,"");
  assert.equal(tools.immediate,undefined);
});
