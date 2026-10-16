import "../../custom_components/homeostatic/frontend/homeostatic.js";
import {compactPopupFixture,popupCases} from "./compact-popup-fixture.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,calls=[];
const copy=value=>structuredClone(value);
let fixture=compactPopupFixture(),revision=0;
const check=(value,message)=>{if(!value)throw Error(message);};
const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const settle=async()=>{for(let index=0;index<8;index++)await frame();};
const find=(selector,scope=root)=>{const target=scope.querySelector(selector);check(target,"Missing "+selector);return target;};
const click=async(selector,scope=root)=>{const target=find(selector,scope);check(!target.disabled&&target.getClientRects().length&&!target.closest("[inert]"),"Reachable "+selector);target.scrollIntoView({block:"nearest"});target.click();await settle();};
const body=()=>card.dialog.querySelector(".dialog-body");
const mutations=()=>calls.filter(request=>request.type==="call_service"||request.type==="homeostatic/save_settings");
const settings={notifications:false,monitoring_policies:[],notification_definitions:{profiles:{},methods:{}}};
const configuration={revision:"compact-popup-fixture",settings};
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},
  localize:key=>key==="component.lyric.title"?"Honeywell Lyric":key==="component.mobile_app.title"?"Mobile App":null,
  async callWS(request) {
    calls.push(copy(request));
    if(request.type==="homeostatic/node") {
      check(request.node_id===fixture.source.node_id,"Detail query retains the selected source identity");
      return copy(fixture.result);
    }
    if(request.type==="homeostatic/configuration")return copy(configuration);
    throw Error("Unexpected isolated request "+request.type);
  },
};
function publish() {
  fixture.data.updated_at=new Date(Date.parse("2026-10-15T18:00:00Z")+ ++revision*1000).toISOString();
  card.current={status:"current",data:fixture.data};card.tools.update(card.current);card.render();
  if(card.detail)card.loadDetail();
}
async function close() {
  if(card.tools.dialog.open)await click('[data-tool="close"]',card.tools.dialog);
  if(card.dialog.open)await click('[data-action="close"]',card.dialog);
}
async function openCase(id) {
  await close();fixture=compactPopupFixture(id);
  Object.assign(card,{configuration:copy(configuration),settingsDraft:copy(settings),page:"problems",detail:null});
  publish();await settle();
  document.querySelector("#example").value=id;
  if(fixture.episode) {
    for(const toggle of [...root.querySelectorAll('[data-issue-group][aria-expanded="false"]')])await click('[data-issue-group="'+toggle.dataset.issueGroup+'"]');
    await click('[data-episode="'+fixture.episode.episode_id+'"]');
  } else {
    card.openDetail({nodeId:fixture.source.node_id});await settle();
  }
  check(card.dialog.open,id+": dialog opens");
}
function checkFit(id) {
  const bounds=card.dialog.getBoundingClientRect();
  check(bounds.left>=0&&bounds.right<=innerWidth+1&&body().scrollWidth<=body().clientWidth+1,id+": dialog fits the current viewport");
}
const select=document.querySelector("#example");
for(const definition of popupCases)select.add(new Option(definition.id,definition.id));
document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
document.querySelector("#open").onclick=()=>openCase(select.value);
select.onchange=()=>openCase(select.value);
Object.assign(card,{configuration:copy(configuration),settingsDraft:copy(settings),current:{status:"current",data:fixture.data},page:"problems"});
card.render();

async function run() {
  const button=document.querySelector("#run"),result=document.querySelector("#result"),evidence=[];
  button.disabled=true;calls.length=0;
  const receipt={...emptyReceipt({fixture:"compact-popup.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",build:"working tree",transport:"synthetic inventory, no mutation service",physical_safari:"untested"}),status:"running",evidence};
  try {
    for(const definition of popupCases) {
      await openCase(definition.id);
      const prefix=definition.id+": ",details=find('[data-disclosure="issue-details"]',body());
      check(find("#detail-title").textContent===fixture.title,prefix+"source title excludes the policy suffix");
      check(!details.open&&details.querySelector("summary").textContent==="Details",prefix+"one supporting Details starts collapsed");
      check(body().querySelectorAll('[data-disclosure="issue-details"]').length===1,prefix+"supporting details have one entry point");
      check(!body().querySelector('[data-maintenance]'),prefix+"no new-maintenance action is offered");
      check(!body().querySelector('[data-disclosure="source-navigation"],[data-disclosure="reported"],[data-disclosure="assessment"],[data-disclosure="connection"],[data-disclosure="monitoring"]'),prefix+"supporting content is not split across competing disclosures");
      if(definition.headline)check(body().innerText.includes(definition.headline),prefix+"current condition remains visible");
      if(fixture.episode) {
        check(find("#detail-label").hidden,prefix+"redundant issue label is hidden");
        const opened=body().querySelectorAll(".problem-progress");
        check(opened.length===1&&!opened[0].closest("details"),prefix+"opened time appears once and stays visible");
        const ack=find("[data-acknowledge]",body()),pause=find("[data-shelf]",body());
        check(ack.dataset.acknowledge===fixture.episode.episode_id&&pause.dataset.shelf===fixture.episode.episode_id,prefix+"attention controls retain the exact episode");
        check(!ack.closest("details")&&!pause.closest("details"),prefix+"attention controls remain visible");
      } else {
        check(!body().querySelector("[data-acknowledge],[data-shelf],.problem-progress"),prefix+"source without an issue has no issue action or invented opening time");
      }
      const policies=[...body().querySelectorAll('[data-definition-action="open-policy"]')];
      check(fixture.policyIds.every(id=>policies.some(link=>link.dataset.definitionId===id)),prefix+"each responsible policy is reachable");
      check(policies.every(link=>!link.closest("details")),prefix+"policy actions remain directly available");
      if(definition.id!=="situation"&&!definition.noEpisode)check([...body().querySelectorAll(".primary")].some(action=>!action.closest("details")),prefix+"relevant Home Assistant remedy remains visible");
      checkFit(definition.id);
      await click('[data-disclosure="issue-details"] > summary',body());
      const recorded=find('[data-disclosure="issue-details"]',body());
      check(!recorded.querySelector('details'),prefix+"opening Details reveals all supporting content together");
      if(definition.grouped)check(recorded.querySelectorAll('[data-check-source]').length===10,prefix+"complete grouped membership remains inspectable without a second recorded-source list");
      checkFit(definition.id+" expanded");
      evidence.push(definition.id+": identity, current evidence, policy/actions, one Details, retained findings and viewport fit.");
    }
    await openCase("device");
    fixture.result.device_evidence.total=25;publish();await settle();
    const deviceRoute=fixture.source.monitoring_source;
    check(body().querySelectorAll('[data-source-link="'+deviceRoute+'"]').length===1,"Partial device evidence offers one route to the complete readings");
    check(!find('[data-source-link="'+deviceRoute+'"]',body()).closest('details'),"Complete-reading navigation stays with the partial evidence");
    await openCase("battery");await click('[data-disclosure="issue-details"] > summary',body());
    find('[data-disclosure="issue-details"] > summary',body()).focus();
    fixture.result.entity_status.current.reason="charging";
    fixture.result.explanation.findings[0].message="The battery reports charging.";
    publish();await settle();
    check(find('[data-disclosure="issue-details"]',body()).open,"Details expansion survives changed live evidence");
    check(root.activeElement?.matches('[data-disclosure="issue-details"] > summary'),"Details summary focus survives changed live evidence");
    check(body().innerText.includes("Battery charging"),"Current evidence refreshes without keeping the previous warning");
    await close();await openCase("source");
    check(!body().innerText.includes("Household impact")&&!body().innerText.includes("What Homeostatic knows"),"Source evidence explanations stay in Details");
    fixture.source.kind="external";fixture.result.source.kind="external";publish();await settle();
    check(!body().querySelector('[data-maintenance]'),"External source detail offers no new-maintenance action");
    check(mutations().length===0&&JSON.stringify(card.configuration.settings)===JSON.stringify(settings),"Opening and inspecting all examples changes no controls or saved settings");
    evidence.push("Entity, integration, device and external source details offer no new-maintenance action. Changed evidence retains Details expansion and keyboard focus; all browsing is read-only.");
    receipt.status="pass";result.textContent="Compact popup checks passed ("+popupCases.length+" examples)";
  } catch(error) {receipt.status="fail";receipt.error=error.message;result.textContent="Failed: "+error.message;}
  recordResult(receipt,"issues.compact-popups",receipt.status,receipt.error||evidence.join(" "));
  document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);
  parent.postMessage({type:"homeostatic-acceptance",fixture:"compact-popup.html",receipt},location.origin);
  button.disabled=false;
}
document.querySelector("#run").onclick=run;
