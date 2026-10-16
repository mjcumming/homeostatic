import test from "node:test";
import assert from "node:assert/strict";
import {retainedProblem,waitingOnly,sharedDeviceCondition} from "../../custom_components/homeostatic/frontend/check-presentation.mjs";
import {visibleEpisodes} from "../../custom_components/homeostatic/frontend/model.mjs";
import {issueDeviceGroups,issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {issueEvidenceFixture} from "./issue-evidence-fixture.mjs";
import {vacuumProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";

test("a shared device never inherits integration recovery without current device evidence",()=>{
  const data={inventory:{entity_status:{}}};
  const episode={anchor:"integration",recorded:["integration","device"],sharedDeviceCount:4};
  const problem={headline:"Running — confirming recovery",relatedFindings:[]};
  assert.equal(sharedDeviceCondition(data,episode,problem),"Waiting for current device information");
  data.inventory.entity_status.device={current:{status:"unknown"}};
  assert.equal(sharedDeviceCondition(data,episode,problem),"Waiting for current device information");
  data.inventory.entity_status.device.current.status="pass";
  assert.equal(sharedDeviceCondition(data,episode,problem),"Current checks available");
  problem.relatedFindings=[{status:"warn"}];
  assert.equal(sharedDeviceCondition(data,episode,problem),null);
});

test("shared availability is projected by device without changing original findings or action identity",()=>{
  const {data,episode}=issueEvidenceFixture();
  const before=structuredClone(episode),groups=issueDeviceGroups(data,[episode]);
  assert.equal(groups.length,3);
  for(const group of groups){
    assert.equal(group.episodes[0].episode_id,episode.episode_id);
    assert.equal(group.episodes[0].sharedDeviceCount,3);
    assert.ok(group.episodes[0].reasons.length<episode.reasons.length);
  }
  assert.deepEqual(episode,before);
  data.inventory.integration_evidence[episode.anchor].current.reason="setup_error";
  assert.equal(issueDeviceGroups(data,[episode])[0].deviceId,null);
});

for(const kind of ["vacuum","battery","temperature_limit"])test(`${kind} waiting is supporting context but a previous problem remains an issue`,()=>{
  const {data,episode}=issueEvidenceFixture({variant:"phone"});
  const member=data.inventory.nodes.find(source=>source.kind==="entity");
  const check={...member,kind,node_id:`check:${kind}`,name:`${member.name} · Custom policy`,check_id:kind,monitoring_source:member.node_id};
  const waiting={...episode,episode_id:"waiting",anchor:check.node_id,recorded:[check.node_id],reasons:[{node_id:check.node_id,status:"unknown",reason:"missing"}]};
  data.inventory.nodes.push(check);data.inventory.episodes.push(waiting);
  data.inventory.entity_status={[check.node_id]:{current:{status:"unknown",reason:"vacuum_unavailable",message:"Home Assistant reports the entity unavailable."},last_failure:null}};
  assert.equal(waitingOnly(data,waiting),true);
  assert.ok(!visibleEpisodes(data).includes(waiting));
  const card={current:{data},issueGroupsExpanded:new Set(["integration:mobile_app"]),issueRow:(_,item)=>`<button data-episode="${item.episode_id}"></button>`};
  const html=issuesWorkspace(card);
  assert.match(html,/data-waiting-device="synthetic-iphone"/);
  assert.match(html,/Home Assistant reports the entity unavailable/);
  assert.doesNotMatch(html,/<details/);
  assert.match(html,/Custom policy/);
  assert.doesNotMatch(html,/data-episode="waiting"/);
  data.inventory.entity_status[check.node_id].last_failure={reason:"fault",message:"Previously reported problem"};
  assert.ok(visibleEpisodes(data).includes(waiting));
  delete data.inventory.entity_status[check.node_id].last_failure;
  assert.ok(visibleEpisodes(data).includes(waiting),"Incomplete history must not establish no previous problem");
});

test("a retained vacuum error states the current limitation and normal activity removes the old report",()=>{
  const source={kind:"vacuum",name:"Vacuum",attributes:{}};
  const status={current:{status:"unknown",reason:"vacuum_unavailable",message:"Home Assistant reports the vacuum unavailable."},last_failure:{reason:"vacuum_error",message:"Home Assistant reports the vacuum in error.",observed_at:"2026-10-16T10:00:00Z"}};
  const problem=retainedProblem(vacuumProblem(source,status),status);
  assert.equal(problem.headline,"Vacuum error — current status unavailable");
  assert.match(problem.summary,/in error/);
  assert.match(problem.nextStep,/unavailable/);
  status.current={status:"pass",reason:"docked"};status.last_failure=null;
  assert.equal(retainedProblem(vacuumProblem(source,status),status).headline,"Vacuum error clearing");
});
