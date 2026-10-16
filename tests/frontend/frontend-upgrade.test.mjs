import assert from "node:assert/strict";
import test from "node:test";

test("a changed panel identity loads current code with older elements already registered",async t=>{
  globalThis.HTMLElement=class {};
  class OldPanel extends HTMLElement {}
  class OldCard extends HTMLElement {}
  const elements=new Map([["homeostatic-panel-v35",OldPanel],["homeostatic-card-v31",OldCard]]);
  globalThis.customElements={get:name=>elements.get(name),define(name,value){assert.equal(elements.has(name),false,`Duplicate element ${name}`);elements.set(name,value);}};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});

  await import("../../custom_components/homeostatic/frontend/homeostatic.js?upgrade=first");
  const Panel=elements.get("homeostatic-panel-v36"),Card=elements.get("homeostatic-card-v32");
  assert.equal(typeof Panel,"function");
  assert.equal(typeof Card,"function");
  assert.notEqual(Panel,OldPanel);
  assert.notEqual(Card,OldCard);
  assert.equal(Object.getPrototypeOf(Panel.prototype),Card.prototype);
  assert.equal(elements.get("homeostatic-panel-v35"),OldPanel);
  assert.equal(elements.get("homeostatic-card-v31"),OldCard);
  const dashboard=await elements.get("ll-strategy-dashboard-homeostatic").generate();
  assert.ok(dashboard.views.every(view=>view.cards.every(card=>card.type==="custom:homeostatic-card-v32")));

  await import("../../custom_components/homeostatic/frontend/homeostatic.js?upgrade=repeat");
  assert.equal(elements.get("homeostatic-panel-v36"),Panel);
  assert.equal(elements.get("homeostatic-card-v32"),Card);
});
