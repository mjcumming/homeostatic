import assert from "node:assert/strict";
import test from "node:test";
import {controlsPanel,DashboardTools} from "../../custom_components/homeostatic/frontend/history-controls.mjs";

const source={node_id:"source:one",name:"Hall thermostat - temperature policy",kind:"entity"};
const episode={episode_id:"issue:one",anchor:source.node_id};
const pause={control_id:"pause:one",action:"shelve",target:episode.episode_id,until:"2026-10-15T17:30:00Z",reason:"Checking the sensor"};
const maintenance={control_id:"maintenance:one",action:"maintenance",target:source.node_id,until:"2026-10-15T18:00:00Z",include_dependents:true};
const data=()=>({inventory:{nodes:[source],episodes:[episode],attention_controls_supported:true,operator_controls:[pause,maintenance]},policy:{episodes:[]}});

function actionTools() {
  const title={textContent:""};
  const tools={
    card:{current:{status:"current",data:data()},_hass:{user:{is_admin:true}},detail:episode,detailSequence:0,dialog:{close(){}},displaySourceName:()=>"Hall thermostat"},
    body:{innerHTML:""},dialog:{open:false,querySelector:()=>title,showModal(){}},
    refreshFormState(){},refreshImmediate(){},clearSelection:DashboardTools.prototype.clearSelection,
  };
  return {tools,title};
}

test("scoped active controls preserve exact targets and expiries without repeating source identity",()=>{
  const html=controlsPanel(data(),[episode.episode_id]);
  assert.match(html,/class="active-controls"/);
  assert.match(html,/Notifications paused/);
  assert.match(html,/Until /);
  assert.match(html,/data-cancel-control="pause:one">Resume notifications…<\/button>/);
  assert.match(html,/everyone, including urgent notifications/);
  assert.match(html,/issue remains open/);
  assert.match(html,/Checking the sensor/);
  assert.doesNotMatch(html,/maintenance:one|Hall thermostat|class="panel"|class="note"/);
});

test("unscoped controls name equipment and retain dependent maintenance scope",()=>{
  const html=controlsPanel(data());
  assert.match(html,/class="control-target">Hall thermostat/);
  assert.match(html,/Also covers dependent equipment/);
  assert.match(html,/Existing problems and notifications remain active/);
  assert.match(html,/data-cancel-control="maintenance:one">End maintenance…<\/button>/);
});

test("acknowledgment has one quiet status and leaves pause and end-control actions available",()=>{
  const current=data();
  current.policy.episodes=[{episode_id:episode.episode_id,acknowledgment:{at:"2026-10-15T15:00:00Z"}}];
  const html=DashboardTools.prototype.detailButtons(source,episode,current);
  assert.equal(html.match(/Acknowledged/g).length,1);
  assert.match(html,/class="control-status"/);
  assert.match(html,/Awaiting recovery/);
  assert.match(html,/data-shelf="issue:one"/);
  assert.match(html,/data-cancel-control="pause:one">Resume notifications…<\/button>/);
  assert.doesNotMatch(html,/data-acknowledge|class="panel"|class="note"/);
});

for(const kind of ["shelve","maintenance"])test(`${kind} form shows one canonical target and preserves duration and scope controls`,()=>{
  const {tools,title}=actionTools();
  DashboardTools.prototype.openControl.call(tools,kind,kind==="shelve"?episode.episode_id:source.node_id);
  assert.equal(tools.body.innerHTML.match(/Hall thermostat/g).length,1);
  assert.doesNotMatch(tools.body.innerHTML,/temperature policy/);
  assert.match(tools.body.innerHTML,/class="control-target"/);
  assert.match(tools.body.innerHTML,/name="untilLocal" required/);
  assert.match(tools.body.innerHTML,/name="reason"/);
  if(kind==="shelve") {
    assert.equal(title.textContent,"Pause notifications");
    assert.match(tools.body.innerHTML,/this whole issue for everyone, including urgent notifications/);
    assert.match(tools.body.innerHTML,/Existing notifications are not dismissed; other issues are unaffected/);
    assert.match(tools.body.innerHTML,/An existing pause can only be extended/);
    assert.doesNotMatch(tools.body.innerHTML,/data-duration|includeDependents/);
  } else {
    assert.equal(title.textContent,"Working on this equipment");
    assert.match(tools.body.innerHTML,/Existing issues and notifications continue/);
    assert.match(tools.body.innerHTML,/data-duration="30"/);
    assert.match(tools.body.innerHTML,/name="includeDependents"/);
  }
});

for(const [action,target,title,consequence] of [
  ["acknowledge",episode.episode_id,"Acknowledge issue",/awareness of this issue for everyone.*acknowledgment-dependent reminders.*Other notifications may continue.*issue remains open until recovery/],
  ["cancel_control",pause.control_id,"Resume notifications",/notification rules and quiet hours.*Due notifications may be sent now.*Other pauses remain active/],
  ["cancel_control",maintenance.control_id,"End maintenance",/Problems still present may open now.*Other overlapping maintenance windows remain active/],
])test(`${title} confirmation names one target and retains its consequence`,()=>{
  const {tools,title:heading}=actionTools();
  DashboardTools.prototype.openImmediate.call(tools,action,target);
  assert.equal(heading.textContent,title);
  assert.equal(tools.body.innerHTML.match(/Hall thermostat/g).length,1);
  assert.doesNotMatch(tools.body.innerHTML,/temperature policy/);
  assert.match(tools.body.innerHTML,consequence);
  assert.match(tools.body.innerHTML,/<form class="tool-form">/);
  assert.match(tools.body.innerHTML,/data-immediate-feedback role="status" hidden/);
  assert.equal(tools.immediate.target,target);
});

for(const selected of [source,{...source,kind:"ups",check_id:"ups_power"}])test(`${selected.kind} issue actions name their purpose and target the exact issue`,()=>{
  const html=DashboardTools.prototype.detailButtons(selected,episode,data());
  assert.match(html,/data-acknowledge="issue:one">Acknowledge issue…<\/button>/);
  assert.match(html,/data-shelf="issue:one">Pause notifications…<\/button>/);
  assert.doesNotMatch(html,/\balerts\b|>Acknowledge…|>End now…/);
});