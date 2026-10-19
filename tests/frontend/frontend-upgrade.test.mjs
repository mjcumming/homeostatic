import assert from "node:assert/strict";
import test from "node:test";

test("a changed panel identity loads current code with older elements already registered",async t=>{
  globalThis.HTMLElement=class {};
  class OldPanel extends HTMLElement {}
  class OldCard extends HTMLElement {}
  const elements=new Map([["homeostatic-panel-v51",OldPanel],["homeostatic-card-v47",OldCard]]);
  globalThis.customElements={get:name=>elements.get(name),define(name,value){assert.equal(elements.has(name),false,`Duplicate element ${name}`);elements.set(name,value);}};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});

  await import("../../custom_components/homeostatic/frontend/homeostatic.js?upgrade=first");
  const Panel=elements.get("homeostatic-panel-v52"),Card=elements.get("homeostatic-card-v48");
  assert.equal(typeof Panel,"function");
  assert.equal(typeof Card,"function");
  assert.notEqual(Panel,OldPanel);
  assert.notEqual(Card,OldCard);
  assert.equal(Object.getPrototypeOf(Panel.prototype),Card.prototype);
  assert.equal(elements.get("homeostatic-panel-v51"),OldPanel);
  assert.equal(elements.get("homeostatic-card-v47"),OldCard);
  const dashboard=await elements.get("ll-strategy-dashboard-homeostatic").generate();
  assert.ok(dashboard.views.every(view=>view.cards.every(card=>card.type==="custom:homeostatic-card-v48")));

  await import("../../custom_components/homeostatic/frontend/homeostatic.js?upgrade=repeat");
  assert.equal(elements.get("homeostatic-panel-v52"),Panel);
  assert.equal(elements.get("homeostatic-card-v48"),Card);
});

test("a saved previous-version dashboard loads after a fresh browser start",async t=>{
  globalThis.HTMLElement=class {};
  const elements=new Map();
  globalThis.customElements={get:name=>elements.get(name),define(name,value){assert.equal(elements.has(name),false);elements.set(name,value);}};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?upgrade=saved-dashboard");
  const SavedCard=elements.get("homeostatic-card-v47"),CurrentCard=elements.get("homeostatic-card-v48");
  assert.equal(typeof SavedCard,"function");
  assert.notEqual(SavedCard,CurrentCard);
  assert.equal(Object.getPrototypeOf(SavedCard.prototype),CurrentCard.prototype);
});
