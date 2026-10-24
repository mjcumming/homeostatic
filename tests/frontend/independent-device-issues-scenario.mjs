import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";
import {independentDeviceIssuesFixture,independentDeviceReply,deviceNames,fixtureTime} from "./independent-device-issues-fixture.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,calls=[];
let fixture;
const copy=value=>structuredClone(value);
const check=(value,message)=>{if(!value)throw Error(message);};
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let index=0;index<8;index++)await frame();};
const find=(selector,scope=root)=>{const element=scope.querySelector(selector);check(element,"Missing "+selector);return element;};
const click=async(selector,scope=root)=>{const element=find(selector,scope);check(!element.disabled&&element.getClientRects().length&&!element.closest("[inert]"),"Reachable "+selector);element.scrollIntoView({block:"nearest"});element.click();await settle();};
const close=async()=>{if(card.tools.dialog.open)await click('[data-tool="close"]',card.tools.dialog);if(card.dialog.open)await click('[data-action="close"]',card.dialog);};
const mutations=()=>calls.filter(request=>request.type==="call_service");
const configuration=()=>({revision:"independent-devices",settings:copy(fixture.settings),delivery_targets:[],notification_people:[],monitoring_policy_templates:[],areas:[],labels:[],floors:[]});
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},localize:key=>key==="component.matter.title"?"Matter":null,states:{},async callWS(request){
  calls.push(copy(request));
  if(request.type==="homeostatic/configuration")return configuration();
  if(request.type==="homeostatic/node")return independentDeviceReply(fixture,request.node_id);
  if(request.type==="homeostatic/source") {
    const reply=independentDeviceReply(fixture,request.node_id);
    return {...reply,...reply.device_evidence};
  }
  if(request.type!=="call_service")throw Error("Unexpected isolated request: "+request.type);
  const id=request.service_data.episode_id;
  check(fixture.data.inventory.episodes.some(episode=>episode.episode_id===id),"Action targets an open issue");
  if(request.service==="acknowledge") {
    const acknowledgment={episode_id:id,at:fixtureTime,actor_id:"fixture"};
    fixture.data.policy.episodes.push({episode_id:id,acknowledgment,require_acknowledgment:true});
    return {response:{acknowledgment}};
  }
  if(request.service==="shelve") {
    const control={control_id:"isolated-pause",action:"shelve",target:id,until:request.service_data.until,reason:request.service_data.reason};
    fixture.data.inventory.operator_controls.push(control);return {response:{control}};
  }
  throw Error("Unexpected isolated service: "+request.service);
}};
function reset(integrationFailed=false) {
  card.tools.close();if(card.dialog.open)card.dialog.close();fixture=independentDeviceIssuesFixture({integrationFailed});calls.length=0;
  card._hass.states=Object.fromEntries(Object.keys(deviceNames).map(id=>[`light.${id}`,{state:"unavailable",attributes:{}}]));
  Object.assign(card,{current:{status:"current",data:fixture.data},editors:{configuration:configuration(),settingsDraft:copy(fixture.settings),scopedConfiguration:null},page:"problems",detail:null,issueQuery:"",issueSort:"name",issueGroupsExpanded:new Set(["integration:matter"]),issueGroupLimits:new Map(),issueAvailabilityPlan:null,issueAvailabilityEpisode:null});
  initializeScopedConfiguration(card.editors);card.render();
}
async function openIssue(id="issue:devices:deck") {
  await close();await click('[data-page="problems"]');
  if(find('[data-issue-group="integration:matter"]').getAttribute("aria-expanded")==="false")await click('[data-issue-group="integration:matter"]');
  const episode=fixture.data.inventory.episodes.find(item=>item.episode_id===id);
  const source=fixture.data.inventory.nodes.find(item=>item.node_id===episode.anchor);
  const device=source.attributes?.device?.[0];
  await click(device?`[data-device-issues="${device}"]`:`[data-episode="${id}"]`);check(card.dialog.open,"Selected issue opens");
  for(const choice of card.dialog.querySelectorAll('[data-device-issue-select]')) {
    if(choice.checked!==(choice.dataset.deviceIssueSelect===id)){choice.checked=choice.dataset.deviceIssueSelect===id;choice.dispatchEvent(new Event('change',{bubbles:true}));await settle();}
  }
}
const endTime=()=>{const time=new Date(Date.now()+3600000);time.setMinutes(time.getMinutes()-time.getTimezoneOffset());return time.toISOString().slice(0,16);};
const noOverflow=()=>check(find(".shell").scrollWidth<=find(".shell").clientWidth+1,"Panel fits viewport");
async function showHistory() {await close();await click('[data-page="history"]');await click('[data-history-toggle="former-matter-group"]');}
document.querySelector("#dark").onchange=event=>document.documentElement.dataset.theme=event.target.checked?"dark":"light";
document.querySelector("#light").onclick=async()=>{reset();await openIssue();};
document.querySelector("#outage").onclick=async()=>{reset(true);await openIssue("matter-outage");};
document.querySelector("#history").onclick=async()=>{reset();await showHistory();};
document.querySelector("#settings").onclick=async()=>{reset();await click('[data-page="configuration"]');};
root.addEventListener("click",event=>{if(event.target.closest("a[href]"))event.preventDefault();});

document.querySelector("#run").onclick=async()=>{
  const button=document.querySelector("#run"),feedback=document.querySelector("#feedback");button.disabled=true;
  const receipt=emptyReceipt({fixture:"independent-device-issues.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",transport:"synthetic inventory and mocked actions"});
  const report=()=>{document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"independent-device-issues.html",receipt},location.origin);};
  const path=async(id,run,evidence)=>{try{await run();recordResult(receipt,id,"pass",evidence);}catch(error){recordResult(receipt,id,"fail",error.message);throw error;}finally{report();}};
  try {
    await path("issues.independent-devices",async()=>{
      reset();await settle();
      check(root.querySelectorAll("[data-device-issues]").length===4,"Four device entries remain reachable, with the overlapping policy inside its owner");
      await openIssue();const text=card.dialog.innerText;
      check(text.includes(deviceNames.deck),"Light's name is visible");
      for(const name of [deviceNames.hallway,deviceNames.mudroom,deviceNames.plug])check(!text.includes(name),"Unrelated device stays out: "+name);
      check(card.dialog.querySelectorAll('[data-device-issue-select]').length===2,"Overlapping policy keeps its separate selectable issue");
      await click('[data-device-response="acknowledge"]',card.dialog);
      await click('[data-device-response="pause"]',card.dialog);await click('[data-device-response="apply-pause"]',card.dialog);
      check(mutations().length===2&&mutations().every(request=>request.service_data.episode_id==="issue:devices:deck"),"Only the selected light issue received mock acknowledgment and pause");
      for(const id of ["issue:devices:hallway","issue:devices:mudroom","issue:devices:plug","issue:deck-extra:deck"]) {
        await openIssue(id);check(!find('[data-device-response="acknowledge"]',card.dialog).disabled,"Other issue remains actionable");
        check(!fixture.data.policy.episodes.some(item=>item.episode_id===id)&&!fixture.data.inventory.operator_controls.some(item=>item.target===id),"Other issue has no inherited acknowledgment or pause");
      }
      check(card.dialog.querySelector('[data-definition-id="deck-extra"]'),"Overlapping check retains its own policy");
      reset(true);await openIssue("matter-outage");for(const name of Object.values(deviceNames))check(card.dialog.innerText.includes(name),"Actual integration failure retains "+name);
      check(find('[data-acknowledge]',card.dialog).dataset.acknowledge==="matter-outage","Integration action retains complete issue identity");noOverflow();
    },"Clicked independent light, acknowledgment and pause through mocked services; all other device and overlapping-policy issues remain unacknowledged and unpaused. Actual failed Matter issue retains all four devices. No live services.");
    await path("issues.split-history",async()=>{
      reset();const retained=fixture.data.inventory.episodes.splice(2,1)[0];
      fixture.data.inventory.resolved_history.episodes.push({episode:retained,source:{name:deviceNames.hallway,kind:"device"},resolution:"cleared",resolved_at:fixtureTime});
      fixture.data.inventory.episodes.pop();card.render();await showHistory();
      const content=find('.history-content:not([hidden])');
      check(content.innerText.includes("Recovery was not established")&&root.textContent.includes("Issues separated"),"Separation never claims recovery");
      check(content.innerText.includes("1 separated issue is no longer available"),"Missing successor is explicit");
      check(find('[data-open-episode="issue:devices:deck"]',content).innerText.includes(deviceNames.deck),"Open successor link names the device");
      await click('[data-open-episode="issue:devices:deck"]',content);check(card.detail.episodeId==="issue:devices:deck","Open successor navigates to its independent issue");
      await close();await click('[data-page="history"]');
      if(find('[data-history-toggle="former-matter-group"]').getAttribute("aria-expanded")!=="true")await click('[data-history-toggle="former-matter-group"]');
      await click('[data-history="issue:devices:hallway"]');check(find('[data-history-toggle="issue:devices:hallway"]').getAttribute("aria-expanded")==="true","Retained successor opens its history");
      check(mutations().length===0,"History navigation requests no mutation");noOverflow();
    },"Expanded Issues separated, verified no-recovery wording and explicit expired successor, followed readable links into the open light and retained hallway issue. No mutation.");
    await path("settings.timing-only",async()=>{
      reset();const before=JSON.stringify(card.editors.configuration.settings);await click('[data-page="configuration"]');
      check(!root.querySelector('[data-settings-section], [data-setting-path="timings.coalesce_count"], [data-setting-path="timings.coalesce_window"]'),"Inactive grouping controls are absent");
      check(find('main h2').innerText==="Timing","Settings shows Timing directly");
      card.navigation.applyPath("/settings/grouping");await settle();check(card.page==="configuration"&&find('[data-setting-path="timings.clear_hold"]'),"Legacy grouping destination retains useful timing controls");
      await click('[data-ui-key="settings-advanced-timing"] summary');check(find('[data-setting-path="timings.settle"]').getClientRects().length,"Advanced timing remains reachable");
      check(JSON.stringify(card.editors.configuration.settings)===before&&card.editors.settingsDraft.timings.coalesce_count===3&&card.editors.settingsDraft.timings.coalesce_window===60,"Navigation preserves saved legacy values");noOverflow();
    },"Settings opens directly to Timing; legacy grouping route works, advanced waits remain reachable, inactive grouping fields/navigation are absent, and saved values stay unchanged.");
    reset();await openIssue();feedback.textContent="PASS: Independent device actions, real integration scope, split history and Timing checked.";
  }catch(error){feedback.textContent="FAIL: "+error.stack;}finally{button.disabled=false;report();}
};
reset();
