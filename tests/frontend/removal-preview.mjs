import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs?v=83";

const card=document.querySelector("homeostatic-panel"),copy=value=>structuredClone(value);
let saved,revision,data,calls,failNext=false;
const configuration=()=>({revision:String(revision),settings:copy(saved)});
const entryName=index=>index===15?"Alexa Media":`Example integration ${String(index+1).padStart(2,"0")}`;
function reset() {
  if(card.dialog.open)card.dialog.close();
  revision=1;calls=[];failNext=false;
  saved={notifications:false,monitoring_policies:[{id:"entities",name:"Entity availability",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[]}]};
  const nodes=[],episodes=[],entity_status={};
  for(let group=0;group<16;group++) {
    const owner=`example_${group}`;
    nodes.push({node_id:`entry:${owner}`,kind:"integration",entry_id:owner,name:entryName(group),attributes:{domain:[owner]}});
    for(let index=0;index<20;index++) {
      const id=`${group}_${index}`,entity={node_id:`entity:${id}`,entity_id:`sensor.example_${id}`,name:`${entryName(group)} reading ${index+1}`,kind:"entity",owner_id:owner,attributes:{integration:[owner]}},check={...entity,node_id:`check:${id}`,monitoring_source:entity.node_id,monitoring_policy:"entities",watched:true,check_id:"availability"};
      nodes.push(entity,check);
      entity_status[check.node_id]={current:{status:"warn",reason:"unavailable"}};
      episodes.push({episode_id:`issue:${id}`,anchor:check.node_id,recorded:[check.node_id],impact:[],reasons:[{node_id:check.node_id,status:"warn",reason:"unavailable",check_id:"availability",message:"Synthetic entity is unavailable"}],opened_at:`2026-10-15T12:${String(20-group).padStart(2,"0")}:00Z`});
    }
  }
  data={schema_version:3,catalog_loaded:true,catalog_revision:String(revision),available:true,entry_id:"example",updated_at:"2026-10-15T13:00:00Z",areas:[],floors:[],devices:[],readiness:{answer:"unknown",nodes:[]},functions:[],coverage:{no_checks:[],never_observed:[],stale:[]},policy:{notifications_enabled:false,routes:{},episodes:[]},inventory:{nodes,catalog:{candidates:nodes.filter(item=>!item.monitoring_policy)},episodes,entity_status,operator_controls:[],integration_evidence:{},notification_requests:[]}};
  Object.assign(card,{page:"problems",configuration:configuration(),settingsDraft:copy(saved),scopedConfiguration:null,availabilityPlan:null,issueAvailabilityPlan:null,issueAvailabilityEpisode:null,detail:null,availabilityContext:null,availabilityError:null,current:{status:"current",data},issueQuery:"",issueSort:"newest",issueGroupsExpanded:new Set(),sourcesSelection:null,sourcesQuery:"",sourcesExpanded:new Set(),sourcesMobileDetail:false,sourceDetail:null});
  card._hass.states=Object.fromEntries(data.inventory.catalog.candidates.filter(source=>source.entity_id).map(source=>[source.entity_id,{state:"unavailable",attributes:{}}]));
  initializeScopedConfiguration(card);card.render();report();
}
function report() {
  document.querySelector("#result").textContent=JSON.stringify({saveRequests:calls.filter(item=>item.type==="homeostatic/save_settings").length,excluded:saved.monitoring_policies[0].excluded_sources||[],notifications:saved.notifications,openedIssue:card.detail?.episodeId||null,pendingIssue:card.issueAvailabilityEpisode||null,pending:card.issueAvailabilityPlan?.sourceIds||[]},null,2);
}
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:key=>{
  const match=key.match(/^component\.example_(\d+)\.title$/);return match?entryName(Number(match[1])):null;
},async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/node") {
    const source=data.inventory.nodes.find(item=>item.node_id===request.node_id);
    if(!source)throw Error("Missing isolated detail source: "+request.node_id);
    const status=data.inventory.entity_status[source.node_id];
    const episode=data.inventory.episodes.find(item=>item.anchor===source.node_id);
    return {source:copy(source),entity_status:copy(status),explanation:{findings:copy(episode?.reasons||[]),nodes:[]},readiness:{answer:"unknown",nodes:[]},impact:{nodes:[]},monitoring_policies:saved.monitoring_policies.filter(policy=>policy.id===source.monitoring_policy),device_evidence:null,device_availability:null,integration_evidence:null};
  }
  if(request.type==="homeostatic/source") {
    const source=data.inventory.nodes.find(item=>item.node_id===request.node_id);
    return {source,nodeId:source.node_id,updated_at:data.updated_at,members:[{node_id:source.node_id,entity_id:source.entity_id,name:source.name,state:"unavailable"}],total:1,unavailable_count:1,unknown_count:0,entity_status:{current:{status:"warn",reason:"unavailable"}},monitoring_policies:[]};
  }
  if(request.type!=="homeostatic/save_settings")throw Error("Unexpected isolated request: "+request.type);
  if(failNext){failNext=false;throw Error("Synthetic temporary save failure");}
  if(request.revision!==String(revision))throw Error("Synthetic revision conflict");
  saved=copy(request.settings);revision++;
  const excluded=new Set(saved.monitoring_policies[0].excluded_sources),nodes=new Map(data.inventory.nodes.map(item=>[item.node_id,item]));
  data.inventory.episodes=data.inventory.episodes.filter(item=>!excluded.has(nodes.get(item.anchor).monitoring_source));
  for(const item of data.inventory.nodes.filter(item=>item.monitoring_policy))item.watched=!excluded.has(item.monitoring_source);
  data.catalog_revision=String(revision);report();return {saved:true};
}};
document.querySelector("#reset").onclick=reset;
document.querySelector("#fail").onclick=()=>{failNext=true;document.querySelector("#result").textContent="Next synthetic save will fail.";};
document.querySelector("#report").onclick=report;
document.querySelector("#source").onclick=()=>{card.detail=null;if(card.dialog.open)card.dialog.close();card.page="sources";card.sourcesSelection="source:entity:15_0";card.sourcesMobileDetail=true;card.render();card.loadSource("entity:15_0");};
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
reset();
