import {escapeHtml as esc} from "./model.mjs?v=110";

const identity=source=>source.monitoring_source||source.node_id;
const matches=(match,metadata)=>Object.entries(match||{}).every(([field,values])=>values.some(value=>(metadata[field]||[]).includes(value)));

/** Evaluate saved scope and explicit overrides independently of policy enablement. */
export function entitySelected(policy,source) {
  const id=identity(source),metadata=source.attributes||{};
  if((policy.excluded_sources||[]).includes(id))return false;
  if((policy.included_sources||[]).includes(id))return true;
  if((metadata.device||[]).some(device=>(policy.excluded_sources||[]).includes(`device:${device}`)))return false;
  if(policy.check!=="entity_not_provided"&&metadata.entity_category?.length&&!policy.match?.entity)return false;
  return matches(policy.match,metadata)&&(!policy.match_any||policy.match_any.some(match=>matches(match,metadata)))&&!(policy.match_none||[]).some(match=>matches(match,metadata));
}

/** Explain the retained future scope without exposing a second selection workflow. */
export function entityScopeSummary(policy) {
  if(policy.match?.entity)return "Only selected entities are included. New entities start unchecked.";
  if(policy.match_any||policy.match_none)return "New entities follow this policy’s saved entity-type scope. Individual choices below override that scope.";
  if(Object.keys(policy.match||{}).some(key=>key!=="kind"))return "New entities follow this policy’s saved device, integration or location scope. Individual choices below override that scope.";
  return policy.check==="entity_not_provided"?"New registered entities are included automatically. Individual choices below override that default.":"New operational entities are included automatically. Individual choices below override that default.";
}

/** Resolve one complete, searchable list with stable integration and device groups. */
export function entitySelectionRows(card,policy) {
  const candidates=card.current?.data?.inventory?.catalog?.candidates||[];
  const devices=new Map(candidates.filter(source=>source.kind==="device").flatMap(source=>(source.attributes?.device||[source.node_id.slice(7)]).map(id=>[id,source.name])));
  const areas=new Map((card.editors.configuration.areas||[]).map(area=>[area.id,area.name]));
  const rows=candidates.filter(source=>source.kind==="entity").map(source=>{
    const domain=source.attributes?.integration_domain?.[0]||"",deviceId=source.attributes?.device?.[0]||"";
    const integration=domain?(card._hass?.localize?.(`component.${domain}.title`)||domain.replaceAll("_"," ").replace(/^./,letter=>letter.toUpperCase())):"Other entities";
    const device=devices.get(deviceId)||(deviceId?`Device ${deviceId}`:"Without a device");
    return {source,id:identity(source),name:source.name,entityId:source.entity_id||"",area:(source.attributes?.area||[]).map(id=>areas.get(id)||id).join(" · "),integration,integrationKey:domain,device,group:JSON.stringify([domain,deviceId]),selected:entitySelected(policy,source)};
  });
  const known=new Set(rows.map(row=>row.id));
  for(const id of new Set([...(policy.included_sources||[]),...(policy.excluded_sources||[]),...(policy.match?.entity||[]).map(ref=>`entity:${ref}`)])) {
    if(known.has(id))continue;
    rows.push({id,name:id.startsWith("device:")?(devices.has(id.slice(7))?`Excluded device: ${devices.get(id.slice(7))}`:"Excluded device no longer in the list"):"Entity no longer in the list",entityId:id,area:"",integration:"Unavailable selections",integrationKey:"unavailable",device:"Saved choices",group:"unavailable",missing:true,selected:!(policy.excluded_sources||[]).includes(id)});
  }
  const state=card.editors.entitySelection?.id===policy.id?card.editors.entitySelection:{query:"",selectedOnly:false};
  const query=(state.query||"").trim().toLocaleLowerCase();
  return rows.filter(row=>(!state.selectedOnly||row.selected)&&[row.name,row.entityId,row.area,row.integration,row.device].join(" ").toLocaleLowerCase().includes(query))
    .sort((a,b)=>a.integration.localeCompare(b.integration)||a.device.localeCompare(b.device)||a.group.localeCompare(b.group)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}

export function entitySelection(card,policy) {
  const data=card.current?.data,pending=!data?.inventory?.catalog||data.schema_version===3&&!data.catalog_loaded,stale=data?.catalog_stale;
  const state=card.editors.entitySelection?.id===policy.id?card.editors.entitySelection:{query:"",selectedOnly:false},rows=entitySelectionRows(card,policy);
  const attr=field=>`data-definition-kind="policies" data-definition-id="${esc(policy.id)}" data-definition-field="${field}"`;
  const integrations=new Map(),searching=Boolean(state.query?.trim());
  for(const row of rows) {
    if(!integrations.has(row.integrationKey))integrations.set(row.integrationKey,new Map());
    const groups=integrations.get(row.integrationKey);
    if(!groups.has(row.group))groups.set(row.group,[]);
    groups.get(row.group).push(row);
  }
  const branch=(key,name,group,field,value,contents)=>{
    const expanded=searching?!(state.searchCollapsed||[]).includes(key):(state.expanded||[]).includes(key);
    const id=`entity-branch-${encodeURIComponent(policy.id)}-${encodeURIComponent(key)}`;
    const selectable=group.filter(row=>!row.missing&&!row.source.disabled),count=selectable.filter(row=>row.selected).length,mixed=count>0&&count<selectable.length;
    return `<li><div class="entity-selection-branch"><button type="button" class="entity-selection-toggle tree-toggle" data-definition-action="entity-expand" ${attr("entity-expand")} data-definition-value="${esc(key)}" aria-expanded="${expanded}" aria-controls="${id}" aria-label="${expanded?"Collapse":"Expand"} ${esc(name)}"><span class="disclosure" aria-hidden="true"></span></button>${selectable.length?`<label class="entity-selection-bulk"><input type="checkbox" ${attr(field)} data-definition-value="${esc(value)}" aria-label="Monitor ${searching||state.selectedOnly?"matching ":""}entities under ${esc(name)}"${count===selectable.length?" checked":""}${mixed?' data-indeterminate="true" aria-checked="mixed"':""}${pending||stale?" disabled":""}><span>${esc(name)}<span class="entity-selection-context">${count} of ${selectable.length} ${searching||state.selectedOnly?"matching ":""}entities selected</span></span></label>`:`<span class="entity-selection-branch-name">${esc(name)}</span>`}</div><ul id="${id}" class="entity-selection-children"${expanded?"":" hidden"}>${expanded?contents():""}</ul></li>`;
  };
  const device=group=>{
    const first=group[0];
    return branch(`device:${first.group}`,first.device,group,"entity-group",first.group,()=>group.map(row=>`<li>${row.missing?`<div class="entity-selection-row"><span>${esc(row.name)}<span class="entity-selection-context">${esc(row.id)}</span></span><button type="button" class="button" data-definition-action="entity-forget" ${attr("entity-forget")} data-definition-value="${esc(row.id)}"${pending||stale?" disabled":""}>Remove saved choice</button></div>`:`<label class="entity-selection-row"><input type="checkbox" ${attr("entity-choice")} data-definition-value="${esc(row.id)}"${row.selected&&!row.source.disabled?" checked":""}${row.source.disabled||pending||stale?" disabled":""}><span>${esc(row.name)}<span class="entity-selection-context">${esc([row.area,row.entityId,row.source.disabled?"Disabled in Home Assistant":""].filter(Boolean).join(" · "))}</span></span></label>`}</li>`).join(""));
  };
  const content=[...integrations.values()].map(groups=>{
    const first=groups.values().next().value[0];
    return branch(`integration:${first.integrationKey}`,first.integration,[...groups.values()].flat(),"entity-integration",first.integrationKey,()=>[...groups.values()].map(device).join(""));
  }).join("");
  return `<section class="entity-selection" aria-label="Entity selection"><p class="small">${entityScopeSummary(policy)}</p><label class="installation-field"><span>Search entities</span><input type="search" ${attr("entity-search")} value="${esc(state.query||"")}" placeholder="Name, integration, device or area"></label><label class="entity-selection-filter"><input type="checkbox" ${attr("entity-selected-only")}${state.selectedOnly?" checked":""}>Monitored only</label>${pending||stale?`<p role="status">${card.current?.catalogError?`Could not load entities: ${esc(card.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry</button>`:pending?"Loading entities…":"Updating entities…"}</p>`:""}${content?`<ul class="entity-selection-tree">${content}</ul>`:!pending?'<p>No entities match your search.</p>':""}<p class="small">Changes apply to this policy when you save. Disabled entities are not monitored.</p></section>`;
}

export function chooseEntitySource(policy,row,selected) {
  const id=row.id;
  policy.included_sources=(policy.included_sources||[]).filter(value=>value!==id);
  policy.excluded_sources=(policy.excluded_sources||[]).filter(value=>value!==id);
  if(selected) {
    if(!entitySelected(policy,row.source))policy.included_sources.push(id);
  }else if(entitySelected(policy,row.source))policy.excluded_sources.push(id);
  if(!policy.included_sources.length)delete policy.included_sources;
  if(!policy.excluded_sources.length)delete policy.excluded_sources;
}

/** Keep browsing independent of membership and retain the complete saved scope. */
export function editEntitySelection(card,event,element,invalidate,renderAfterEdit) {
  const field=element.dataset.definitionField;
  if(!field?.startsWith("entity-"))return false;
  const policy=card.editors.settingsDraft.monitoring_policies.find(policy=>policy.id===element.dataset.definitionId);
  if(!policy||!["availability","entity_not_provided"].includes(policy.check)||policy.match?.kind?.[0]!=="entity")return true;
  card.editors.entitySelection=card.editors.entitySelection?.id===policy.id?card.editors.entitySelection:{id:policy.id,query:"",selectedOnly:false};
  if(field==="entity-expand") {
    if(event.type!=="click")return true;
    const key=element.dataset.definitionValue,searching=Boolean(card.editors.entitySelection.query.trim()),property=searching?"searchCollapsed":"expanded";
    const expanded=new Set(card.editors.entitySelection[property]||[]);
    if(expanded.has(key))expanded.delete(key);else expanded.add(key);
    card.editors.entitySelection[property]=[...expanded];
    renderAfterEdit(card,element);return true;
  }
  if(field==="entity-search"||field==="entity-selected-only") {
    if(event.type==="click")return true;
    card.editors.entitySelection[field==="entity-search"?"query":"selectedOnly"]=field==="entity-search"?element.value:element.checked;
    card.editors.entitySelection.searchCollapsed=[];
    renderAfterEdit(card,element);return true;
  }
  if(card.current?.data?.catalog_stale||card.current?.data?.catalog_loaded===false)return true;
  if(field==="entity-forget") {
    if(event.type!=="click")return true;
    for(const key of ["included_sources","excluded_sources"]) {
      policy[key]=(policy[key]||[]).filter(value=>value!==element.dataset.definitionValue);
      if(!policy[key].length)delete policy[key];
    }
    if(policy.match.entity)policy.match.entity=policy.match.entity.filter(ref=>`entity:${ref}`!==element.dataset.definitionValue);
  }else {
    if(event.type!=="change")return true;
    const rows=entitySelectionRows(card,policy).filter(row=>!row.missing&&!row.source.disabled);
    for(const row of rows)if(field==="entity-integration"?row.integrationKey===element.dataset.definitionValue:field==="entity-group"?row.group===element.dataset.definitionValue:row.id===element.dataset.definitionValue)chooseEntitySource(policy,row,element.checked);
  }
  invalidate(card);renderAfterEdit(card,element);return true;
}
