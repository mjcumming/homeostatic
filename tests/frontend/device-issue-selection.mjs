import {baseSource} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

export const DEVICE_ID="audi",DEVICE_SOURCE="device:audi",FIXTURE_TIME="2026-10-17T15:00:00Z";
export const DEVICE_NAME="michael's Audi Alexa Integration";
export const RELATED_IDS=["issue:device","issue:player","issue:alarm","issue:timer"];
const clone=value=>structuredClone(value);

/** Real component input with four independent issues and two unrelated controls. */
export function deviceIssueFixture() {
  const settings=notificationSettings();
  settings.notification_definitions.profiles.morning.methods=["phone"];
  settings.monitoring_policies=[
    {id:"devices",name:"Devices",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[{id:"morning",profile:"morning"}]},
    {id:"entities",name:"Entities",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[{id:"morning",profile:"morning"}]},
    {id:"batteries",name:"Batteries",enabled:true,check:"battery",match:{kind:["entity"]},parameters:{low:20},notifications:[]},
  ];
  const integration=baseSource("entry:alexa","Alexa Media Player","integration",{entry_id:"alexa",watched:true,attributes:{domain:["alexa_media"]}});
  const entities=[
    ["player",DEVICE_NAME,"media_player.audi"],["alarm","Next alarm","sensor.audi_next_alarm"],["timer","Next timer","sensor.audi_next_timer"],
  ].map(([key,name,entity_id])=>baseSource(`entity:${key}`,name,"entity",{entity_id,owner_id:"alexa",attributes:{device:[DEVICE_ID],integration:["alexa"],domain:[entity_id.split(".")[0]]}}));
  const device=baseSource(DEVICE_SOURCE,DEVICE_NAME,"device",{device_id:DEVICE_ID,owner_id:"alexa",watched:true,attributes:{device:[DEVICE_ID],integration:["alexa"],integration_domain:["alexa_media"]},availability_entities:entities.map(item=>item.entity_id)});
  const stranger=baseSource("entity:other",DEVICE_NAME,"entity",{entity_id:"sensor.other_speaker",owner_id:"alexa",attributes:{device:["other"],integration:["alexa"],domain:["sensor"]}});
  const orphan=baseSource("entity:orphan","Standalone reading","entity",{entity_id:"sensor.standalone_reading",owner_id:"alexa",attributes:{integration:["alexa"],domain:["sensor"]}});
  const canonical=[integration,device,...entities,stranger,orphan],checks=[],episodes=[],statuses={};
  const add=(source,key,policy,kind=source.kind,check_id="availability")=>{
    const check={...source,kind,node_id:`check:${key}`,name:`${source.name} · ${policy}`,monitoring_source:source.node_id,monitoring_policy:policy,check_id,watched:true};
    const finding={node_id:check.node_id,check_id,status:kind==="device"?"fail":"warn",reason:kind==="device"?"all_unavailable":check_id==="availability"?"unavailable":"low",message:check_id==="availability"?"Unavailable in Home Assistant":"Battery below threshold",observed_at:FIXTURE_TIME};
    checks.push(check);statuses[check.node_id]={current:finding,findings:[finding],last_failure:finding};
    episodes.push({episode_id:`issue:${key}`,anchor:check.node_id,recorded:[check.node_id],form:"single",importance:"normal",impact:[],opened_at:FIXTURE_TIME,reasons:[finding]});
  };
  const connection=baseSource("entity:connection","Connection","entity",{entity_id:"sensor.audi_connection",owner_id:"alexa",attributes:{device:[DEVICE_ID],integration:["alexa"],domain:["sensor"]}});
  canonical.push(connection);add(connection,"device","devices");
  for(const source of entities)add(source,source.node_id.split(":")[1],"entities");
  add(stranger,"other","entities");add(orphan,"orphan","entities");add(entities[0],"battery","batteries","battery","battery_low");
  const members=entities.map(source=>({node_id:source.node_id,entity_id:source.entity_id,name:source.name,state:"unavailable",restored:false}));
  const data={schema_version:3,available:true,catalog_loaded:true,catalog_revision:"selection-1",updated_at:FIXTURE_TIME,entry_id:"selection",functions:[],areas:[],floors:[],devices:[{id:DEVICE_ID,name:DEVICE_NAME,config_entry_id:"alexa"},{id:"other",name:"Other device",config_entry_id:"alexa"}],readiness:{answer:"blocked",nodes:[]},evidence_gaps:0,coverage:{no_checks:[],never_observed:[],stale:[]},
    inventory:{nodes:[...canonical,...checks],catalog:{candidates:canonical},episodes,entity_status:statuses,integration_evidence:{"entry:alexa":{current:{status:"pass",reason:"loaded",observed_at:FIXTURE_TIME}}},attention_controls_supported:true,operator_controls:[],notification_requests:[],enrollment_changes:[],resolved_history:{started_at:FIXTURE_TIME,retention:{max_episodes:100,max_age_days:30},episodes:[]}},
    policy:{notifications_enabled:false,routes:{},episodes:[]}};
  return {data,settings,device,entities,members};
}

/** Source reads preserve evidence membership independently of current issue count. */
export function deviceIssueReply(fixture,id=DEVICE_SOURCE) {
  const source=fixture.data.inventory.nodes.find(item=>item.node_id===id);
  if(!source)throw Error(`Unknown synthetic source: ${id}`);
  const canonical=fixture.data.inventory.nodes.find(item=>item.node_id===source.monitoring_source)||source;
  const members=canonical.kind==="device"?fixture.members:fixture.members.filter(member=>member.node_id===canonical.node_id);
  const policies=fixture.settings.monitoring_policies.filter(policy=>policy.id==="entities"||policy.id==="devices");
  const evidence={members:clone(members),total:members.length,offset:0,next_offset:null,unavailable_count:members.filter(member=>member.state==="unavailable"&&!member.restored).length,unknown_count:members.filter(member=>member.restored||member.state==="missing").length};
  return {source:clone(source),nodeId:canonical.node_id,...evidence,monitoring_policies:clone(policies),updated_at:FIXTURE_TIME,
    device_evidence:canonical.kind==="device"?evidence:null,device_availability:canonical.kind==="device"?{status:evidence.unavailable_count===members.length?"unavailable":"available",basis:"entities",reason:"entity_states"}:null,
    entity_status:fixture.data.inventory.entity_status[id],integration_evidence:fixture.data.inventory.integration_evidence[id],explanation:{findings:fixture.data.inventory.episodes.find(episode=>episode.anchor===id)?.reasons||[],nodes:[]},readiness:{answer:"blocked",nodes:[]},impact:{nodes:[]}};
}

/** Exercise public rendered controls; service replies remain entirely synthetic. */
async function initializeBrowserScenario() {
  await import("../../custom_components/homeostatic/frontend/homeostatic.js");
  const {initializeScopedConfiguration}=await import("../../custom_components/homeostatic/frontend/scoped-configuration.mjs");
  const {emptyReceipt,recordResult}=await import("./control-path-inventory.mjs");
  const card=document.querySelector("homeostatic-panel"),root=card.shadowRoot,calls=[],nativeLinks=[];
  let fixture,failId=null,holdId=null,release=null,receipt;
  const check=(value,message)=>{if(!value)throw Error(message);};
  const frame=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
  const settle=async()=>{for(let index=0;index<16;index++)await frame();};
  const find=(selector,scope=root)=>{const value=scope.querySelector(selector);check(value,`Missing ${selector}`);return value;};
  const click=async(selector,scope=root)=>{const control=find(selector,scope);check(!control.disabled&&control.getClientRects().length,`Reachable ${selector}`);control.scrollIntoView({block:"nearest"});control.click();await settle();};
  const mutations=()=>calls.filter(request=>request.type==="call_service");
  const configuration=()=>({revision:"selection-1",settings:clone(fixture.settings),delivery_targets:[],notification_people:[],monitoring_policy_templates:[],areas:[],labels:[],floors:[]});
  card.navigation.enabled=false;
  card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:()=>null,async callWS(request){
    calls.push(clone(request));
    if(request.type==="homeostatic/configuration")return configuration();
    if(request.type==="homeostatic/source"||request.type==="homeostatic/node"){
      const response=deviceIssueReply(fixture,request.node_id);
      if(request.type==="homeostatic/source"){
        delete response.source;
        response.monitoring_policies=response.monitoring_policies.map(({id,name})=>({id,name}));
      }
      return response;
    }
    if(request.type!=="call_service")throw Error(`Unexpected isolated request: ${request.type}`);
    const id=request.service_data.episode_id;
    check(fixture.data.inventory.episodes.some(item=>item.episode_id===id),"Only current IDs reach the service");
    if(id===holdId)await new Promise(resolve=>{release=resolve;});
    if(id===failId)throw Error("Synthetic selected-issue rejection");
    if(request.service==="acknowledge") {
      const acknowledgment={episode_id:id,at:FIXTURE_TIME,actor_id:"fixture"};
      fixture.data.policy.episodes.push({episode_id:id,acknowledgment});return {response:{acknowledgment}};
    }
    if(request.service==="shelve") {
      const control={control_id:`pause:${id}`,action:"shelve",target:id,until:request.service_data.until,reason:request.service_data.reason};
      fixture.data.inventory.operator_controls.push(control);return {response:{control}};
    }
    throw Error(`Unexpected isolated service: ${request.service}`);
  }};
  root.addEventListener("click",event=>{const link=event.target.closest("a[href]");if(link){event.preventDefault();nativeLinks.push(link.getAttribute("href"));}});
  function reset(keep=RELATED_IDS) {
    card.tools.close();if(card.dialog.open)card.dialog.close();fixture=deviceIssueFixture();calls.length=0;nativeLinks.length=0;failId=null;holdId=null;release=null;
    fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>![...RELATED_IDS,"issue:battery"].includes(item.episode_id)||keep.includes(item.episode_id));
    for(const member of fixture.members)if(!keep.includes(`issue:${member.node_id.split(":")[1]}`))member.state="off";
    card._hass.states=Object.fromEntries(fixture.members.map(member=>[member.entity_id,{state:member.state,attributes:{}}]));
    Object.assign(card,{current:{status:"current",data:fixture.data},configuration:configuration(),settingsDraft:clone(fixture.settings),scopedConfiguration:null,page:"sources",detail:null,deviceIssues:null,deviceIssueContext:null,issueQuery:"",issueSort:"name",issueGroupsExpanded:new Set(["integration:alexa_media"]),issueGroupLimits:new Map(),issueAvailabilityPlan:null,issueAvailabilityEpisode:null,
      availabilityPlan:null,availabilityContext:null,availabilityError:null,sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(["integration:alexa_media","source:entry:alexa",`source:${DEVICE_SOURCE}`]),sourcesSelection:`source:${DEVICE_SOURCE}`,sourcesMobileDetail:true,sourceDetail:deviceIssueReply(fixture),sourcesView:"details"});
    initializeScopedConfiguration(card);card.render();
  }
  async function openCombined() {await click(`[data-device-issues="${DEVICE_ID}"]`);check(card.dialog.open&&card.detail.deviceId===DEVICE_ID,"View opens combined device context");}
  const close=async()=>{if(card.tools.dialog.open)await click('[data-tool="close"]',card.tools.dialog);if(card.dialog.open)await click('[data-action="close"]',card.dialog);};
  const select=async(id,wanted)=>{const input=find(`[data-device-issue-select="${id}"]`,card.dialog);if(input.checked!==wanted)await click(`[data-device-issue-select="${id}"]`,card.dialog);};
  const checkTargets=expected=>check(JSON.stringify(mutations().map(request=>request.service_data.episode_id))===JSON.stringify(expected),`Exact selected targets: ${expected.join(", ")}`);
  const report=()=>{document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"device-issue-selection.html",receipt},location.origin);};
  const run=async(id,body,evidence)=>{try{await body();recordResult(receipt,id,"pass",evidence);}catch(error){recordResult(receipt,id,"fail",error.stack);throw error;}finally{report();}};
  document.querySelector("#width").onchange=event=>card.style.width=`${event.target.value}px`;
  document.querySelector("#theme").onchange=event=>document.documentElement.dataset.theme=event.target.value;
  document.querySelector("#show").onclick=()=>reset();
  document.querySelector("#two").onclick=async()=>{reset(["issue:alarm","issue:timer"]);await openCombined();};
  document.querySelector("#one").onclick=async()=>{reset(["issue:timer"]);await openCombined();};
  document.querySelector("#gaps").onclick=async()=>{
    reset();await settle();await openCombined();
    fixture.data.inventory.episodes=[];
    fixture.members[0].state="unknown";fixture.members[1].state="missing";fixture.members[2].restored=true;
    await card.loadDetail();await settle();
  };
  document.querySelector("#run").onclick=async()=>{
    const button=document.querySelector("#run"),feedback=document.querySelector("#feedback");button.disabled=true;feedback.textContent="Running exact issue-selection checks…";
    receipt=emptyReceipt({fixture:"device-issue-selection.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",transport:"synthetic data and mocked services",physical_safari:"untested"});
    try {
      await run("issues.device-availability-selection",async()=>{
        reset();await settle();await openCombined();
        check(card.dialog.querySelectorAll('[data-device-issue-select]').length===4,"Four independent availability issues appear");
        check(find('[data-device-issues-all]',card.dialog).checked,"All issues start selected");
        check(!card.dialog.innerText.includes("Other device")&&!card.dialog.innerText.includes("Battery below"),"Unrelated condition and device are excluded");
        check(card.dialog.querySelectorAll('[data-device-response="acknowledge"]').length===1,"One acknowledgment action");
        await select("issue:device",false);await select("issue:player",false);await select("issue:timer",false);
        check(find('[data-device-issues-all]',card.dialog).indeterminate,"Master reflects a subset");
        await click('[data-device-response="acknowledge"]',card.dialog);checkTargets(["issue:alarm"]);
        await click('[data-device-response="pause"]',card.dialog);await click('[data-device-response="cancel-pause"]',card.dialog);checkTargets(["issue:alarm"]);
        await click('[data-device-response="pause"]',card.dialog);await click('[data-device-response="apply-pause"]',card.dialog);checkTargets(["issue:alarm","issue:alarm"]);
        check(fixture.data.inventory.operator_controls.every(control=>control.target==="issue:alarm"),"Subset pause has no inherited device scope");
        await select("issue:alarm",false);check(find('[data-device-response="acknowledge"]',card.dialog).disabled&&find('[data-device-response="pause"]',card.dialog).disabled,"Zero selection disables response");
        reset();await openCombined();failId="issue:alarm";await click('[data-device-response="acknowledge"]',card.dialog);
        check(mutations().length===4&&new Set(mutations().map(request=>request.service_data.episode_id)).size===4,"Failure retains one request per selected ID");
        check(card.dialog.innerText.includes("Synthetic selected-issue rejection")&&fixture.data.policy.episodes.length===3,"Partial success and failure remain distinct");
        await settle();check(mutations().length===4,"Failure does not automatically retry");
        reset();await openCombined();holdId="issue:device";await click('[data-device-response="acknowledge"]',card.dialog);check(typeof release==="function","First request is pending");
        fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>item.episode_id!=="issue:alarm");
        const replacement=clone(fixture.data.inventory.episodes.find(item=>item.episode_id==="issue:timer"));replacement.episode_id="issue:replacement";fixture.data.inventory.episodes.push(replacement);card.render();await settle();
        const resume=release;holdId=null;resume();await settle();
        check(!mutations().some(request=>["issue:alarm","issue:replacement"].includes(request.service_data.episode_id)),"Recovery is skipped and a new identity receives no inherited action");
        check(mutations().length===3&&card.dialog.innerText.includes("not confirmed"),"Recovery reports partial completion");
        reset(["issue:alarm","issue:timer"]);await openCombined();check(card.dialog.querySelectorAll('[data-device-issue-select]').length===2,"Entity-only combined dialog stays reachable");
        reset(["issue:timer"]);await openCombined();check(!card.dialog.querySelector('[data-device-issues-all], [data-device-issue-select]'),"One remaining issue has no selection controls");
        check(card.dialog.innerText.includes("Next timer"),"Single target is identified under device context");
        await click('[data-device-response="acknowledge"]',card.dialog);await click('[data-device-response="pause"]',card.dialog);await click('[data-device-response="apply-pause"]',card.dialog);checkTargets(["issue:timer","issue:timer"]);
      },"Rendered all/subset/zero selection, exact acknowledgment/pause, cancellation, partial service failure, pending recovery/new identity, and entity-only two/one views. Unrelated issues stay unchanged; all requests are mocks.");
      await run("sources.device-issue-navigation",async()=>{
        reset();await settle();const settingsBefore=JSON.stringify(fixture.settings);
        check(root.querySelectorAll('[data-device-issues]').length===1,"Monitoring has one combined View");
        const repeatedAvailability=RELATED_IDS.some(id=>root.querySelector(`.source-body [data-episode="${id}"]`));
        check(!repeatedAvailability&&!root.querySelector('.source-body [data-device-response]'),"Monitoring has no repeated availability issue response controls");
        for(const source of fixture.entities) {
          const selector=`a[href="/config/entities/entity/${source.entity_id}"]`;
          const link=root.querySelector(selector)||[...root.querySelectorAll('.source-body a[href]')].find(item=>item.getAttribute("href").includes(source.entity_id));
          check(link,`Native entity destination for ${source.name}`);link.click();await settle();
        }
        check(nativeLinks.length===3,"Entity links use native destinations");
        await openCombined();check(card.dialog.querySelectorAll(`a[href="/config/devices/device/${DEVICE_ID}"]`).length===1,"Dialog has one Open device action");
        check(!card.dialog.innerText.includes("No delivery method selected"),"Configured synthetic method has no missing-delivery warning");
        await click('[data-definition-action="open-policy"][data-definition-id="entities"]',card.dialog);
        const back=root.querySelector('[data-definition-action="back-to-issue"]')||[...root.querySelectorAll('button')].find(item=>item.textContent.includes("Back to issue"));
        check(back,"Policy editor provides Back to issue");back.click();await settle();check(card.dialog.open&&card.detail.deviceId===DEVICE_ID,"Policy return restores combined dialog");
        await select("issue:device",false);await select("issue:player",false);await select("issue:timer",false);
        await click('[data-issue-availability="remove"]',card.dialog);
        check(card.issueAvailabilityPlan.sourceIds.length===3,"Stop monitoring uses its full reviewed coverage, independently of issue selection");
        await click('[data-issue-availability="cancel"]',card.dialog);
        check(JSON.stringify(fixture.settings)===settingsBefore&&mutations().length===0&&!calls.some(request=>request.type==="homeostatic/save_settings"),"Navigation and coverage cancellation mutate nothing");
        fixture.data.inventory.episodes=[];
        fixture.members[0].state="unknown";
        fixture.members[1].state="missing";
        fixture.members[2].restored=true;
        await card.loadDetail();await settle();
        check(card.dialog.innerText.includes("1 of 3 monitored entities available"),"Unknown values still pass availability");
        check(card.dialog.innerText.includes("Next alarm")&&card.dialog.innerText.includes("No current state from Home Assistant"),"Missing member is named without an open issue");
        check(card.dialog.innerText.includes("Next timer")&&card.dialog.innerText.includes("Not currently provided by its integration"),"Restored member has its distinct explanation");
        check(card.dialog.querySelector('[data-definition-id="entities"]')&&!card.dialog.querySelector('[data-device-response]'),"Healthy child policy coverage stays visible without issue actions");
        await close();check(card.page==="sources"&&card.sourcesSelection===`source:${DEVICE_SOURCE}`,"Close restores the originating inspector");
        check(root.querySelector('.shell').scrollWidth<=root.querySelector('.shell').clientWidth+1,"Panel fits the selected width");
      },"Monitoring offers one combined View and native entity links. Shared dialog has one Open device, policy return preserves device context, and Stop monitoring reviews its independent coverage without saving on cancellation.");
      await run("issues.device-entry",async()=>{
        reset(["issue:alarm","issue:timer","issue:battery"]);await settle();
        await click('.nav [data-page="problems"]');
        for(const group of [...root.querySelectorAll('[data-issue-group]')])if(group.getAttribute("aria-expanded")==="false"){group.click();await settle();}
        const deviceGroup=find(`[data-issue-device="${DEVICE_ID}"]`);
        check(deviceGroup.querySelectorAll('[data-device-issues]').length===1,"One device-level View opens all findings");
        check(!deviceGroup.querySelector('[data-episode]'),"Owned entity and condition findings have no duplicate dialogs");
        await click(`[data-issue-device="${DEVICE_ID}"] [data-device-issues]`);
        check(card.detail.deviceId===DEVICE_ID,"Open issues opens the shared device context without an aggregate device issue");
        const shown=[...card.dialog.querySelectorAll('[data-device-issue-select]')].map(input=>input.dataset.deviceIssueSelect).sort();
        check(JSON.stringify(shown)===JSON.stringify(["issue:alarm","issue:battery","issue:timer"]),"Device context includes entity availability and battery findings");
        check(find('[data-device-issues-all]',card.dialog).checked,"All device issues initially selected");
        check(!card.dialog.querySelector('.issue-facts'),"Combined context omits ambiguous opening date");
        check(!find(`a[href="/config/devices/device/${DEVICE_ID}"]`,card.dialog).classList.contains('primary'),"Open device has secondary styling");
        const nativeStyle=getComputedStyle(find(`a[href="/config/devices/device/${DEVICE_ID}"]`,card.dialog));
        for(const [selector,label] of [['[data-device-response="acknowledge"]','Acknowledge'],['[data-device-response="pause"]','Pause'],['[data-issue-availability="remove"]','Stop monitoring…']]) {
          const button=find(selector,card.dialog),style=getComputedStyle(button);
          check(button.textContent===label,`Short action label: ${label}`);
          check(style.color===nativeStyle.color&&style.borderColor===nativeStyle.borderColor&&style.backgroundColor===nativeStyle.backgroundColor,`${label} matches Open device styling`);
          check(button.getBoundingClientRect().height>=44,`${label} retains a touch target`);
        }
        await select("issue:alarm",false);await select("issue:timer",false);
        await click('[data-device-response="acknowledge"]',card.dialog);checkTargets(["issue:battery"]);
        await close();check(card.page==="problems","Close returns to Open issues");
        await click('[data-episode="issue:orphan"]');
        check(!card.dialog.querySelector('[data-device-issue-select], [data-device-issues-all]'),"Unattached entity has no selection controls");
        check(find('[data-issue-response]',card.dialog).dataset.issueResponse==="issue:orphan","Unattached entity retains its original issue scope");
        await close();check(card.page==="problems","Singular close preserves the issue list");
      },"The Open issues device heading opens the same device context for entity-only and battery problems. All current device issues initially select, one battery exception can be acknowledged independently, and close returns to the queue. An unattached entity retains its exact singular dialog. Device actions use Acknowledge, Pause and Stop Monitoring, match the outlined Open device colors, and retain touch targets. Device details omit ambiguous opening chronology.");
      reset();await openCombined();feedback.textContent="PASS: Exact selection, partial outcomes, source navigation and single-issue controls checked.";
    }catch(error){feedback.textContent=`FAIL: ${error.stack}`;}finally{button.disabled=false;report();}
  };
  reset();
}

if(typeof document!=="undefined")await initializeBrowserScenario();
