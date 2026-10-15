import assert from "node:assert/strict";
import test from "node:test";
import {temperatureProblem} from "../../custom_components/homeostatic/frontend/source-temperature.mjs";
import {individualIssueFixture} from "./individual-issue-fixture.mjs";

for(const [condition,headline,meaning] of [
  ["low","Temperature below minimum",/68 °F.*below.*80 °F/],
  ["high","Temperature above maximum",/86 °F.*above.*80 °F/],
  ["stalled","Temperature is not reaching the target",/68 °F.*expected progress.*72 °F/],
  ["worsening","Temperature is moving away from the target",/66 °F.*moving away.*72 °F/],
])test(condition+" issue explains its captured condition without policy decoration",()=>{
  const {source,status,result,observation}=individualIssueFixture(condition);
  result.temperature_status.observation.message=source.name+": "+observation.message;
  const before=structuredClone(result),problem=temperatureProblem(source,status,result.temperature_status);
  assert.equal(problem.headline,headline);
  assert.equal(problem.currentReason,observation.reason);
  assert.match(problem.summary,meaning);
  assert.doesNotMatch(problem.summary,/Home Interior Temperature Monitoring|Limited in Home Assistant|Check the current state/);
  assert.deepEqual(result,before);
});

test("a current evidence gap does not reuse a previous warning or claim recovery",()=>{
  const {source,status}=individualIssueFixture("low"),{result}=individualIssueFixture("missing");
  const problem=temperatureProblem(source,status,result.temperature_status);
  assert.equal(problem.headline,"Waiting for a temperature reading");
  assert.equal(problem.currentReason,"temperature_evidence_missing");
  assert.doesNotMatch(JSON.stringify(problem),/68 °F|80 °F|within limits|recovered|back within/i);
});

test("an absent captured observation cannot fall back to an old numeric warning",()=>{
  const {source,status}=individualIssueFixture("low");
  const problem=temperatureProblem(source,status,{observation:null});
  assert.equal(problem.headline,"Waiting for a temperature reading");
  assert.doesNotMatch(JSON.stringify(problem),/68 °F|80 °F|back within/i);
});

test("usable recovery describes the current reading while the issue confirms recovery",()=>{
  const {source,status,result}=individualIssueFixture("recovered");
  const problem=temperatureProblem(source,status,result.temperature_status,true);
  assert.equal(problem.headline,"Temperature back within limits");
  assert.match(problem.summary,/within the configured range/);
  assert.doesNotMatch(problem.summary,/below|above|Limited in Home Assistant/);
});

test("other source types retain their own issue presentation",()=>{
  assert.equal(temperatureProblem({kind:"entity"},{current:{status:"warn",reason:"unavailable"}}),null);
});

for(const condition of ["low","high"])test(condition+" duration describes qualification rather than promising an alert",()=>{
  const {source,status,result}=individualIssueFixture(condition),problem=temperatureProblem(source,status,result.temperature_status);
  assert.match(problem.timing,/Observed outside limits for 1 hour/);
  assert.match(problem.detail,/Required duration: 1 hour/);
  assert.doesNotMatch(problem.detail,/Alert after/);
});
test("zero duration remains exact in the captured qualification explanation",()=>{
  const {source,status,result}=individualIssueFixture("low");
  result.temperature_status.observation.evidence.observed_seconds=0;
  result.temperature_status.observation.evidence.duration_seconds=0;
  const problem=temperatureProblem(source,status,result.temperature_status);
  assert.match(problem.timing,/Observed outside limits for 0 seconds/);
  assert.match(problem.detail,/Required duration: 0 seconds/);
  assert.doesNotMatch(problem.timing+problem.detail,/0 (days|hours|minutes)/);
});
