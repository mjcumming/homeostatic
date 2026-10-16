import {notificationSettings} from "./notification-profiles-fixture.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {emptyReceipt,recordResult} from "./control-path-inventory.mjs";

class OldPanel extends HTMLElement {}
class OldCard extends HTMLElement {}
customElements.define("homeostatic-panel-v41",OldPanel);
customElements.define("homeostatic-card-v37",OldCard);
await import("../../custom_components/homeostatic/frontend/homeostatic.js");

const card=document.querySelector("homeostatic-panel-v42"),feedback=document.querySelector("#feedback");
const names=["Basement TV","Cabin Bunkie","Cabin Kitchen","Dining room","Family room","Garage","Guest bedroom","Hallway","Kitchen","Laundry room","Living room","Main bedroom","Office","Patio","Playroom","Porch","Reading room","Upstairs landing","Workshop","Downstairs guest bedroom television beside the garden-facing windows"];
const targets=names.flatMap((name,index)=>["local","cloud"].map(provider=>({channel:`tts:${provider}:speaker-${index}`,type:"voice",name,destination_name:name,destination_id:`speaker-${index}`,provider_name:provider==="local"?"Local voice":"Cloud voice",area:index===1||index===2?"Cabin":index===0?"Basement":"House",available:true})));
targets.push({channel:"phone:spare",type:"app",name:"Household phone",available:true},{channel:"sms:fixture:",type:"sms",name:"Household SMS",requires_target:true,available:true});
const saved=notificationSettings();
saved.notification_definitions.methods.phone={name:"House speakers",mode:"fixed",destinations:[]};
const savedSnapshot=JSON.stringify(saved),calls=[];
let receipt,automaticPassed=false,escapeBefore=null;
card.navigation.enabled=false;
card._hass={user:{id:"fixture",is_admin:true},config:{time_zone:"America/Chicago"},states:{},localize:()=>null,async callWS(request){calls.push(request);throw Error("Service and save requests are forbidden in this isolated fixture");}};
card.current={status:"current",data:monitoringExample()};
card.configuration={revision:"fixture-1",settings:structuredClone(saved),delivery_targets:targets,notification_people:[],monitoring_policy_templates:[],areas:[],labels:[],floors:[]};
card.settingsDraft=structuredClone(saved);card.page="notifications";card.notificationSection="methods";card.definitionSelection={kind:"methods",id:"phone"};card.render();
const root=card.shadowRoot;
const tick=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
const check=(condition,message)=>{if(!condition)throw Error(message);};
const find=selector=>{const element=root.querySelector(selector);check(element,`Missing ${selector}`);return element;};
const publish=()=>{document.querySelector("#receipt").textContent=JSON.stringify(receipt,null,2);parent.postMessage({type:"homeostatic-acceptance",fixture:"delivery-picker-layout.html",receipt},location.origin);};
const freshReceipt=()=>{receipt=emptyReceipt({fixture:"delivery-picker-layout.html",browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||"light",data:"synthetic",destinations:"forbidden",element:card.localName,previous_elements_registered:["homeostatic-panel-v41","homeostatic-card-v37"],physical_safari:"untested"});automaticPassed=false;escapeBefore=null;publish();};
const click=async selector=>{
  const element=find(selector);element.scrollIntoView({block:"nearest"});await tick();
  const bounds=element.getBoundingClientRect(),hit=root.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  check(bounds.width>0&&bounds.height>0&&(hit===element||element.contains(hit)),`Control is reachable: ${selector}`);
  element.click();await tick();
};
const change=async(selector,value)=>{const element=find(selector);element.value=value;element.dispatchEvent(new Event("change",{bubbles:true}));await tick();};
const open=async()=>{
  card.deliveryPicker=null;card.render();await tick();
  await click('[data-definition-action="destination-open"]');await change('[data-definition-delivery-type]',"voice");
};
const close=()=>click('[data-definition-action="destination-close"]');
const draftChoices=()=>card.settingsDraft.notification_definitions.methods.phone.destinations;
const focusReturned=()=>root.activeElement?.dataset.definitionAction==="destination-open";
const reset=()=>{card.deliveryPicker=null;card.settingsDraft=structuredClone(saved);card.render();};
const headerCheck=()=>{
  const dialog=find("dialog.delivery-picker"),header=find(".delivery-picker-header"),title=header.querySelector("h2"),button=header.querySelector('[aria-label="Close destination picker"]');
  check(title&&button,"Title and accessible Close share the picker header");
  const titleBox=title.getBoundingClientRect(),buttonBox=button.getBoundingClientRect(),dialogBox=dialog.getBoundingClientRect();
  check(Math.max(titleBox.top,buttonBox.top)<Math.min(titleBox.bottom,buttonBox.bottom)&&buttonBox.left>=titleBox.right,"Title and Close stay on the same row");
  check(buttonBox.width>=44&&buttonBox.height>=44,"Close has a 44px touch target");
  check(dialogBox.left>=0&&dialogBox.right<=innerWidth+1&&dialogBox.top>=0&&dialogBox.bottom<=innerHeight+1,"Dialog fits the real viewport");
  check(!dialog.querySelector("footer"),"Picker has no duplicate Done footer");
  check(dialog.scrollWidth<=dialog.clientWidth+1,"Picker has no horizontal scrolling");
};
document.querySelector("#dark").onchange=event=>{document.documentElement.dataset.theme=event.target.checked?"dark":"light";freshReceipt();};
document.querySelector("#show").onclick=async()=>{await open();feedback.textContent=`Speaker picker at ${innerWidth} × ${innerHeight}; inspect the actual rendered layout.`;};
document.querySelector("#run").onclick=async()=>{
  freshReceipt();feedback.textContent="Running isolated layout and selection checks…";
  try {
    check(customElements.get("homeostatic-panel-v41")===OldPanel&&customElements.get("homeostatic-card-v37")===OldCard,"Previously registered elements remain intact");
    check(card instanceof customElements.get("homeostatic-panel-v42")&&card instanceof customElements.get("homeostatic-card-v38")&&!(card instanceof OldPanel),"Current panel uses the updated card despite old registered elements");
    reset();await open();headerCheck();
    const helpDraft=JSON.stringify(card.settingsDraft),selectTop=find("[data-definition-delivery-type]").getBoundingClientRect().top;
    check(!find(".contextual-help-popover").matches(":popover-open"),"Delivery help starts closed");
    await click(".contextual-help-trigger");
    check(find(".contextual-help-popover").matches(":popover-open"),"Delivery help opens through its visible control");
    check(find(".contextual-help-popover").textContent.includes("configured in Home Assistant"),"Help explains configured destinations");
    check(find('.contextual-help-popover a').href==="https://www.home-assistant.io/integrations/smtp/","Email setup links to Home Assistant");
    headerCheck();
    check(find("[data-definition-delivery-type]").getBoundingClientRect().top===selectTop,"Help does not move the form");
    check(JSON.stringify(card.settingsDraft)===helpDraft&&calls.length===0,"Help leaves drafts unchanged and sends nothing");
    await click(".contextual-help-trigger");
    check(!find(".contextual-help-popover").matches(":popover-open"),"Delivery help closes through its visible control");
    check(find(".delivery-picker").closest(".notification-methods .delivery-method-editor"),"Fixture uses the full production method-editor nesting");
    const rows=[...root.querySelectorAll(".delivery-picker-results .delivery-picker-choice")];
    check(rows.length===names.length,"Each speaker appears once despite two providers");
    check(!root.querySelector('[data-definition-action="destination-add"]'),"Provider actions stay out of the speaker list");
    for(const row of rows.slice(0,-1)) {
      const bounds=row.getBoundingClientRect(),copy=row.querySelector(".delivery-picker-copy"),name=row.querySelector(".delivery-picker-name");
      check(bounds.height>=44&&bounds.height<=90,"Ordinary speaker rows stay compact");
      check(copy&&name&&getComputedStyle(row).textAlign==="left"&&copy.getBoundingClientRect().left-bounds.left<=20,"Speaker names remain left-aligned");
      check(row.scrollWidth<=row.clientWidth+1,"Speaker row does not overflow horizontally");
    }
    const body=find(".delivery-picker-body"),results=find(".delivery-picker-results");
    check(["auto","scroll"].includes(getComputedStyle(body).overflowY),"Picker body owns scrolling");
    check(!["auto","scroll"].includes(getComputedStyle(results).overflowY)&&getComputedStyle(results).maxHeight==="none","Results have no nested scrolling or fixed height cap");
    check(body.scrollHeight>body.clientHeight,"Many speakers exercise body scrolling");
    const last=rows.at(-1);last.scrollIntoView({block:"nearest"});await tick();
    const lastBox=last.getBoundingClientRect(),bodyBox=body.getBoundingClientRect(),hit=root.elementFromPoint(lastBox.x+lastBox.width/2,lastBox.y+lastBox.height/2);
    check(lastBox.top>=bodyBox.top-1&&lastBox.bottom<=bodyBox.bottom+1&&(hit===last||last.contains(hit)),"Last long-named speaker is reachable and uncovered");
    check(last.scrollWidth<=last.clientWidth+1,"Long speaker name wraps without horizontal overflow");
    await click('[data-definition-action="destination-speaker"][data-destination-speaker="speaker-1"]');headerCheck();
    check(find(".delivery-picker-header h2").textContent==="Speech provider","Provider choice has its own title");
    check(find(".delivery-picker-body").textContent.includes("Cabin Bunkie"),"Selected speaker remains visible in provider choice");
    check(root.querySelectorAll('[data-definition-action="destination-add"]').length===2&&!root.querySelector('[data-definition-action="destination-speaker"]'),"Only the selected speaker's providers are shown");
    await click('[data-definition-action="destination-back"]');
    check(draftChoices().length===0&&root.querySelectorAll('[data-definition-action="destination-speaker"]').length===names.length,"Back returns to speakers without changing the draft");
    await click('[data-definition-action="destination-speaker"][data-destination-speaker="speaker-1"]');
    await click('[data-definition-action="destination-add"][data-destination-channel="tts:cloud:speaker-1"]');
    check(!root.querySelector("dialog.delivery-picker")&&JSON.stringify(draftChoices())===JSON.stringify(["tts:cloud:speaker-1"]),"Selecting a provider closes the picker and adds exactly that channel to the draft");
    check(focusReturned(),"Adding returns focus to Add destination");
    await click('[data-definition-action="destination-open"]');await change('[data-definition-delivery-type]',"app");
    await click('[data-definition-action="destination-add"][data-destination-channel="phone:spare"]');
    check(JSON.stringify(draftChoices())===JSON.stringify(["tts:cloud:speaker-1","phone:spare"]),"Single-route destination adds directly");
    const beforeClose=JSON.stringify(card.settingsDraft);await open();await close();
    check(JSON.stringify(card.settingsDraft)===beforeClose&&focusReturned(),"Close preserves choices and returns focus");
    check(JSON.stringify(card.configuration.settings)===savedSnapshot&&calls.length===0,"All selections remain drafts; no saves or notification requests occur");
    automaticPassed=true;
    recordResult(receipt,"methods.picker-layout","untested","Automatic geometry and selection checks passed. Native Escape still needs a real keystroke.");
    feedback.textContent=`PASS: layout and draft selection checks at ${innerWidth}px. Choose Check native Escape, then press Escape to finish this receipt.`;
  }catch(error){recordResult(receipt,"methods.picker-layout","fail",error.message);feedback.textContent=`FAIL: ${error.message}`;}
  publish();
};
document.querySelector("#escape").onclick=async()=>{
  escapeBefore=JSON.stringify(card.settingsDraft);await open();feedback.textContent="Press the real Escape key. The picker should close and return focus to Add destination.";
};
root.addEventListener("keydown",async event=>{
  if(event.key!=="Escape"||!event.isTrusted||escapeBefore===null)return;
  await tick();
  const passed=card.deliveryPicker===null&&JSON.stringify(card.settingsDraft)===escapeBefore&&focusReturned()&&calls.length===0;
  escapeBefore=null;
  recordResult(receipt,"methods.picker-layout",passed&&automaticPassed?"pass":passed?"untested":"fail",passed?"Real Escape keystroke closed the picker, preserved draft choices, and returned focus; no service calls.":"Native Escape did not close, preserve choices, or return focus.");
  feedback.textContent=passed?(automaticPassed?`PASS: geometry, selections and native Escape at ${innerWidth}px. No saves or notifications.`:"PASS: native Escape. Run layout checks to complete this receipt."):"FAIL: native Escape handling.";publish();
});
freshReceipt();
