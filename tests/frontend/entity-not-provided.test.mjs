import assert from "node:assert/strict";
import {test} from "node:test";
import {notProvidedProblem,notProvidedVisible} from "../../custom_components/homeostatic/frontend/entity-not-provided.mjs";

test("The not-provided brief describes the registration and offers inspection",()=>{
  const source={kind:"entity_not_provided"},status={current:{status:"warn",reason:"entity_not_provided",message:"Robot integration is loaded but is not providing Dust emptying."}};
  const problem=notProvidedProblem(source,status);
  assert.equal(problem.headline,"Entity missing");
  assert.equal(problem.summary,status.current.message);
  assert.match(problem.nextStep,/Inspect the entity/);
  assert.doesNotMatch(JSON.stringify(problem),/obsolete|delete|cleanup/i);
  assert.equal(notProvidedVisible({status:"warn"},status),true);
});

for(const status of ["unknown","pass"])test(`Current ${status} provider evidence does not badge a retained warning`,()=>{
  const evidence={current:{status,reason:status==="pass"?"entity_provided":"provider_not_loaded"},last_failure:{status:"warn",reason:"entity_not_provided"}};
  assert.equal(notProvidedVisible({status:"warn"},evidence),false);
  assert.notEqual(notProvidedProblem({kind:"entity_not_provided"},evidence).tone,"warning");
});

test("Qualification and incomplete evidence cannot manufacture a visible warning",()=>{
  const warn={current:{status:"warn",reason:"entity_not_provided"}};
  assert.equal(notProvidedVisible({status:"unknown"},warn),false);
  assert.equal(notProvidedVisible({status:"warn"},null),false);
  assert.equal(notProvidedProblem({kind:"entity"},warn),null);
});
