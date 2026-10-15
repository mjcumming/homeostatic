import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";

export async function runBrowsingControlPaths(context) {
  const {card,root,check,find,settle,click,change,save,runPath,getSaved}=context;
  const go=async page=>{await click(`[data-page="${page}"]`);if(page==="policies"&&root.querySelector('.unified-policy-editor'))await click('[data-definition-action="close"]');};
  await runPath("policies.scope",async()=>{
    const battery=baseSource("battery:phone","Owner phone","battery",{entity_id:"sensor.owner_phone_battery",attributes:{kind:["battery"],entity:["registry:phone"],area:["kitchen"],label:["phones"]}});
    card.current.data.inventory.catalog.candidates.push(battery);card.current.data.inventory.nodes.push(battery);
    await go("policies");await click('[data-definition-action="edit"][data-definition-id="policy-1"]');
    await change('[data-definition-field="watch"]',"all_except");await click('[data-definition-action="pick"]');
    await change('[data-definition-picker-search]',"Batt");await change('[data-definition-field="selection"][data-definition-value="battery:phone"]',true);
    await change('[data-definition-picker-search]',"no result");check(root.textContent.includes("No batteries match your search."),"Empty search is explicit");
    await change('[data-definition-picker-search]',"");await change('[data-definition-picker-selected]',true);check(find('[data-definition-field="selection"]').checked,"Selected-only preserves exclusion");
    await click('[data-definition-action="finish-pick"]');await save();check(getSaved().monitoring_policies[0].excluded_sources.includes("battery:phone"),"Exclusion saves canonical source identity");
    for(const [mode,id] of [["selected","registry:phone"],["area","kitchen"],["label","phones"]]) {
      await change('[data-definition-field="watch"]',mode);await click('[data-definition-action="pick"]');await change(`[data-definition-field="selection"][data-definition-value="${id}"]`,true);await click('[data-definition-action="finish-pick"]');await save();
      const field={selected:"entity",area:"area",label:"label"}[mode];check(getSaved().monitoring_policies[0].match[field][0]===id,`${mode} saves its explicit selection`);
    }
    await change('[data-definition-field="watch"]',"all_except");
    const data=card.current.data,previous=structuredClone(data);data.schema_version=3;data.catalog_loaded=false;card.render();check(root.textContent.includes("Loading available sources"),"Unloaded catalog is not no matches");
    card.current.catalogError="Synthetic catalog read failed";card.render();check(root.textContent.includes("Could not load available sources"),"Catalog failure is explicit");
    let retried=false;card.store={ensureCatalog(force){if(force){retried=true;card.current={status:"current",data:previous};card.render();}return Promise.resolve();}};
    await click('[data-action="retry-catalog"]');check(retried&&!root.textContent.includes("Synthetic catalog read failed"),"Retry reloads available choices");card.store=null;
    await change('[data-definition-field="watch"]',"all");await save();check(!getSaved().monitoring_policies[0].excluded_sources&&Object.keys(getSaved().monitoring_policies[0].match).length===1,"All clears only this policy scope restrictions");
  });
  await runPath("policies.legacy",async()=>{
    const policy=getSaved().monitoring_policies.find(item=>item.id==="legacy"),before=JSON.stringify(policy.notifications[0]);
    await go("policies");await click('[data-definition-action="edit"][data-definition-id="legacy"]');check(root.textContent.includes("Custom notification"),"Published inline choice stays visible");
    await change('[data-definition-field="name"]',"Renamed custom policy");await save();check(JSON.stringify(getSaved().monitoring_policies.find(item=>item.id==="legacy").notifications[0])===before,"Unrelated save preserves inline data");
    await change('[data-row-field="profile"]',"urgent");await save();const row=getSaved().monitoring_policies.find(item=>item.id==="legacy").notifications[0];check(row.id==="custom-row"&&row.profile==="urgent"&&!row.timing&&!row.methods,"Explicit replacement preserves row identity");
  });
  await runPath("policies.ups",async()=>{
    const policy=getSaved().monitoring_policies.find(item=>item.check==="ups_reserve");await go("policies");await click(`[data-definition-action="edit"][data-definition-id="${policy.id}"]`);
    const original=policy.notifications[0].id;await change('[data-row-field="profile"]',"urgent");
    await change('.policy-notification-add select',"weekly");await save();
    const saved=getSaved().monitoring_policies.find(item=>item.id===policy.id);check(saved.notifications.some(row=>row.id===original&&row.when==="backup"&&row.profile==="urgent")&&saved.notifications.some(row=>row.when==="mains"&&row.profile==="weekly"),"Both UPS modes save without changing existing row identity");
  });
  const previous=card.current.data;
  await runPath("issues.filter",async()=>{
    const data=monitoringExample();data.inventory.episodes=Array.from({length:45},(_,index)=>({episode_id:`issue-${index}`,anchor:`device:camera-${index%26}`,opened_at:`2026-10-14T12:${String(index).padStart(2,"0")}:00Z`,status:"warn",importance:index===0?"high":"normal",recorded:[],impact:[],reasons:[{node_id:`device:camera-${index%26}`,check_id:"availability",status:"fail",reason:"unavailable",message:`Unavailable reading ${index}`}]}));
    card.current={status:"current",data};card.issueGroupsExpanded.clear();await go("problems");await click('[data-issue-group]');check(root.querySelectorAll('[data-episode]').length===40,"Initial group page is bounded");await click('[data-issue-more]');check(root.querySelectorAll('[data-episode]').length===45,"Show more reaches every issue");
    for(const sort of ["oldest","newest","name","importance"]) {await change('[data-issue-sort]',sort);check(card.issueSort===sort,`${sort} ordering selected`);}
    await change('[data-issue-search]',"Unavailable reading 44");check(root.querySelectorAll('[data-episode]').length===1,"Search reaches exact condition");
    await change('[data-issue-search]',"does-not-exist");check(root.textContent.includes("No matching issues"),"No match is explicit");await click('[data-action="clear-issue-search"]');check(card.issueQuery==="","Clear search restores queue");
  });
  await runPath("issues.empty",async()=>{
    card.current.data.inventory.episodes=[];card.render();check(root.textContent.includes("No open issues"),"Quiet monitoring is explicit");
    for(const node of card.current.data.inventory.nodes)node.watched=false;card.render();check(root.textContent.includes("Nothing is monitored"),"No monitoring has its own state");
    card.current={status:"loading",data:null};card.render();check(root.textContent.includes("Loading dashboard"),"Initial load does not claim quiet health");
    card.current={status:"unavailable",data:{available:false}};card.render();check(root.textContent.includes("Monitoring unavailable"),"Unavailable monitoring is explicit");
    card.current={status:"current",data:previous};card.render();
  });
  await settle();
}
