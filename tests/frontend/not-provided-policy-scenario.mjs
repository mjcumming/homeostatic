import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const card=document.querySelector("homeostatic-card"),root=card.shadowRoot,copy=structuredClone,feedback=document.querySelector("#feedback");
const entity=baseSource("entity:registry:diagnostic","Old integration reading","entity",{entity_id:"sensor.old_reading",owner_id:"provider",attributes:{kind:["entity"],entity:["registry:diagnostic"],domain:["sensor"],entity_category:["diagnostic"],integration:["provider"]}});
const other=baseSource("entity:registry:ordinary","Ordinary reading","entity",{entity_id:"sensor.ordinary",owner_id:"provider",attributes:{kind:["entity"],entity:["registry:ordinary"],domain:["sensor"],integration:["provider"]}});
const disabled={...copy(other),node_id:"entity:registry:disabled",entity_id:"sensor.disabled",name:"Disabled reading",disabled:true,attributes:{...other.attributes,entity:["registry:disabled"]}};
const entry=baseSource("entry:provider","Robot provider","integration",{entry_id:"provider",attributes:{domain:["test_provider"]}});
let saved=notificationSettings(),revision=1,reject=false,calls=[],opened=null,checkSource=null,episode=null,evidence=null;
const data=monitoringExample();data.schema_version=3;data.catalog_loaded=true;data.devices=[];data.inventory.nodes=[entry,entity,other,disabled];data.inventory.catalog.candidates=data.inventory.nodes;
data.inventory.attention_controls_supported=true;
const configuration=()=>({revision:String(revision),settings:copy(saved),areas:[],floors:[],labels:[],monitoring_policy_templates:[],delivery_targets:[]});
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},connection:{},config:{time_zone:"UTC"},states:{},localize:()=>null,async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/save_settings"){if(reject){reject=false;throw Error("Synthetic save failure");}saved=copy(request.settings);revision++;return {saved:true};}
  if(request.type==="homeostatic/node")return {source:checkSource,entity_status:evidence,explanation:{findings:episode.reasons,nodes:[]},readiness:{answer:"degraded",nodes:[]},impact:{nodes:[]},monitoring_policies:[{id:checkSource.monitoring_policy,name:"Entities not provided"}]};
  if(request.type==="homeostatic/source")return {source:entity,updated_at:data.updated_at,monitoring_policies:[{id:checkSource.monitoring_policy,name:"Entities not provided"}],members:[],temperature_checks:[],battery_conditions:[]};
  throw Error(`Unexpected isolated request: ${request.type}`);
}};
card.addEventListener("hass-more-info",event=>{opened=event.detail.entityId;});
const settle=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(null);});};
const find=selector=>{const el=root.querySelector(selector);if(!el)throw Error(`Missing ${selector}`);return el;};
const click=async selector=>{find(selector).click();await settle();};
const fill=async(selector,value)=>{const el=find(selector);el.value=value;el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true,composed:true}));await settle();};
const check=(value,message)=>{if(!value)throw Error(message);};
const action=name=>`[data-definition-action="${name}"]`,field=name=>`[data-definition-field="${name}"]`;
function show(){card.current={status:"current",data};card.configuration=configuration();card.settingsDraft=copy(saved);card.scopedConfiguration=null;card.page="policies";card.definitionSelection=null;card.render();}
async function run(){const results=[];const record=async(id,body)=>{try{await body();results.push({id,status:"pass"});}catch(error){results.push({id,status:"fail",evidence:error.message});throw error;}finally{document.querySelector("#receipt").textContent=JSON.stringify({fixture:"not-provided-policy",synthetic:true,results},null,2);}};
try{
  show();const original=copy(saved.monitoring_policies[0]);
  await record("policies.not-provided",async()=>{
    await click(action("add"));
    const typeNames=[...find("[data-definition-template]").options].map(option=>option.textContent);
    check(JSON.stringify(typeNames)===JSON.stringify([...typeNames].sort((a,b)=>a.localeCompare(b))),"Monitoring types are alphabetical");
    await fill("[data-definition-template]","entity_not_provided");await click(action("create"));
    check(root.textContent.includes("Entities not provided"),"New monitoring type is named");
    check(find(field("parameters:duration_seconds")).value==="24","24-hour default");
    check(!root.querySelector(field("entity-choice")),"Entity inventory starts collapsed");
    await click('.entity-selection-toggle[aria-label="Expand Other entities"]');
    await click('.entity-selection-toggle[aria-label="Expand Without a device"]');
    check(find(`${field("entity-choice")}[data-definition-value="${entity.node_id}"]`).checked,"Enabled diagnostic is eligible");
    check(find(`${field("entity-choice")}[data-definition-value="${disabled.node_id}"]`).disabled,"Disabled registration cannot be selected");
    await click(`${field("entity-choice")}[data-definition-value="${other.node_id}"]`);
    await fill(field("parameters:duration_seconds"),"2");await click('[aria-label="Policy enabled"]');await click(action("save-scoped"));
    const policy=saved.monitoring_policies.find(row=>row.check==="entity_not_provided");
    check(policy.enabled&&policy.parameters.duration_seconds===7200,"Scoped save persists the duration and enabled state");
    check(policy.excluded_sources.includes(other.node_id),"Selection persisted");check(JSON.stringify(saved.monitoring_policies[0])===JSON.stringify(original),"Unrelated policy unchanged");
    await fill(field("parameters:duration_seconds"),"3");await click(action("discard-scoped"));check(find(field("parameters:duration_seconds")).value==="2","Discard restores duration");
    reject=true;await fill(field("parameters:duration_seconds"),"4");await click(action("save-scoped"));check(root.textContent.includes("Synthetic save failure")&&find(field("parameters:duration_seconds")).value==="4","Failed save retains draft");await click(action("discard-scoped"));
  });
  await record("issues.not-provided",async()=>{
    const policy=saved.monitoring_policies.find(row=>row.check==="entity_not_provided");
    checkSource={...copy(entity),node_id:"monitoring:not-provided:entity:diagnostic",kind:"entity_not_provided",check_id:"entity_not_provided",monitoring_source:entity.node_id,monitoring_policy:policy.id,watched:true};
    const current={status:"warn",reason:"entity_not_provided",message:"Robot provider is loaded but is not providing Old integration reading."};
    episode={episode_id:"not-provided-issue",anchor:checkSource.node_id,status:"warn",recorded:[],impact:[],importance:"normal",opened_at:"2026-10-18T12:00:00Z",reasons:[{node_id:checkSource.node_id,check_id:"entity_not_provided",...current}]};evidence={current,last_failure:current};
    data.inventory.nodes=[entry,entity,other,disabled,checkSource];data.inventory.catalog.candidates=data.inventory.nodes;data.inventory.episodes=[episode];data.inventory.entity_status={[checkSource.node_id]:evidence};
    card.current={status:"current",data};card.page="problems";card.definitionSelection=null;card.render();await fill("[data-issue-search]","Old integration reading");await click('[data-episode="not-provided-issue"]');
    check(card.dialog.open&&root.querySelector(".dialog-body").textContent.includes("Entity not provided"),"Issue uses the condition's actual name");
    const entityButton=root.querySelector(`[data-entity="${entity.entity_id}"]`);check(Boolean(entityButton),"Open entity is available");entityButton.click();await settle();check(opened===entity.entity_id,"Entity link targets the real entity");await click('[data-episode="not-provided-issue"]');
    check(!root.querySelector('[data-delete-entity],[data-cleanup-entity]'),"No entity mutation controls");check(!calls.some(request=>request.type==="call_service"),"Inspection requests no services");
  });
  feedback.textContent=`PASS: ${results.length} not-provided policy paths`;
}catch(error){feedback.textContent=`FAIL: ${error.message}`;throw error;}}
document.querySelector("#run").onclick=run;document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";};show();
