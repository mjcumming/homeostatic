import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {temperatureFixture} from "./temperature-source-fixture.mjs";
import {DEVICE_ID,ENTITY_ID} from "./source-details-fixture.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot;
const copy=value=>structuredClone(value),base=temperatureFixture(),calls=[];
const sensor=base.current.data.inventory.nodes.find(source=>source.node_id===ENTITY_ID);
const original=copy(base.sourceDetail.temperature_checks[0]);
base.configuration.settings.notifications=false;
base.configuration.settings.notification_definitions={profiles:{},methods:{}};
const secondPolicy={...copy(base.configuration.settings.monitoring_policies.at(-1)),id:"second-temperature",name:"Second temperature policy",parameters:{unit:"°F",minimum:50,maximum:null,duration_seconds:0}};
base.configuration.settings.monitoring_policies.push(secondPolicy);
let revision=0,condition="waiting",overlap=false,excluded=false;
const check=(value,message)=>{if(!value)throw Error(message);};
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let attempt=0;attempt<50;attempt++){await frame();if(!card.sourceDetail?.loading&&!card.configBusy&&!card.scopedBusy)return;}throw Error("Temperature view did not settle");};
const timestamp=()=>new Date(Date.parse("2026-10-15T16:30:00Z")+revision*1000).toISOString();
function temperatureChecks() {
  const first=copy(original);
  if(condition==="warn")Object.assign(first,{observation:{...first.observation,status:"warn",reason:"temperature_low",message:"Temperature 68 °F is below the minimum 80 °F.",evidence:{...first.observation.evidence,observed_seconds:3600}},next_deadline:null});
  if(condition==="unknown")Object.assign(first,{observation:{status:"unknown",reason:"temperature_evidence_missing",message:"Home Assistant has no usable current temperature evidence.",evidence:{entity_id:sensor.entity_id,unit:"°F"}},next_deadline:null});
  const second={...copy(original),node_id:"temperature:second",policy_id:secondPolicy.id,policy_name:secondPolicy.name,observation:{status:"pass",reason:"temperature_in_range",message:"Temperature is within the configured range.",evidence:{temperature_celsius:20,minimum:50,maximum:null,unit:"°F",duration_seconds:0}},next_deadline:null};
  return overlap?[first,second]:[first];
}
function inventory() {
  const data=copy(base.current.data);data.updated_at=timestamp();data.catalog_loaded=true;
  data.inventory.resolved_history={episodes:[],retention:{max_age_days:30,max_episodes:100},started_at:"2026-10-15T12:00:00Z"};
  if(overlap)data.inventory.nodes.push({...copy(data.inventory.nodes.at(-1)),node_id:"temperature:second",monitoring_policy:secondPolicy.id,name:sensor.name+" · "+secondPolicy.name});
  if(excluded) {
    data.inventory.nodes=data.inventory.nodes.filter(source=>!(source.monitoring_source===ENTITY_ID&&["entities","devices"].includes(source.monitoring_policy)));
  }
  return data;
}
function detail(id,offset=0) {
  const all=id===DEVICE_ID?base.sourceDetail.members.filter(member=>!excluded||member.node_id!==ENTITY_ID):base.sourceDetail.members.filter(member=>member.node_id===id);
  const end=id===DEVICE_ID&&excluded?Math.min(offset+1,all.length):all.length;
  return {...copy(base.sourceDetail),nodeId:id,updated_at:timestamp(),members:copy(all.slice(offset,end)),total:all.length,offset,next_offset:end<all.length?end:null,
    device_availability:id===DEVICE_ID?copy(base.sourceDetail.device_availability):null,
    monitoring_policies:base.configuration.settings.monitoring_policies.filter(policy=>policy.id!==secondPolicy.id||overlap).map(({id,name})=>({id,name})),
    temperature_checks:[DEVICE_ID,ENTITY_ID].includes(id)?temperatureChecks():[]};
}
function publish() {revision++;card.current={status:"current",data:inventory()};card.render();}
function selectDevice() {card.page="sources";card.sourcesGrouping="integration";card.sourcesQuery="";card.sourcesSelection=`source:${DEVICE_ID}`;card.sourcesMobileDetail=true;card.revealSourcesSelection();card.render();}
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},localize:base._hass.localize,states:Object.fromEntries(base.sourceDetail.members.map(member=>[member.entity_id,{state:member.state,attributes:{unit_of_measurement:member.unit}}])),async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return copy(base.configuration);
  if(request.type==="homeostatic/source")return detail(request.node_id,request.offset||0);
  throw Error("Unexpected request in temperature fixture: "+request.type);
}};
Object.assign(card,{current:{status:"current",data:inventory()},configuration:copy(base.configuration),settingsDraft:copy(base.configuration.settings),page:"sources",sourcesGrouping:"integration",sourcesExpanded:new Set(base.sourcesExpanded),sourcesSelection:`source:${DEVICE_ID}`,sourcesMobileDetail:true,topomation:{locations:[{id:"room",name:"Thermostat room",entity_ids:[sensor.entity_id]}]}});
card.render();
root.addEventListener("click",event=>{if(event.target.closest("a[href]"))event.preventDefault();});
document.querySelector("#width").onchange=event=>card.style.width=`${event.target.value}px`;
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
document.querySelector("#show-device").onclick=selectDevice;
document.querySelector("#legacy-link").onclick=()=>card.navigation.applyPath("/sources/"+encodeURIComponent("source:temperature:home"));
document.querySelector("#condition").onchange=event=>{condition=event.target.value;publish();};
document.querySelector("#overlap").onchange=event=>{overlap=event.target.checked;publish();};
document.querySelector("#exclude").onchange=event=>{excluded=event.target.checked;publish();};
const find=(selector,scope=root)=>{const target=scope.querySelector(selector);check(target,"Missing "+selector);return target;};
const click=async(selector,scope=root)=>{const target=find(selector,scope);check(!target.disabled&&target.getClientRects().length,"Reachable "+selector);target.scrollIntoView({block:"nearest"});target.click();await settle();};
const change=async(selector,value,scope=root)=>{const target=find(selector,scope);check(!target.disabled&&target.getClientRects().length,"Reachable "+selector);if(target.type==="checkbox")target.checked=value;else target.value=value;target.dispatchEvent(new Event(target.type==="search"?"input":"change",{bubbles:true,composed:true}));await settle();};
const showTree=async()=>{const back=root.querySelector('[data-action="back-sources"]');if(back?.getClientRects().length)await click('[data-action="back-sources"]');};
const article=()=>find('[data-temperature-check="temperature:home"]');
const detailText=()=>find(".config-detail").innerText;

document.querySelector("#run").onclick=async()=>{
  const button=document.querySelector("#run"),result=document.querySelector("#result");button.disabled=true;
  const receipt=emptyReceipt({fixture:"temperature-monitoring.html",browser:navigator.userAgent,build:"working tree",transport:"synthetic inventory and source replies; no live calls"});
  const id="sources.temperature-monitoring";
  try {
    condition="waiting";overlap=false;excluded=false;document.querySelector("#condition").value=condition;document.querySelector("#overlap").checked=false;document.querySelector("#exclude").checked=false;
    card.sourcesMonitoring="all";publish();selectDevice();await settle();
    const settings=JSON.stringify(card.configuration.settings),states=JSON.stringify(card._hass.states);
    check(detailText().includes("Home Interior Temperature Monitoring")&&article().innerText.includes("Waiting")&&article().innerText.includes("1 hour"),"Thermostat shows named policy and one-hour waiting state without opening Details");
    check(!root.querySelector(".source-monitoring-explanation"),"Short device evidence needs no Details disclosure");
    for(const grouping of ["integration","location","topomation"]) {
      await showTree();await change("[data-sources-group]",grouping);await change("[data-sources-search]",sensor.entity_id);
      const rows=[...root.querySelectorAll('[data-sources-select="source:'+ENTITY_ID+'"]')];
      check(rows.length===1,"One real temperature sensor in "+grouping+" grouping");
      check(![...root.querySelectorAll("[data-sources-select]")].some(row=>row.dataset.sourcesSelect==="source:temperature:home"||row.textContent.includes("Other sources")),"No duplicate derived source in "+grouping+" grouping");
      await click('[data-sources-select="source:'+ENTITY_ID+'"]');
      check(article().innerText.includes("Waiting")&&find("#sources-detail-title").textContent===sensor.name,"Real sensor opens its captured temperature state");
    }
    await click("#legacy-link",document);
    check(card.sourcesSelection===`source:${ENTITY_ID}`&&article().innerText.includes("Waiting"),"Old derived temperature route resolves to the real sensor");
    await click("#show-device",document);
    await click('[data-definition-action="open-policy"][data-definition-id="home-temperature"]');
    check(card.page==="policies"&&card.definitionSelection?.id==="home-temperature"&&root.querySelector('[data-definition-field="name"]').value==="Home Interior Temperature Monitoring","Device policy link opens the actual temperature editor");
    await click('.nav [data-page="sources"]');await click("#show-device",document);
    await change("#condition","warn",document);
    check(article().innerText.includes("Temperature needs attention")&&!article().innerText.includes("Waiting"),"Elapsed duration refreshes waiting to warning without a Home Assistant state change");
    check(JSON.stringify(card._hass.states)===states,"Captured condition update leaves HA values unchanged");
    await change("#condition","unknown",document);
    check(article().innerText.includes("Waiting for a temperature reading")&&!/Within limits|68 °F|0 °F|Minimum|NaN/.test(article().innerText),"Missing evidence cannot display a healthy verdict or a fabricated numeric temperature");
    await change("#condition","waiting",document);await change("#overlap",true,document);
    check(root.querySelectorAll("[data-temperature-check]").length===2&&article().innerText.includes("Waiting")&&find('[data-temperature-check="temperature:second"]').innerText.includes("Within limits"),"Overlapping policies retain distinct waiting and clear verdicts");
    await change("#exclude",true,document);
    check(card.sourceDetail.members.length===1&&card.sourceDetail.total===2&&!card.sourceDetail.members.some(member=>member.node_id===ENTITY_ID),"Excluded sensor is absent from paginated device availability evidence");
    check(root.querySelectorAll("[data-temperature-check]").length===2&&article().innerText.includes("Waiting"),"Independent temperature policies remain visible despite availability exclusion and pagination");
    await click('[data-action="more-source-evidence"]');
    check(card.sourceDetail.members.length===2&&root.querySelectorAll("[data-temperature-check]").length===2,"Loading another availability page preserves both temperature checks");
    await click('.source-temperature [data-source-link="'+ENTITY_ID+'"]');
    check(card.sourcesSelection===`source:${ENTITY_ID}`&&article().innerText.includes("Waiting"),"Temperature reading link reaches the availability-excluded sensor");
    const monitoring=root.querySelector(".source-monitoring-status").innerText;
    check(!monitoring.toLowerCase().includes("availability")&&monitoring.toLowerCase().includes("temperature"),"Temperature-only sensor coverage does not invent availability monitoring");
    await click("#show-device",document);
    const pane=find(".config-detail");check(pane.scrollWidth<=pane.clientWidth,"Temperature details have no horizontal overflow");
    check(JSON.stringify(card.configuration.settings)===settings&&!calls.some(request=>request.type==="homeostatic/save_settings"),"Browsing, grouping, linking and evidence updates never save settings");
    receipt.presentation={card_width:card.clientWidth,theme:document.documentElement.dataset.theme||"light",viewport_width:window.innerWidth};
    recordResult(receipt,id,"pass","Rendered integration/location/TopoMation grouping, one canonical sensor, old route, thermostat policy and Waiting, actual editor link, pending-to-warning update with unchanged HA states, truthful missing evidence, independent overlapping verdicts, availability exclusion and pagination, reading navigation, unchanged settings and no horizontal overflow.");
    result.textContent="Temperature monitoring checks passed";
  } catch(error) {recordResult(receipt,id,"fail",error.message);result.textContent="Failed: "+error.message;}
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);button.disabled=false;
};
