import {escapeHtml as esc} from "./model.mjs?v=114";

const TYPES={app:"App notification",voice:"Speaker announcement",email:"Email",sms:"SMS",notification:"Other notification"};
const targetsFor=card=>card.editors.configuration.delivery_targets||card.editors.configuration.notification_destinations||[];
const typeOf=target=>String(target.type||"notification").toLowerCase();
const button=(action,label,id,field,extra="")=>`<button type="button" class="button" data-definition-action="${action}" data-definition-kind="methods" data-definition-id="${esc(id)}" data-destination-field="${esc(field)}" ${extra}>${esc(label)}</button>`;
const ownerFor=(method,field)=>field.startsWith("person_destinations:")?{owner:method.person_destinations??={},key:field.slice(20)}:{owner:method,key:field};
const valuesFor=(method,field)=>field.startsWith("person_destinations:")?method.person_destinations?.[field.slice(20)]||[]:method[field]||[];
const providerName=target=>target.provider_name||target.provider||"Default speech provider";
const displayName=target=>target.destination_name||target.name;
const choice=(action,name,detail,id,field,extra="",indicator="+")=>`<button type="button" class="delivery-picker-choice" data-definition-action="${action}" data-definition-kind="methods" data-definition-id="${esc(id)}" data-destination-field="${esc(field)}" ${extra}><span class="delivery-picker-copy"><span class="delivery-picker-name">${esc(name)}</span>${detail?`<small>${esc(detail)}</small>`:""}</span><span class="delivery-picker-indicator" aria-hidden="true">${indicator}</span></button>`;

/** Show configured destinations and discover new ones only after a type is chosen. */
export function destinationChoices(card,method,id,field,label) {
  const saved=valuesFor(method,field),targets=targetsFor(card);
  const selection=card.editors.deliveryPicker?.id===id&&card.editors.deliveryPicker.field===field?card.editors.deliveryPicker:null;
  const rows=saved.map(channel=>{
    const target=targets.find(item=>item.channel===channel);
    const sms=!target&&channel.startsWith("sms:");
    const name=target?displayName(target):sms?decodeURIComponent(channel.split(":").slice(2).join(":")):channel;
    return `<div class="definition-list-item method-destination"><div><strong>${esc(name)}</strong><p class="small">${target?esc(TYPES[typeOf(target)]||"Notification")+(target.area?` · ${esc(target.area)}`:"")+(target.available===false?" · Unavailable":""):sms?"SMS":"Saved destination unavailable"}</p></div>${button("destination-remove","Remove",id,field,`data-destination-channel="${esc(channel)}" aria-label="Remove ${esc(name)}"`)}</div>`;
  }).join("");
  return `<fieldset class="definition-destinations"><legend>${esc(label)} <span class="small">${saved.length} selected</span></legend><div class="method-destination-list">${rows||'<p class="sub">No destinations selected. Add one to use this method.</p>'}</div>${button("destination-open","+ Add destination",id,field)}${selection?picker(card,method,id,field,selection):""}</fieldset>`;
}

function picker(card,method,id,field,state) {
  const saved=valuesFor(method,field);
  const available=targetsFor(card).filter(target=>target.available!==false&&!target.alias_of);
  const types=Object.entries(TYPES).filter(([type])=>available.some(target=>typeOf(target)===type));
  const query=(state.query||"").trim().toLowerCase();
  const candidates=available.filter(target=>typeOf(target)===state.type&&!saved.includes(target.channel));
  const groups=new Map();
  for(const target of candidates) {
    const key=state.type==="voice"?(target.destination_id||target.channel):target.channel;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(target);
  }
  const providers=state.type==="voice"&&state.speaker?groups.get(state.speaker):null;
  const rows=[...groups.values()].filter(items=>items.some(target=>[displayName(target),target.area,providerName(target)].filter(Boolean).join(" ").toLowerCase().includes(query))).map(items=>{
    const target=items[0],name=displayName(target),key=target.destination_id||target.channel;
    if(target.requires_target&&typeOf(target)==="sms")return `<div class="delivery-picker-recipient"><label class="installation-field"><span>${esc(name)}</span><input type="tel" aria-label="Phone number for ${esc(name)}" placeholder="+15551234567" data-definition-sms-number="${esc(target.channel)}" value="${esc(state.numbers?.[target.channel]||"")}"></label>${button("destination-add-sms","Add recipient",id,field,`data-destination-channel="${esc(target.channel)}"`)}</div>`;
    return choice(items.length>1?"destination-speaker":"destination-add",name,target.area,id,field,`data-destination-channel="${esc(target.channel)}" data-destination-speaker="${esc(key)}"`,items.length>1?"&#8250;":"+");
  }).join("");
  const content=providers?`${button("destination-back","Back to speakers",id,field)}<p class="delivery-picker-speaker">${esc(displayName(providers[0]))}</p><div class="delivery-picker-results">${providers.map(item=>choice("destination-add",providerName(item),"",id,field,`data-destination-channel="${esc(item.channel)}"`)).join("")}</div>`:`<div class="installation-field"><div class="delivery-type-heading"><label for="delivery-type-select">Delivery type</label><button type="button" class="contextual-help-trigger" data-definition-action="contextual-help" popovertarget="delivery-type-help" aria-label="Help with delivery types"><span aria-hidden="true">?</span></button><div id="delivery-type-help" class="contextual-help-popover" popover role="group" aria-label="Delivery type help"><p>Choices come from available destinations configured in Home Assistant. Set up email or SMS there, then reopen this editor.</p><p><a href="https://www.home-assistant.io/integrations/smtp/" target="_blank" rel="noopener noreferrer">Email setup</a> · <a href="https://www.home-assistant.io/integrations/twilio_sms/" target="_blank" rel="noopener noreferrer">SMS setup (Twilio)</a></p></div></div><select id="delivery-type-select" aria-label="Delivery type" data-definition-delivery-type><option value="">Choose a delivery type</option>${types.map(([type,name])=>`<option value="${type}"${state.type===type?" selected":""}>${name}</option>`).join("")}</select></div>${state.type?`<label class="installation-field"><span>Search destinations</span><input type="search" aria-label="Search destinations" data-definition-delivery-search value="${esc(state.query||"")}"></label><div class="delivery-picker-results">${rows||'<p>No available destinations match.</p>'}</div>`:'<p class="small">Choose how to send the notification.</p>'}${!types.length?'<p>No supported destinations are available. Configure a notification integration in Home Assistant first.</p>':""}`;
  return `<dialog class="delivery-picker" aria-labelledby="delivery-picker-title"><header class="delivery-picker-header"><h2 id="delivery-picker-title" tabindex="-1" autofocus>${providers?"Speech provider":"Add destination"}</h2><button type="button" class="delivery-picker-close" data-definition-action="destination-close" data-definition-kind="methods" data-definition-id="${esc(id)}" data-destination-field="${esc(field)}" aria-label="Close destination picker">&#215;</button></header><div class="delivery-picker-body">${content}${card.editors.settingsError?`<p role="alert" class="config-error">${esc(card.editors.settingsError)}</p>`:""}</div></dialog>`;
}

/** Return focus to the destination control that opened the picker. */
export function focusDestinationPicker(card,id,field) {
  [...(card.main.querySelectorAll?.('[data-definition-action="destination-open"]')||[])].find(element=>element.dataset.definitionId===id&&element.dataset.destinationField===field)?.focus({preventScroll:true});
}

/** Keep destination choices in their delivery method draft. */
export function editDestinationPicker(card,event,element,invalidate,renderAfterEdit) {
  const d=element.dataset||{},action=d.definitionAction,state=card.editors.deliveryPicker;
  if(event.type!=="click") {
    if(d.definitionDeliveryType!==undefined){if(state){state.type=element.value;state.query="";state.speaker=null;}card.render();return true;}
    if(d.definitionDeliverySearch!==undefined){if(state)state.query=element.value;renderAfterEdit(card,element);return true;}
    if(d.definitionSmsNumber!==undefined){if(state)(state.numbers??={})[d.definitionSmsNumber]=element.value;return true;}
    return false;
  }
  if(!action?.startsWith("destination-"))return false;
  const id=d.definitionId,field=d.destinationField;
  const method=card.editors.settingsDraft.notification_definitions?.methods[id];
  if(!method)return true;
  if(action==="destination-open"){card.editors.deliveryPicker={id,field,type:"",query:"",numbers:{}};card.render();return true;}
  if(action==="destination-close"){card.editors.deliveryPicker=null;card.render();focusDestinationPicker(card,id,field);return true;}
  if(action==="destination-speaker"){if(state)state.speaker=d.destinationSpeaker;card.render();return true;}
  if(action==="destination-back"){
    const speaker=state?.speaker;
    if(state)state.speaker=null;
    card.render();
    [...(card.main.querySelectorAll?.('[data-definition-action="destination-speaker"]')||[])].find(item=>item.dataset.destinationSpeaker===speaker)?.focus();
    return true;
  }
  const {owner,key}=ownerFor(method,field),channel=d.destinationChannel;
  if(action==="destination-remove")owner[key]=(owner[key]||[]).filter(value=>value!==channel);
  else {
    const target=targetsFor(card).find(item=>item.channel===channel&&item.available!==false&&!item.alias_of);
    if(!target)return true;
    let selection=channel;
    if(action==="destination-add-sms") {
      const number=state?.numbers?.[channel]?.trim()||"";
      if(typeOf(target)!=="sms"||!target.requires_target)return true;
      if(!/^\+?[0-9]{5,15}$/.test(number)){card.editors.settingsError="Enter a phone number with 5–15 digits, optionally starting with +.";card.render();return true;}
      selection+=encodeURIComponent(number);
    }else if(action!=="destination-add"||target.requires_target)return true;
    owner[key]=[...new Set([...(owner[key]||[]),selection])];
    card.editors.deliveryPicker=null;
  }
  invalidate(card);renderAfterEdit(card,element);focusDestinationPicker(card,id,field);return true;
}
