/** Scope edits over confirmed settings while retaining the existing server save guards. */
const copy=value=>value===undefined?undefined:structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const generalKeys=["timings","consumer"];
const keyOf=scope=>scope.id?`${scope.kind}:${scope.id}`:scope.kind;
const methods=settings=>settings?.notification_definitions?.methods||{};
const profiles=settings=>settings?.notification_definitions?.profiles||{};
const policy=(settings,id)=>settings?.monitoring_policies?.find(item=>item.id===id);
const definitionMetadata=settings=>settings?.notification_definitions?Object.fromEntries(Object.entries(settings.notification_definitions).filter(([key])=>!["methods","profiles"].includes(key))):settings?.notification_definitions;

function definitions(settings) {
  return settings.notification_definitions;
}

function read(settings,scope) {
  if(scope.kind==="source-availability")return settings.monitoring_policies;
  if(scope.kind==="policy")return policy(settings,scope.id);
  if(scope.kind==="method")return methods(settings)[scope.id];
  if(scope.kind==="profile")return profiles(settings)[scope.id];
  if(scope.kind==="notifications")return settings.notifications;
  if(scope.kind==="settings")return Object.fromEntries(generalKeys.map(key=>[key,settings[key]]));
  throw new Error("Choose a supported configuration scope.");
}

function write(settings,scope,value) {
  if(scope.kind==="policy") {
    const rows=settings.monitoring_policies??=[],index=rows.findIndex(item=>item.id===scope.id);
    if(value===undefined){if(index>=0)rows.splice(index,1);}
    else if(index>=0)rows[index]=copy(value);
    else rows.push(copy(value));
  }else if(scope.kind==="method") {
    if(value===undefined){if(settings.notification_definitions)delete settings.notification_definitions.methods[scope.id];}
    else definitions(settings).methods[scope.id]=copy(value);
  }else if(scope.kind==="profile") {
    if(value===undefined){if(settings.notification_definitions?.profiles)delete settings.notification_definitions.profiles[scope.id];}
    else (definitions(settings).profiles??={})[scope.id]=copy(value);
  }else if(scope.kind==="notifications")settings.notifications=value;
  else if(scope.kind==="settings")for(const key of generalKeys) {
    if(value[key]===undefined)delete settings[key];else settings[key]=copy(value[key]);
  }
}

function scopes(...settings) {
  return [
    {kind:"notifications"},{kind:"settings"},
    ...[...new Set(settings.flatMap(value=>(value?.monitoring_policies||[]).map(item=>item.id)))].map(id=>({kind:"policy",id})),
    ...[...new Set(settings.flatMap(value=>Object.keys(methods(value))))].map(id=>({kind:"method",id})),
    ...[...new Set(settings.flatMap(value=>Object.keys(profiles(value))))].map(id=>({kind:"profile",id})),
  ];
}

/** Call after the first confirmed configuration load, before editing. */
export function initializeScopedConfiguration(card) {
  if(!card.configuration?.settings)return null;
  if(card.scopedConfiguration)return card.scopedConfiguration;
  card.settingsDraft??=copy(card.configuration.settings);
  const saved=copy(card.configuration),baselines=new Map();
  for(const scope of scopes(saved.settings))baselines.set(keyOf(scope),copy(read(saved.settings,scope)));
  return card.scopedConfiguration={saved,baselines,needsRefresh:false};
}

/** Install refreshed saved settings without replacing independent or conflicting drafts. */
export function rebaseScopedConfiguration(card,fresh) {
  if(!fresh?.settings||typeof fresh.revision!=="string")throw new Error("Current saved settings could not be read.");
  const state=initializeScopedConfiguration(card);
  if(!state){card.configuration=copy(fresh);card.settingsDraft=copy(fresh.settings);initializeScopedConfiguration(card);return;}
  const draft=card.settingsDraft;
  for(const scope of scopes(state.saved.settings,fresh.settings,draft)) {
    const key=keyOf(scope),base=state.baselines.get(key),local=read(draft,scope),next=read(fresh.settings,scope);
    if(scope.kind==="settings") {
      const value=copy(local),baseline=copy(base||{});
      for(const field of generalKeys)if(same(local[field],base?.[field])||same(local[field],next[field])) {
        value[field]=copy(next[field]);baseline[field]=copy(next[field]);
      }
      write(draft,scope,value);state.baselines.set(key,baseline);
    }else if(same(local,base)||same(local,next)) {
      write(draft,scope,next);state.baselines.set(key,copy(next));
    }
  }
  if(same(definitionMetadata(draft),definitionMetadata(state.saved.settings))) {
    const localMethods=copy(methods(draft)),localProfiles=copy(draft.notification_definitions?.profiles);
    draft.notification_definitions=fresh.settings.notification_definitions?{...copy(definitionMetadata(fresh.settings)),methods:localMethods,...(localProfiles===undefined?{}:{profiles:localProfiles})}:fresh.settings.notification_definitions;
  }
  card.configuration={...card.configuration,...copy(fresh)};
  state.saved=copy(card.configuration);state.needsRefresh=false;
}

export function scopedDirty(card,scope) {
  if(!initializeScopedConfiguration(card))return false;
  return !same(read(card.settingsDraft,scope),read(card.configuration.settings,scope));
}

function status(card,scope,error=null,notice=null) {
  card.scopedStatusScope=keyOf(scope);card.scopedError=error;card.scopedNotice=notice;
}

/** Discard just this editor while preserving other scopes. */
export function discardScopedConfiguration(card,scope) {
  const state=initializeScopedConfiguration(card);
  if(!state||card.scopedBusy)return false;
  const value=read(card.configuration.settings,scope);
  write(card.settingsDraft,scope,value);state.baselines.set(keyOf(scope),copy(value));
  status(card,scope,null,"Unsaved changes discarded.");card.render?.();return true;
}

function assertUnchanged(state,scope,current) {
  const baseline=state.baselines.get(keyOf(scope));
  if(!same(baseline,read(current,scope)))throw new Error("Saved settings for this editor changed. Your draft is preserved. Discard it to load the saved version, or reconcile the changes before saving.");
}

function rowsIn(defs) {
  if(!defs)return [];
  const rows=[defs.default,defs.repairs,defs.broken_automations,...Object.values(defs.automation_profiles||{})];
  for(const assignment of Object.values(defs.assignments||{}))rows.push(assignment.default,...Object.values(assignment.checks||{}));
  return rows.filter(Array.isArray);
}

function removeMethod(card,candidate,id,operation) {
  if(!methods(candidate)[id])throw new Error("This delivery method no longer exists.");
  if(scopedDirty(card,{kind:"method",id}))throw new Error("Save or discard this method's draft before deleting it.");
  const replacement=operation.replacement;
  if(replacement&&(replacement===id||!methods(candidate)[replacement]))throw new Error("Choose a different saved replacement method.");
  const affected=(candidate.monitoring_policies||[]).filter(item=>item.notifications.some(row=>row.methods?.includes(id)));
  for(const item of affected)if(scopedDirty(card,{kind:"policy",id:item.id}))throw new Error("Save or discard policy drafts using this method before deleting it.");
  for(const item of card.settingsDraft.monitoring_policies||[]) {
    if(scopedDirty(card,{kind:"policy",id:item.id})&&item.notifications.some(row=>row.methods?.includes(id)))throw new Error("Save or discard policy drafts using this method before deleting it.");
  }
  const affectedProfiles=Object.entries(profiles(candidate)).filter(([,profile])=>profile.methods.includes(id));
  for(const pid of new Set([...affectedProfiles.map(([pid])=>pid),...Object.entries(profiles(card.settingsDraft)).filter(([,profile])=>profile.methods.includes(id)).map(([pid])=>pid)])) {
    if(scopedDirty(card,{kind:"profile",id:pid}))throw new Error("Save or discard notification drafts using this method before deleting it.");
  }
  const rows=[...rowsIn(candidate.notification_definitions),...affected.map(item=>item.notifications)];
  if((affectedProfiles.length||rows.some(items=>items.some(row=>row.methods?.includes(id))))&&!replacement&&!operation.removeReferences)throw new Error("Choose a replacement or explicitly remove this method from its entries.");
  const withoutMethod=ids=>[...new Set(ids.flatMap(mid=>mid!==id?[mid]:replacement?[replacement]:[]))];
  for(const items of rows)for(let index=items.length-1;index>=0;index--) {
    const row=items[index];if(!row.methods?.includes(id))continue;
    row.methods=withoutMethod(row.methods);
    if(!row.methods.length)items.splice(index,1);
  }
  for(const [,profile] of affectedProfiles)profile.methods=withoutMethod(profile.methods);
  delete candidate.notification_definitions.methods[id];
}

function removeProfile(card,candidate,id,operation) {
  if(!profiles(candidate)[id])throw new Error("This notification no longer exists.");
  if(scopedDirty(card,{kind:"profile",id}))throw new Error("Save or discard this notification's draft before deleting it.");
  const replacement=operation.replacement;
  if(replacement&&(replacement===id||!profiles(candidate)[replacement]))throw new Error("Choose a different saved replacement notification.");
  const affected=(candidate.monitoring_policies||[]).filter(item=>item.notifications.some(row=>row.profile===id));
  for(const pid of new Set([...affected.map(item=>item.id),...(card.settingsDraft.monitoring_policies||[]).filter(item=>item.notifications.some(row=>row.profile===id)).map(item=>item.id)])) {
    if(scopedDirty(card,{kind:"policy",id:pid}))throw new Error("Save or discard policy drafts using this notification before deleting it.");
  }
  const rows=[...rowsIn(candidate.notification_definitions),...affected.map(item=>item.notifications)];
  if(rows.some(items=>items.some(row=>row.profile===id))&&!replacement&&!operation.removeReferences)throw new Error("Choose a replacement or explicitly remove this notification's assignments.");
  for(const items of rows)for(let index=items.length-1;index>=0;index--) {
    const row=items[index];if(row.profile!==id)continue;
    if(replacement)row.profile=replacement;
    else items.splice(index,1);
  }
  delete candidate.notification_definitions.profiles[id];
}

function proposal(card,scope,value) {
  const state=card.scopedConfiguration,current=card.configuration.settings,candidate=copy(current);
  if(scope.kind==="source-availability") {
    if(value?.revision!==card.configuration.revision)throw new Error("Saved settings changed. Review the affected policies again before saving.");
    if(!value.changes?.length)throw new Error("No availability monitoring changes were selected.");
    const ids=new Set();
    for(const change of value.changes) {
      const selected={kind:"policy",id:change.id},saved=policy(current,change.id);
      if(ids.has(change.id)||!saved||saved.check!=="availability")throw new Error("Choose existing availability policies.");
      ids.add(change.id);
      if(!same(saved,change.before))throw new Error("An affected policy changed. Review the availability change again.");
      if(scopedDirty(card,selected))throw new Error(`Save or discard the draft for “${saved.name}” before changing its availability monitoring.`);
      const {excluded_sources:before,...beforeFields}=saved,{excluded_sources:after,...afterFields}=change.after;
      if(!same(beforeFields,afterFields)||after!==undefined&&(!Array.isArray(after)||after.some(id=>typeof id!=="string")))throw new Error("This action can change availability exclusions only.");
      const changed=new Set([...(before||[]),...(after||[])].filter(id=>(before||[]).includes(id)!==(after||[]).includes(id)));
      if([...changed].some(id=>!value.sourceIds?.includes(id)))throw new Error("Only the selected entities can change monitoring.");
      write(candidate,selected,change.after);
    }
  }else if(scope.kind==="notifications") {
    if(typeof value!=="boolean")throw new Error("Choose whether notifications are on or off.");
    candidate.notifications=value;
  }else if(scope.kind==="policy"&&typeof value==="boolean") {
    if(scopedDirty(card,scope))throw new Error("Continue editing this policy before changing its saved enabled state.");
    const saved=policy(candidate,scope.id);if(!saved)throw new Error("Save this policy before changing its enabled state.");
    saved.enabled=value;
  }else if(scope.kind==="method"&&value?.delete)removeMethod(card,candidate,scope.id,value);
  else if(scope.kind==="profile"&&value?.delete)removeProfile(card,candidate,scope.id,value);
  else if(scope.kind==="settings") {
    const local=read(card.settingsDraft,scope),base=state.baselines.get("settings")||{},saved=read(current,scope),changed={...saved};
    for(const field of generalKeys)if(!same(local[field],base[field])) {
      if(!same(saved[field],base[field]))throw new Error("Saved installation settings changed. Your draft is preserved; reconcile it before saving.");
      changed[field]=copy(local[field]);
    }
    write(candidate,scope,changed);
  }else {
    assertUnchanged(state,scope,current);
    const desired=read(card.settingsDraft,scope);
    if(scope.kind==="policy"&&desired?.id!==undefined&&desired.id!==scope.id)throw new Error("The policy identity cannot change.");
    write(candidate,scope,desired);
  }
  return candidate;
}

function acceptSubmitted(card,scope,submitted,operation) {
  const state=card.scopedConfiguration;
  if(scope.kind==="source-availability") {
    for(const change of operation.changes) {
      const selected={kind:"policy",id:change.id},saved=read(submitted,selected);
      if(same(read(card.settingsDraft,selected),change.before))write(card.settingsDraft,selected,saved);
      state.baselines.set(keyOf(selected),copy(saved));
    }
    return;
  }
  state.baselines.set(keyOf(scope),copy(read(submitted,scope)));
  if(scope.kind==="notifications"||scope.kind==="policy"&&typeof operation==="boolean")write(card.settingsDraft,scope,read(submitted,scope));
  if(["method","profile"].includes(scope.kind)&&operation?.delete)write(card.settingsDraft,scope,undefined);
}

function errorText(error) {
  return typeof error==="string"?error:error?.message||error?.error?.message||"Could not confirm the save. Your edits are retained; refresh saved settings before trying again.";
}

/** Save one explicit scope; the server still validates and applies a complete exact payload. */
export async function saveScopedConfiguration(card,scope,value) {
  const state=initializeScopedConfiguration(card);
  if(!state||card.scopedBusy||card.settingsBusy||card.configBusy||card.current?.status!=="current")return false;
  card.scopedBusy=keyOf(scope);card.settingsBusy=true;status(card,scope);card.render?.();
  let saved=false;
  try {
    if(state.needsRefresh)rebaseScopedConfiguration(card,await card._hass.callWS({type:"homeostatic/configuration",section:"settings"}));
    const candidate=proposal(card,scope,value);
    if(scope.kind==="source-availability") {
      if(card.current?.status!=="current")throw new Error("Monitoring is not connected. Reconnect before changing availability monitoring.");
      if(card.current.data?.catalog_stale||card.current.data?.catalog_loaded===false)throw new Error("Wait for the source list to finish updating before changing availability monitoring.");
      if(value.catalogRevision!==card.current.data?.catalog_revision)throw new Error("The monitored source list changed. Review the affected policies again before saving.");
    }
    if(same(candidate,card.configuration.settings))return true;
    const revision=card.configuration.revision;
    const response=await card._hass.callWS({type:"homeostatic/save_settings",revision,settings:copy(candidate)});
    if(response?.saved!==true)throw new Error("The save was not confirmed. Refresh saved settings before trying again.");
    saved=true;acceptSubmitted(card,scope,candidate,value);
    const fresh=await card._hass.callWS({type:"homeostatic/configuration",section:"settings"});
    rebaseScopedConfiguration(card,fresh);
    status(card,scope,null,scope.kind==="notifications"?null:scope.kind==="source-availability"?"Availability monitoring updated.":scopedDirty(card,scope)?"Changes saved. Newer edits are still unsaved.":"Changes saved.");
    return true;
  }catch(error) {
    const code=error?.code||error?.error?.code;
    state.needsRefresh=saved||!code||code==="stale_configuration";
    status(card,scope,saved?"Changes were saved, but current settings could not be reloaded. Your other drafts are retained. Refresh saved settings before continuing.":errorText(error));
    return false;
  }finally {
    card.scopedBusy=null;card.settingsBusy=false;card.render?.();
  }
}
