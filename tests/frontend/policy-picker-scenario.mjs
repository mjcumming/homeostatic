import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";
const card=document.querySelector("homeostatic-card"),root=card.shadowRoot,feedback=document.querySelector("#feedback"),copy=structuredClone;
const rows=[{node_id:"device:door",kind:"device",name:"Front door",attributes:{device:["door"]}},{node_id:"device:room",kind:"device",name:"Living room",attributes:{device:["room"]}}];
for(const [id,name,domain,device,integration,area] of [["lock","Lock","lock","door","zwave_js","hall"],["battery","Battery level","sensor","door","zwave_js","hall"],["motion","Motion","binary_sensor","door","zwave_js","hall"],["temperature","Temperature","sensor","room","esphome","living"],["humidity","Humidity","sensor","room","esphome","living"],["disabled","Disabled reading","sensor","room","esphome","living"],["loose","Weather feed","sensor",null,"rest",""]])rows.push({node_id:`entity:registry:${id}`,kind:"entity",name,entity_id:`${domain}.${id}`,disabled:id==="disabled",attributes:{kind:["entity"],entity:[`registry:${id}`],domain:[domain],integration_domain:[integration],...(device?{device:[device]}:{}),...(area?{area:[area]}:{})}});
const initial=notificationSettings();initial.monitoring_policies=[{...newMonitoringPolicy([],"entity"),id:"entities",name:"Entity availability",enabled:true,match:{kind:["entity"]},match_any:[{domain:["lock","camera"]}],excluded_sources:["entity:registry:missing"]},newMonitoringPolicy([],"battery")];
let saved=copy(initial),revision=1,reject=false,calls=[],receipt;
const configuration=()=>({revision:String(revision),settings:copy(saved),areas:[{id:"hall",name:"Hall"},{id:"living",name:"Living room"}],floors:[],labels:[],delivery_targets:[],monitoring_policy_templates:[]});
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},connection:{},config:{time_zone:"UTC"},states:{},localize:key=>({"component.esphome.title":"ESPHome","component.zwave_js.title":"Z-Wave JS","component.rest.title":"REST"})[key]||null,async callWS(request){calls.push(copy(request));if(request.type==="homeostatic/configuration")return configuration();if(request.type==="homeostatic/save_settings"){if(reject){reject=false;throw Error("Synthetic save rejection");}saved=copy(request.settings);revision++;return {saved:true};}throw Error(`Unexpected request: ${request.type}`);}};
const settle=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(null);});};
const find=selector=>{const el=root.querySelector(selector);if(!el)throw Error(`Missing ${selector}`);return el;};
const field=name=>`[data-definition-field="${name}"]`,action=name=>`[data-definition-action="${name}"]`,choice=id=>`${field("entity-choice")}[data-definition-value="entity:registry:${id}"]`;
const click=async selector=>{find(selector).click();await settle();},check=(value,message)=>{if(!value)throw Error(message);};
const change=async(selector,value)=>{const el=find(selector);el.focus();el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));await settle();};
const fill=async query=>{const el=find(field("entity-search"));el.focus();el.value=query;el.dispatchEvent(new Event("input",{bubbles:true}));await settle();};
const open=async name=>click(`.entity-selection-toggle[aria-label="Expand ${name}"]`);
function show(){card.page="policies";card.current={status:"current",data:{...monitoringExample(),schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:rows},episodes:[]}}};card.configuration=configuration();card.settingsDraft=copy(saved);card.scopedConfiguration=null;card.definitionSelection={kind:"policies",id:"entities"};card.entitySelection=null;card.render();document.querySelector("#saved-state").textContent=JSON.stringify(saved,null,2);}
async function run(){receipt={fixture:"policy-picker",synthetic:true,results:[]};const test=async(id,body)=>{try{await body();receipt.results.push({id,status:"pass"});}catch(error){receipt.results.push({id,status:"fail",evidence:[error.message]});throw error;}finally{document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);}};try{
 saved=copy(initial);calls=[];show();
 await test("entity-tree",async()=>{
  const before=JSON.stringify(card.settingsDraft);
  check(!root.querySelector(field("entity-choice")),"All integrations start collapsed");
  check([...root.querySelectorAll(".entity-selection-toggle")].every(el=>el.getAttribute("aria-expanded")==="false"),"Collapsed disclosure state");
  await open("Z-Wave JS");check(root.textContent.includes("Front door")&&!root.querySelector(field("entity-choice")),"Integration reveals collapsed devices");
  await open("Front door");check(find(choice("lock")),"Device reveals entities");
  await click('.entity-selection-toggle[aria-label="Collapse Z-Wave JS"]');check(!root.querySelector(field("entity-choice")),"Integration hides descendants");
  await open("Z-Wave JS");check(find(choice("lock")),"Reopening retains nested expansion");
  check(JSON.stringify(card.settingsDraft)===before&&calls.length===0&&!root.querySelector(action("save-scoped")),"Expansion cannot edit, save or create a dirty draft");
 });
 await test("entity-list",async()=>{
  check(!root.querySelector('.entity-selection input[type="radio"],.entity-selection .policy-picker-options'),"No retired picker");
  check(find(choice("lock")).checked&&!find(choice("battery")).checked,"Effective saved scope");
  await fill("disabled");check(find(choice("disabled")).disabled,"Search reveals disabled HA entities");
  await fill("sensor.battery");check(root.querySelectorAll(field("entity-choice")).length===1,"Full identifier search");check(root.activeElement===find(field("entity-search")),"Search focus");
  await click(field("entity-group"));await fill("");
  check(find(choice("battery")).checked&&find(choice("lock")).checked&&!find(choice("motion")).checked,"Filtered group changes preserve hidden choices");
  check(find('.entity-selection-toggle[aria-label="Expand ESPHome"]'),"Clearing search restores manual branches");
  check(card.settingsDraft.monitoring_policies[0].match_any[0].domain[0]==="lock","Future scope retained");check(calls.length===0,"Changes are drafts");
 });
 await test("entity-branch-selection",async()=>{
  const integration=`${field("entity-integration")}[data-definition-value="zwave_js"]`,device=`${field("entity-group")}[data-definition-value='["zwave_js","door"]']`;
  check(find(integration).indeterminate&&find(device).indeterminate,"Parent checkboxes show individual exceptions");
  await click('.entity-selection-toggle[aria-label="Collapse Z-Wave JS"]');
  await click(integration);check(find(integration).checked&&!find(integration).indeterminate,"Mixed integration selects all while collapsed");
  check(root.activeElement===find(integration),"Mixed-to-checked transition retains group focus");
  await open("Z-Wave JS");check(find(device).checked&&find(choice("motion")).checked,"All descendants selected");
  await click(device);check(!find(integration).checked&&!find(integration).indeterminate&&!find(choice("lock")).checked,"Device deselection updates its integration");
  await click(device);await click(choice("motion"));check(find(device).indeterminate&&find(integration).indeterminate,"One exception updates both ancestors");
  check(root.activeElement===find(choice("motion")),"Selection retains focus");
  check(!saved.monitoring_policies[0].included_sources,"Bulk changes remain unsaved");
 });
 await test("entity-save",async()=>{
  const other=copy(saved.monitoring_policies[1]);await click(action("save-scoped"));
  check(saved.monitoring_policies[0].included_sources.includes("entity:registry:battery"),"Exact override saved");check(JSON.stringify(saved.monitoring_policies[1])===JSON.stringify(other),"Other policy unchanged");
  show();check(!root.querySelector(field("entity-choice")),"Fresh editor starts collapsed after save");await open("Z-Wave JS");await open("Front door");check(find(choice("battery")).checked,"Reopen");
  await click(choice("lock"));await click(action("discard-scoped"));check(find(choice("lock")).checked,"Discard");
  reject=true;await click(choice("motion"));await click(action("save-scoped"));check(root.textContent.includes("Synthetic save rejection")&&find(choice("motion")).checked,"Failed save retains draft and branch");await click(action("discard-scoped"));
 });
 await test("entity-missing-loading",async()=>{
  await fill("missing");check(root.textContent.includes("Entity no longer in the list"),"Missing saved choice remains searchable");await click(action("entity-forget"));check(!card.settingsDraft.monitoring_policies[0].excluded_sources,"Remove saved choice");
  show();await fill("lock");card.current.data.catalog_stale=true;card.render();check(find(choice("lock")).disabled,"Stale catalog cannot change membership");card.current.data.catalog_stale=false;card.render();
 });
 await test("entity-household",async()=>{
  for(let n=0;n<704;n++)rows.push({node_id:`entity:registry:household-${n}`,kind:"entity",name:`Reading ${n}`,entity_id:`sensor.household_${n}`,attributes:{kind:["entity"],entity:[`registry:household-${n}`],domain:["sensor"],device:["room"],integration_domain:["esphome"]}});
  show();check(!root.querySelector(field("entity-choice")),"Large inventory starts compact");await open("ESPHome");await open("Living room");check(root.querySelectorAll(field("entity-choice")).length===707,"Complete device branch, no manual pagination");
  await click('.entity-selection-toggle[aria-label="Collapse Living room"]');await fill("sensor.household_703");await click(choice("household-703"));check(find(choice("household-703")).checked,"Selection beyond former page boundary");
  await fill("");check(!root.querySelector(field("entity-choice")),"Search restores collapsed device");rows.splice(9);show();
 });
 await test("entity-scroll",async()=>{
  const end=rows.length;
  try {
   for(let n=0;n<60;n++)rows.push({node_id:`entity:scroll-${n}`,kind:"entity",name:`Reading ${n}`,entity_id:`sensor.scroll_${n}`,attributes:{kind:["entity"],domain:["sensor"],integration_domain:[`${n<40?"a":"zz"}_${n}`]}});
   show();await open("ESPHome");await open("Living room");await open("Z-Wave JS");await open("Front door");
   const selector=expanded=>`.entity-selection-toggle[aria-label="${expanded?"Collapse":"Expand"} Z-Wave JS"]`,frame=()=>new Promise(requestAnimationFrame);
   find(selector(true)).scrollIntoView({block:"center"});await frame();await frame();
   const position=()=>find(selector(Boolean(root.querySelector(selector(true))))).getBoundingClientRect().top,before=position();
   await click(selector(true));await frame();check(Math.abs(position()-before)<2,"Collapse retains reading position");
   await click(selector(false));await frame();check(Math.abs(position()-before)<2,"Expand retains reading position");
   card.render();await frame();check(Math.abs(position()-before)<2,"Unchanged update retains reading position");
  } finally {rows.splice(end);show();}
 });
 await test("entity-filter-focus",async()=>{
  await click(field("entity-selected-only"));await click(`${field("entity-integration")}[data-definition-value="zwave_js"]`);
  check(root.activeElement===find(field("entity-selected-only")),"Filtering away a cleared group returns focus to Monitored only");show();
 });
 await test("selection-layout",async()=>{
  await open("ESPHome");await open("Living room");await open("Z-Wave JS");await open("Front door");await open("Unavailable selections");await open("Saved choices");
  const el=find(".entity-selection");check(el.scrollWidth<=el.clientWidth+1,"Fits viewport");check(![...el.querySelectorAll("*")].some(item=>["auto","scroll"].includes(getComputedStyle(item).overflowY)&&item.scrollHeight>item.clientHeight+1),"Only the page scrolls");
  check([...el.querySelectorAll(".entity-selection-row,.entity-selection-toggle")].every(item=>item.getBoundingClientRect().height>=44),"Disclosure and selection touch targets");
  check([...el.querySelectorAll(".entity-selection-toggle")].every(item=>getComputedStyle(item).borderTopWidth==="0px"),"Branches use the shared borderless disclosure control");
  check([...el.querySelectorAll(".entity-selection-toggle")].every(item=>item.querySelector(".disclosure").getBoundingClientRect().left-item.getBoundingClientRect().left<=16),"Branch disclosures align at the start of each level");
 });
 await test("availability-wait-save",async()=>{
  saved=copy(initial);show();const before=copy(saved),wait=field("parameters:duration_seconds");
  check(find(wait).value==="0"&&find(wait).dataset.durationUnit==="minutes","Existing absent wait shows zero minutes");
  check(!root.querySelector(action("save-scoped")),"Opening does not add a saved wait");
  await change(wait,"5");check(root.activeElement===find(wait),"Typing keeps native input focus");
  check(root.querySelector(".policy-rule").textContent.includes("5 minutes"),"Rule explains the qualification wait");
  await click(action("save-scoped"));check(saved.monitoring_policies[0].parameters.duration_seconds===300,"Policy saves exactly 300 seconds");
  before.monitoring_policies[0].parameters.duration_seconds=300;check(JSON.stringify(saved)===JSON.stringify(before),"Save changes only that policy wait");
  show();check(find(wait).value==="5","Saved wait reopens in minutes");
  await change(field("duration-unit:duration_seconds"),"hours");check(!root.querySelector(action("save-scoped"))&&saved.monitoring_policies[0].parameters.duration_seconds===300,"Display units do not edit the policy");
  await change(field("duration-unit:duration_seconds"),"seconds");check(find(wait).value==="300","Seconds preserve the exact value");
  await click(action("close"));check(root.textContent.includes("Unavailable for at least 5 minutes"),"Policy list includes the effective saved wait");show();
 });
 await test("availability-wait-invalid-discard",async()=>{
  const wait=field("parameters:duration_seconds"),savedBefore=JSON.stringify(saved),before=calls.filter(call=>call.type==="homeostatic/save_settings").length;
  await change(field("duration-unit:duration_seconds"),"seconds");await change(wait,"0.5");await click(action("save-scoped"));
  check(find(wait).getAttribute("aria-invalid")==="true"&&root.textContent.includes("whole number of seconds"),"Invalid duration has a nearby explanation");
  check(calls.filter(call=>call.type==="homeostatic/save_settings").length===before&&JSON.stringify(saved)===savedBefore,"Invalid duration sends no save");
  await click(action("discard-scoped"));check(find(wait).value==="300"&&!root.querySelector('[aria-invalid="true"]'),"Discard restores saved wait in the chosen unit");
  reject=true;await change(wait,"600");await click(action("save-scoped"));
  check(root.textContent.includes("Synthetic save rejection")&&find(wait).value==="600"&&JSON.stringify(saved)===savedBefore,"Failed save retains the draft without changing settings");
  await click(action("save-scoped"));check(saved.monitoring_policies[0].parameters.duration_seconds===600,"Deliberate retry saves the wait");
  await change(wait,"0");await click(action("save-scoped"));check(saved.monitoring_policies[0].parameters.duration_seconds===0,"Zero explicitly saves immediate qualification");show();
 });
 await test("availability-create-empty",async()=>{
  await click(action("close"));await click(action("add"));await change("[data-definition-template]","entity");await click(action("create"));
  const id=card.definitionSelection.id;
  check(!find(field("enabled")).checked,"New custom availability is disabled");
  check([...root.querySelectorAll(field("entity-integration"))].every(el=>!el.checked&&!el.indeterminate),"New custom policy selects nothing");
  check(root.textContent.includes("New entities start unchecked"),"Explicit scope is explained in the existing selector");
  await fill("lock");check(!find(choice("lock")).checked,"Browsing does not manufacture a selection");
  await click(action("save-scoped"));check(saved.monitoring_policies.find(policy=>policy.id===id).match.entity.length===0,"Saving zero selected entities is valid");
  show();await click(action("close"));await click(`${action("edit")}[data-definition-id="${id}"]`);
  const end=rows.length;
  try {rows.push({node_id:"entity:registry:later",kind:"entity",name:"Later camera",entity_id:"camera.later",attributes:{kind:["entity"],entity:["registry:later"],domain:["camera"],integration_domain:["rest"]}});card.render();await fill("camera.later");check(!find(choice("later")).checked,"Later entities remain unchecked after save and reopen");}
  finally {rows.splice(end);}
  await fill("lock");await click(choice("lock"));await click(action("save-scoped"));
  check(saved.monitoring_policies.find(policy=>policy.id===id).included_sources.includes("entity:registry:lock"),"An explicit choice saves to the custom policy");show();
 });
 await test("availability-category-flat",async()=>{
  const end=rows.length;
  rows.push({node_id:"entity:registry:camera",kind:"entity",name:"Front door camera",entity_id:"camera.front_door",attributes:{kind:["entity"],entity:["registry:camera"],domain:["camera"],integration_domain:["rest"],area:["hall"]}});
  try {
   show();await click(action("close"));await click(action("add"));await change("[data-definition-template]","entity");
   check(root.textContent.includes("Unavailable entities")&&root.querySelector("[data-definition-category]"),"Availability shows its category on the same Add policy form");
   await change("[data-definition-category]","cameras");await click(action("create"));
   const id=card.definitionSelection.id,choice=`${field("source-choice")}[data-definition-value="entity:registry:camera"]`;
   check(!root.querySelector(".entity-selection-tree")&&root.querySelectorAll(field("source-choice")).length===1,"Focused category has a flat eligible list");
   check(!find(choice).checked&&find(field("source-future")).value==="selected","Custom category starts empty without future enrollment");
   check(!root.querySelector('input[type="radio"],.policy-picker-options')&&!root.querySelector(action("finish-pick")),"No retired inclusion menu, picker or Done action");
   find(choice).focus();await click(choice);check(root.activeElement===find(choice),"Flat checkbox retains keyboard focus");
   await change(field("name"),"Entrance watchers");await click(action("save-scoped"));
   const stored=saved.monitoring_policies.find(policy=>policy.id===id);
   check(stored.match.domain[0]==="camera"&&stored.match.entity.length===0&&stored.included_sources.includes("entity:registry:camera"),"Rename and save preserve the category and explicit choice");
   show();await click(action("close"));await click(`${action("edit")}[data-definition-id="${id}"]`);
   check(find(choice).checked&&!root.querySelector(".entity-selection-tree"),"Renamed category reopens as a flat selected list");
   card.current.data.catalog_stale=true;card.render();check(find(choice).disabled&&find(field("source-future")).disabled,"Stale catalogs cannot change source scope");card.current.data.catalog_stale=false;card.render();
   await change(field("source-future"),"all");await click(action("save-scoped"));
   check(!Object.hasOwn(saved.monitoring_policies.find(policy=>policy.id===id).match,"entity"),"Future enrollment changes only through its explicit control");
   const list=root.querySelector(".source-selection");check(list.scrollWidth<=list.clientWidth+1,"Flat list fits the phone editor");
   check(![...list.querySelectorAll("*")].some(item=>["auto","scroll"].includes(getComputedStyle(item).overflowY)&&item.scrollHeight>item.clientHeight+1),"Only the page scrolls");
  }finally {rows.splice(end);card.definitionCategory="any";show();}
 });
 await test("availability-overlap-duplicate",async()=>{
  const other={...copy(saved.monitoring_policies[0]),id:"important",name:"Important equipment",match:{kind:["entity"]},parameters:{},notifications:[]};
  saved.monitoring_policies.push(other);saved.monitoring_policies[0].parameters.duration_seconds=300;show();
  check(root.textContent.includes("Other enabled policies also monitor selected entities"),"Overlapping enabled availability is visible in the source editor");
  const link=`${action("open-policy")}[data-definition-id="important"]`;
  check(find(link).textContent.includes("Unavailable without waiting"),"Other policy's independent wait is named");
  await change(field("duration-unit:duration_seconds"),"minutes");await change(field("parameters:duration_seconds"),"10");await click(link);
  check(card.definitionSelection.id==="important"&&card.settingsDraft.monitoring_policies[0].parameters.duration_seconds===600,"Existing policy link keeps the first policy's draft");
  await click(action("close"));const menu=find('[popovertarget="policy-actions-entities"]');menu.click();await settle();
  await click(`${action("duplicate")}[data-definition-id="entities"]`);
  const duplicate=card.settingsDraft.monitoring_policies.find(policy=>policy.id===card.definitionSelection.id);
  check(!duplicate.enabled&&duplicate.parameters.duration_seconds===600&&JSON.stringify(duplicate.match_any)===JSON.stringify(saved.monitoring_policies[0].match_any),"Duplicate preserves its source scope and detection in a disabled copy");
  await click(action("discard-scoped"));show();
  const wait=find(field("parameters:duration_seconds")),unit=find(field("duration-unit:duration_seconds"));
  check(wait.getBoundingClientRect().right<=root.querySelector(".installation-editor").getBoundingClientRect().right+1&&unit.getBoundingClientRect().right<=root.querySelector(".installation-editor").getBoundingClientRect().right+1,"Wait and unit fit the policy editor");
  wait.focus();check(root.activeElement===wait,"Qualification wait is keyboard reachable");
 });
 feedback.textContent=`PASS: ${receipt.results.length} entity-selection paths`;
}catch(error){feedback.textContent=`FAIL: ${error.message}`;throw error;}}
document.querySelector("#run").onclick=run;document.querySelector("#show").onclick=show;document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};show();
