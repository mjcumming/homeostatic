import {escapeHtml as esc,inventoryRows} from "./model.mjs?v=110";
import {chooseEntitySource,entitySelected,entitySelectionRows} from "./entity-selection.mjs?v=110";

export const SOURCE_CATEGORIES={
  any:{name:"Any entity type"},
  cameras:{name:"Cameras",match:{domain:["camera"]}},
  locks:{name:"Locks",match:{domain:["lock"]}},
  alarm_panels:{name:"Alarm panels",match:{domain:["alarm_control_panel"]}},
  safety_sensors:{name:"Safety sensors",match:{domain:["binary_sensor"],device_class:["smoke","carbon_monoxide","gas","moisture"]}},
};
const identity=source=>source.monitoring_source||source.node_id;
const matches=(match,metadata)=>Object.entries(match||{}).every(([key,values])=>values.some(value=>(metadata[key]||[]).includes(value)));
const deviceExcluded=(policy,source)=>(source.attributes?.device||[]).some(id=>(policy.excluded_sources||[]).includes(`device:${id}`));
const kind=policy=>policy.match?.kind?.[0]||(policy.check.startsWith("ups_")?"ups":["availability","thermostat","temperature_limit","entity_not_provided"].includes(policy.check)?"entity":policy.check);
const entityPolicy=policy=>policy.check==="availability"&&kind(policy)==="entity";
const field=policy=>({integration:"integration",ups:"device"}[kind(policy)]||"entity");
const complete=card=>Boolean(card.current?.data?.inventory?.catalog)&&card.current.data.catalog_loaded!==false;

/** Recognize supported source categories from saved scope, never names or identities. */
export function sourceCategory(policy) {
  if(!entityPolicy(policy)||policy.match_none)return "any";
  if(policy.match_any&&["domain","device_class"].some(key=>policy.match?.[key]))return "any";
  const scope=policy.match_any?.length===1?policy.match_any[0]:policy.match_any?null:Object.fromEntries(Object.entries(policy.match||{}).filter(([key])=>["domain","device_class"].includes(key)));
  if(!scope)return "any";
  return Object.keys(SOURCE_CATEGORIES).find(key=>{
    const expected=SOURCE_CATEGORIES[key].match;
    return expected&&Object.keys(scope).length===Object.keys(expected).length&&Object.entries(expected).every(([name,values])=>scope[name]?.length===values.length&&values.every(value=>scope[name].includes(value)));
  })||"any";
}

export function sourceNoun(policy) {
  const category=sourceCategory(policy);
  return category!=="any"?SOURCE_CATEGORIES[category].name.toLowerCase():{thermostat:"thermostats",temperature_limit:"temperature sensors"}[policy.check]||{integration:"integrations",battery:"batteries",vacuum:"vacuums",entity:"entities",ups:"UPS devices"}[kind(policy)]||"sources";
}

export function futureMode(policy) {
  return policy.match?.area?"area":policy.match?.label?"label":policy.match?.[field(policy)]?"selected":"all";
}

export function sourceSelected(policy,source) {
  if(entityPolicy(policy))return entitySelected(policy,source);
  return !(policy.excluded_sources||[]).includes(identity(source))&&!deviceExcluded(policy,source)&&matches(policy.match,source.attributes||{});
}

/** Resolve complete source choices, including saved exceptions and missing identities. */
export function flatSourceRows(card,policy) {
  const category=sourceCategory(policy),scope={...policy.match},sourceField=field(policy);
  delete scope[sourceField];
  const originals=new Map((card.current?.data?.inventory?.catalog?.candidates||[]).map(source=>[source.node_id,source]));
  const candidates=complete(card)?[...new Map(inventoryRows(card.current.data).map(source=>[identity(source),originals.get(identity(source))||source])).values()]:[],saved=new Set([...(policy.excluded_sources||[]),...(policy.included_sources||[])]);
  const exact=policy.match?.[sourceField]||[];
  const eligible=source=>source.kind===kind(policy)&&(policy.check!=="thermostat"||source.attributes?.domain?.includes("climate"))&&(policy.check!=="temperature_limit"||source.attributes?.device_class?.includes("temperature"));
  const sources=candidates.filter(eligible);
  const areas=new Map((card.editors.configuration.areas||[]).map(area=>[area.id,area])),floors=new Map((card.editors.configuration.floors||[]).map(floor=>[floor.id,floor.name]));
  const context=source=>{
    const areaId=source.attributes?.area?.[0],area=areas.get(areaId);
    return source.kind==="integration"?"":areaId?area?[area.name,floors.get(area.floor_id)].filter(Boolean).join(" · "):"Area unavailable":"No area assigned";
  };
  let rows;
  if(entityPolicy(policy)) {
    rows=entitySelectionRows({...card,editors:{...card.editors,entitySelection:null}},policy).filter(row=>row.missing||matches(SOURCE_CATEGORIES[category]?.match,row.source?.attributes||{})||row.selected||saved.has(row.id)||exact.some(id=>row.source?.attributes?.entity?.includes(id))).map(row=>({...row,area:row.source?context(row.source):row.area,outsideCategory:!row.missing&&!matches(SOURCE_CATEGORIES[category]?.match,row.source.attributes||{})}));
  }else {
    rows=sources.filter(source=>matches(scope,source.attributes||{})||saved.has(identity(source))||exact.some(ref=>source.attributes?.[sourceField]?.includes(ref))).map(source=>{
      return {id:identity(source),source,name:source.name,entityId:source.entity_id||"",area:context(source),selected:sourceSelected(policy,source),outsideScope:!matches(scope,source.attributes||{}),blockedByDevice:deviceExcluded(policy,source)};
    });
    const known=new Set(rows.map(row=>row.id));
    for(const id of saved)if(!known.has(id))rows.push({id,name:"Source no longer in the list",area:"",entityId:id,missing:true});
    for(const ref of exact)if(!sources.some(source=>source.attributes?.[sourceField]?.includes(ref))) {
      const id=`${kind(policy)==="integration"?"entry":kind(policy)}:${ref}`,existing=rows.find(row=>row.id===id);
      if(existing)existing.ref=ref;
      else rows.push({id,ref,name:"Source no longer in the list",area:"",entityId:ref,missing:true});
    }
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.area.localeCompare(b.area)||a.id.localeCompare(b.id));
}

export function sourceScopeSummary(policy) {
  const mode=futureMode(policy),noun=sourceNoun(policy);
  return mode==="selected"?`Only selected ${noun} are included. New sources start unchecked.`:mode==="area"?"New sources in the selected areas are included automatically. Individual exclusions remain in effect.":mode==="label"?"New sources with the selected labels are included automatically. Individual exclusions remain in effect.":`New ${noun} follow this policy’s saved matching scope. Individual exclusions remain in effect.`;
}

function sourceGroups(card,policy,mode) {
  const scope={...policy,match:{...policy.match}};
  delete scope.match.area;delete scope.match.label;delete scope.match[field(policy)];
  delete scope.included_sources;delete scope.excluded_sources;
  const rows=flatSourceRows(card,scope).filter(row=>row.source&&!row.source.disabled&&(!entityPolicy(policy)||!row.source.attributes?.entity_category?.length));
  const groups=card.editors.configuration[mode==="area"?"areas":"labels"]||[];
  return groups.map(group=>({...group,count:rows.filter(row=>row.source.attributes?.[mode]?.includes(group.id)).length}));
}

/** Keep focused source selection in the policy editor, with one meaning for checked. */
export function flatSourceSelection(card,policy) {
  const mode=futureMode(policy),noun=sourceNoun(policy),pending=!complete(card),stale=card.current?.data?.catalog_stale,disabled=pending||stale;
  const attr=name=>`data-definition-kind="policies" data-definition-id="${esc(policy.id)}" data-definition-field="${name}"`;
  const state=card.editors.sourceSelection?.id===policy.id?card.editors.sourceSelection:{query:"",selectedOnly:false};
  const rows=flatSourceRows(card,policy),query=(state.query||"").trim().toLocaleLowerCase();
  const visible=rows.filter(row=>(!state.selectedOnly||row.selected||row.missing)&&[row.name,row.area,row.entityId,row.id].join(" ").toLocaleLowerCase().includes(query));
  const choices={selected:"Do not include automatically",all:"Include automatically",...(kind(policy)==="integration"?{}:{area:"In selected areas",label:"With selected labels"})};
  const groupChoices=["area","label"].includes(mode)?sourceGroups(card,policy,mode):[];
  const groups=groupChoices.length||["area","label"].includes(mode)?`<fieldset class="source-groups"><legend>${mode==="area"?"Areas":"Labels"}</legend><label class="entity-selection-filter"><input type="checkbox" ${attr("source-show-all")}${state.showAll?" checked":""}>Show all ${mode==="area"?"areas":"labels"}</label>${groupChoices.filter(group=>pending||stale||state.showAll||group.count||policy.match[mode].includes(group.id)).map(group=>`<label class="entity-selection-row"><input type="checkbox" ${attr("source-group")} data-definition-value="${esc(group.id)}"${policy.match[mode].includes(group.id)?" checked":""}${disabled?" disabled":""}><span>${esc(group.name)}<span class="entity-selection-context">${pending||stale?"Matching sources not loaded":`${group.count} eligible ${esc(noun)}`}</span></span></label>`).join("")}${policy.match[mode].filter(id=>!groupChoices.some(group=>group.id===id)).map(id=>`<label class="entity-selection-row"><input type="checkbox" ${attr("source-group")} data-definition-value="${esc(id)}" checked${disabled?" disabled":""}><span>Unavailable ${mode}<span class="entity-selection-context">${esc(id)}</span></span></label>`).join("")}</fieldset>`:"";
  const status=pending||stale?`<p role="status">${card.current?.catalogError?`Could not ${pending?"load":"update"} available sources: ${esc(card.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry</button>`:pending?"Loading available sources…":"Updating available sources…"}</p>`:"";
  const forget=item=>`<button type="button" class="button" data-definition-action="source-forget" ${attr("source-forget")} data-definition-value="${esc(item.id)}"${item.ref?` data-source-ref="${esc(item.ref)}"`:""}${disabled?" disabled":""}>Remove saved choice</button>`;
  const row=item=>`<li>${item.missing?`<div class="entity-selection-row"><span>${esc(item.name)}<span class="entity-selection-context">${esc(item.id)}</span></span>${forget(item)}</div>`:`<label class="entity-selection-row"><input type="checkbox" ${attr("source-choice")} data-definition-value="${esc(item.id)}"${item.selected&&!item.source.disabled?" checked":""}${disabled||item.source.disabled||item.outsideScope||item.blockedByDevice?" disabled":""}><span>${esc(item.name)}<span class="entity-selection-context">${esc([item.area,item.source.disabled?"Disabled in Home Assistant":item.blockedByDevice?"Excluded device":item.outsideScope?"Outside the selected scope":item.outsideCategory?"Saved choice outside category":""].filter(Boolean).join(" · "))}</span>${rows.some(other=>other.id!==item.id&&other.name===item.name&&other.area===item.area)?`<span class="entity-selection-context">${esc(item.entityId||item.id)}</span>`:""}</span></label>${item.outsideScope?forget(item):""}`}</li>`;
  return `<section class="source-selection" aria-label="${esc(noun)} selection"><label class="installation-field"><span>Future sources</span><select ${attr("source-future")}${disabled?" disabled":""}>${Object.entries(choices).map(([value,label])=>`<option value="${value}"${mode===value?" selected":""}>${label}</option>`).join("")}</select></label><p class="small">${sourceScopeSummary(policy)}</p>${groups}<label class="installation-field"><span>Search ${esc(noun)}</span><input type="search" ${attr("source-search")} value="${esc(state.query||"")}" placeholder="Name or area"></label><label class="entity-selection-filter"><input type="checkbox" ${attr("source-selected-only")}${state.selectedOnly?" checked":""}>Monitored only</label>${status}<ul class="source-selection-list">${visible.map(row).join("")}</ul>${!visible.length&&!pending?`<p>No ${esc(noun)} match your selection or search.</p>`:""}<p class="small" role="status">${pending||stale?"Selection count awaits current sources":`${rows.filter(row=>row.selected&&row.source&&!row.source.disabled).length} selected`}</p><p class="small">Changes apply when you save this policy.</p></section>`;
}

/** Edit matching scope only on deliberate controls; browsing never changes membership. */
export function editSourceSelection(card,event,element,invalidate,renderAfterEdit) {
  const name=element.dataset.definitionField;
  if(!name?.startsWith("source-"))return false;
  const policy=card.editors.settingsDraft.monitoring_policies.find(item=>item.id===element.dataset.definitionId);
  if(!policy)return true;
  card.editors.sourceSelection=card.editors.sourceSelection?.id===policy.id?card.editors.sourceSelection:{id:policy.id,query:"",selectedOnly:false};
  if(["source-search","source-selected-only","source-show-all"].includes(name)) {
    if(event.type==="click")return true;
    card.editors.sourceSelection[name==="source-search"?"query":name==="source-show-all"?"showAll":"selectedOnly"]=name==="source-search"?element.value:element.checked;
    renderAfterEdit(card,element);return true;
  }
  if(!complete(card)||card.current.data.catalog_stale)return true;
  const sourceField=field(policy),id=element.dataset.definitionValue;
  if(name==="source-forget") {
    if(event.type!=="click")return true;
    const row=flatSourceRows(card,policy).find(row=>row.id===id);
    const refs=new Set([...(row?.source?.attributes?.[sourceField]||[]),...(element.dataset.sourceRef?[element.dataset.sourceRef]:[]),...(row?.ref?[row.ref]:[]),...(id.startsWith("entity:")?[id.slice(7)]:[])]);
    for(const key of ["included_sources","excluded_sources"]){policy[key]=(policy[key]||[]).filter(value=>value!==id);if(!policy[key].length)delete policy[key];}
    if(policy.match[sourceField])policy.match[sourceField]=policy.match[sourceField].filter(value=>!refs.has(value));
  }else {
    if(event.type!=="change")return true;
    if(name==="source-future") {
      const selected=flatSourceRows(card,policy).filter(row=>row.source&&row.selected&&!row.source.disabled);
      const previous=policy.match[sourceField]||[];
      delete policy.match.area;delete policy.match.label;delete policy.match[sourceField];
      if(element.value==="selected")policy.match[sourceField]=[...new Set([...previous,...selected.flatMap(row=>row.source.attributes?.[sourceField]||[])])];
      else if(["area","label"].includes(element.value))policy.match[element.value]=[];
    }else if(name==="source-group") {
      const mode=futureMode(policy),values=policy.match[mode];
      if(!["area","label"].includes(mode))return true;
      policy.match[mode]=element.checked?[...new Set([...values,id])]:values.filter(value=>value!==id);
    }else if(name==="source-choice") {
      const row=flatSourceRows(card,policy).find(row=>row.id===id&&!row.missing&&!row.source.disabled&&!row.outsideScope&&!row.blockedByDevice);
      if(!row)return true;
      if(entityPolicy(policy))chooseEntitySource(policy,row,element.checked);
      else {
        policy.excluded_sources=(policy.excluded_sources||[]).filter(value=>value!==id);
        if(policy.match[sourceField]) {
          const refs=row.source.attributes?.[sourceField]||[];
          policy.match[sourceField]=element.checked?[...new Set([...policy.match[sourceField],...refs])]:policy.match[sourceField].filter(value=>!refs.includes(value));
        }else if(!element.checked)policy.excluded_sources.push(id);
        if(!policy.excluded_sources.length)delete policy.excluded_sources;
      }
    }else return true;
  }
  invalidate(card);renderAfterEdit(card,element);return true;
}
