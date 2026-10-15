import assert from "node:assert/strict";
import test from "node:test";
import {integrationProblem,relatedSourceEvidence} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {relatedEvidenceDetails,relatedEvidenceMonitoring} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {visibleEpisodes} from "../../custom_components/homeostatic/frontend/model.mjs";
import {issueEvidenceFixture,lyricLocalize,LYRIC_ENTRY,THERMOSTAT_ENTITY} from "./issue-evidence-fixture.mjs";

const evidence=fixture=>relatedSourceEvidence(fixture.episode.reasons,fixture.nodes);
const members=value=>value.groups.flatMap(group=>group.members);
const problem=fixture=>integrationProblem(fixture.integration,fixture.episode.reasons,lyricLocalize,
  fixture.data.inventory.integration_evidence[LYRIC_ENTRY],true,fixture.nodes);

test("Lyric evidence counts real devices and entities while preserving overlapping checks",()=>{
  const fixture=issueEvidenceFixture(),before=structuredClone(fixture.data),result=evidence(fixture);
  assert.deepEqual(result.counts,{devices:3,entities:5,sources:8,checks:9});
  assert.equal(result.groups.length,3);
  assert.equal(result.headline,"Unavailable readings from 3 devices");
  assert.equal(result.unavailableOnly,true);
  const thermostat=result.groups.find(group=>group.deviceId==="thermostat");
  assert.equal(thermostat.name,"Main Floor Thermostat");
  assert.equal(thermostat.sourceId,"device:thermostat");
  assert.equal(thermostat.members.length,2);
  assert.deepEqual(thermostat.members.map(member=>member.kind).sort(),["device","entity"]);
  const entity=thermostat.members.find(member=>member.id===THERMOSTAT_ENTITY);
  assert.equal(entity.name,"Main Floor Thermostat");
  assert.equal(entity.findings.length,2);
  assert.equal(new Set(entity.findings.map(item=>item.finding.node_id)).size,2);
  assert.ok(entity.findings.every(item=>item.policy&&item.description));
  assert.deepEqual(fixture.data,before);
});

test("repeated findings do not increase canonical source or check counts",()=>{
  const fixture=issueEvidenceFixture(),first=fixture.episode.reasons[0];
  const result=relatedSourceEvidence([...fixture.episode.reasons,{...first}],fixture.nodes);
  assert.deepEqual(result.counts,{devices:3,entities:5,sources:8,checks:9});
});

test("missing canonical catalog rows use a conservative entity label and retain all policies",()=>{
  const fixture=issueEvidenceFixture({variant:"aliases"}),result=evidence(fixture);
  const entity=members(result).find(member=>member.id===THERMOSTAT_ENTITY);
  assert.equal(entity.name,"Thermostat");
  assert.equal(entity.findings.length,2);
  assert.deepEqual(entity.findings.map(item=>item.policy).sort(),["entities","thermostat-extra"]);
  assert.ok(entity.findings.every(item=>item.finding.message.includes("Main Floor Thermostat")));
  assert.deepEqual(result.counts,{devices:3,entities:5,sources:8,checks:9});
});

test("standalone entities remain outside device groups and use an honest source total",()=>{
  const result=evidence(issueEvidenceFixture({variant:"standalone"}));
  assert.deepEqual(result.counts,{devices:3,entities:6,sources:9,checks:10});
  assert.equal(result.groups.filter(group=>!group.deviceId).length,1);
  assert.equal(result.headline,"9 sources need attention");
  assert.equal(members(result).find(member=>member.id==="entity:registry:standalone").name,"Outdoor reading");
});

test("absent source metadata retains evidence without guessing a device or entity identity",()=>{
  const result=evidence(issueEvidenceFixture({variant:"missing"}));
  assert.deepEqual(result.counts,{devices:3,entities:5,sources:9,checks:10});
  const missing=members(result).find(member=>member.id==="monitoring:removed:entity:missing");
  assert.ok(missing);
  assert.equal(missing.findings.length,1);
  assert.equal(result.headline,"9 sources need attention");
  assert.equal(result.groups.filter(group=>!group.deviceId).length,1);
});

test("mixed conditions do not describe every finding as unavailable",()=>{
  const result=evidence(issueEvidenceFixture({variant:"mixed"}));
  assert.equal(result.unavailableOnly,false);
  assert.equal(result.headline,"8 sources need attention");
});

test("partial recovery preserves the issue while removing recovered findings from its current counts",()=>{
  const fixture=issueEvidenceFixture({state:"partial"}),before=structuredClone(fixture.data);
  assert.deepEqual(evidence(fixture).counts,{devices:2,entities:3,sources:5,checks:6});
  assert.equal(problem(fixture).headline,"Unavailable readings from 2 devices");
  assert.equal(visibleEpisodes(fixture.data).length,1);
  assert.ok(fixture.episode.recorded.some(id=>id.includes("third-floor")));
  assert.ok(evidence(fixture).groups.every(group=>group.deviceId!=="third-floor"));
  assert.deepEqual(fixture.data,before);
});

test("full recovery hides the current issue without changing engine-owned recorded membership",()=>{
  const fixture=issueEvidenceFixture({state:"recovered"}),before=structuredClone(fixture.data);
  assert.deepEqual(evidence(fixture).counts,{devices:0,entities:0,sources:0,checks:0});
  assert.equal(evidence(fixture).groups.length,0);
  assert.equal(visibleEpisodes(fixture.data).length,0);
  assert.equal(problem(fixture).tone,"recovering");
  assert.equal(fixture.data.inventory.episodes.length,1);
  assert.deepEqual(fixture.data,before);
});

test("disclosed evidence retains native device and canonical Sources actions",()=>{
  const result=evidence(issueEvidenceFixture());
  const html=relatedEvidenceDetails(result,new Set())+relatedEvidenceMonitoring(result);
  assert.match(html,/3 devices/);
  assert.match(html,/5 entities/);
  assert.match(html,/9 checks/);
  assert.match(html,/href="\/config\/devices\/device\/thermostat"/);
  assert.match(html,/data-source-link="device:thermostat"/);
  assert.match(html,/data-source-link="entity:registry:thermostat"/);
  assert.doesNotMatch(html,/data-source-link="monitoring:/);
  assert.match(html,/<details/);
  assert.doesNotMatch(html,/Inspect entity|Inspect device checks|class="button primary"/);
  assert.doesNotMatch(html,/<details[^>]* open/);
});

test("evidence names and descriptions are escaped before rendering",()=>{
  const fixture=issueEvidenceFixture();
  fixture.nodes.get("device:third-floor").name='<img src=x onerror="bad()">';
  fixture.episode.reasons[0].message='<script>alert("bad")</script>';
  const html=relatedEvidenceDetails(evidence(fixture),new Set());
  assert.doesNotMatch(html,/<img|<script/);
  assert.match(html,/&lt;img/);
});

test("contributing-check disclosure keeps its open state when evidence refreshes",()=>{
  const result=evidence(issueEvidenceFixture()),key=`checks:${THERMOSTAT_ENTITY}`;
  assert.match(relatedEvidenceDetails(result,new Set([key])),new RegExp(`data-disclosure="${key}" open`));
});

test("canonical names containing the policy delimiter stay intact",()=>{
  const fixture=issueEvidenceFixture();
  fixture.nodes.get(THERMOSTAT_ENTITY).name="Main Floor · East Thermostat";
  const result=evidence(fixture);
  assert.equal(members(result).find(member=>member.id===THERMOSTAT_ENTITY).name,"Main Floor · East Thermostat");
});

for(const reason of ["future_reason","constructor","__proto__"])test(`unknown reason ${reason} preserves the reported explanation`,()=>{
  const fixture=issueEvidenceFixture(),finding={...fixture.episode.reasons[0],reason,message:"Readable reported condition."};
  const result=relatedSourceEvidence([finding],fixture.nodes);
  assert.equal(members(result)[0].findings[0].description,"Readable reported condition.");
});


for (const reason of ["restored_state","source_missing","incomplete_evidence"]) {
  test(`passive ${reason} stays in Sources without an issue or false recovery`,()=>{
    const source={node_id:"entity:button",kind:"entity",check_id:"availability",watched:true};
    const finding={node_id:source.node_id,check_id:"availability",status:"unknown",reason:"stale"};
    const episode={episode_id:"gap",anchor:source.node_id,reasons:[finding]};
    const data={inventory:{nodes:[source],episodes:[episode],entity_status:{[source.node_id]:{current:{reason}}}}};
    const before=structuredClone(data);
    assert.deepEqual(visibleEpisodes(data),[]);
    assert.deepEqual(data,before);
    finding.status="fail";finding.reason="unavailable";
    assert.deepEqual(visibleEpisodes(data),[episode]);
  });
}

test("mixed failures, missing metadata and condition-specific evidence gaps remain visible",()=>{
  const a={node_id:"entity:a",kind:"entity",check_id:"availability"};
  const b={node_id:"entity:b",kind:"entity",check_id:"temperature"};
  const episode={episode_id:"mixed",anchor:a.node_id,reasons:[{node_id:a.node_id,check_id:"availability",status:"unknown",reason:"stale"},{node_id:b.node_id,check_id:"temperature",status:"unknown",reason:"stale"}]};
  const data={inventory:{nodes:[a,b],episodes:[episode]}};
  assert.deepEqual(visibleEpisodes(data),[episode]);
  data.inventory.nodes=[a];
  assert.deepEqual(visibleEpisodes(data),[episode]);
});

test("normal empty button value clears the visible availability issue during recovery hold",()=>{
  const source={node_id:"entity:button",kind:"entity",check_id:"availability",watched:true,entity_id:"button.resume"};
  const episode={episode_id:"gap",anchor:source.node_id,reasons:[{node_id:source.node_id,check_id:"availability",status:"unknown",reason:"stale"}]};
  const data={inventory:{nodes:[source],episodes:[episode],entity_status:{[source.node_id]:{current:{reason:"value_unknown"}}}}};
  assert.deepEqual(visibleEpisodes(data),[]);
  assert.equal(data.inventory.episodes.length,1);
});
