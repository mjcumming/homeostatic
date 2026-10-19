/** Real Home Assistant issue/source acceptance; setup uses only the disposable lab. */
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";

/** Sample the current exact action and focus atomically, not a resolved stale handle. */
export function captureIssueActionFocus({dialog,previous,id}) {
  const element=[...dialog.querySelectorAll("[data-shelf]")].find(item=>item.dataset.shelf===id);
  let focused=document.activeElement;
  while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;
  return {focused:Boolean(element?.isConnected&&element.getRootNode().activeElement===element&&focused===element),connected:Boolean(element?.isConnected),sameDOM:element===previous,previousConnected:previous.isConnected,target:element?.outerHTML,actual:focused?.outerHTML.slice(0,700)};
}

export async function runIssueGaps(ctx) {
  const {page,lab,call,run,at,bodyText,action,field,snapshot,click,fill,choose,check,clean,edit,save,discard,noChange,transport}=ctx;
  // Escape in a focused search input clears it natively; navigation must not do that.
  const go=async destination=>{await at(`.header [data-page="${destination}"]`).focus();await ctx.go(destination);};
  let clockActive=false;
  let availabilityBefore=new Map();
  const control=async(action,fields={})=>{const status=await call("homeostatic_ui_lab/control",{action,...fields});Object.assign(lab,status);if(action==="advance")clockActive=true;if(action==="reset")clockActive=false;return status;};
  const query=async service=>(await call("call_service",{domain:"homeostatic",service,service_data:{},return_response:true})).response;
  const inventory=()=>query("inventory");
  const controls=async()=>(await query("operator_controls")).controls;
  const close=async()=>{await page.keyboard.press("Escape");};
  const reset=async()=>{transport.interceptRequest=null;transport.transformResponse=null;transport.commandModes?.clear();await page.context().setOffline(false);await page.goto("about:blank");await control("reset");await clean();availabilityBefore=new Map();for(const node of (await inventory()).nodes)if(node.watched&&node.kind==="entity"&&node.check_id==="availability"&&node.monitoring_policy){const ids=availabilityBefore.get(node.monitoring_policy)||new Set();ids.add(node.monitoring_source||node.node_id);availabilityBefore.set(node.monitoring_policy,ids);}};
  const scenario=async(id,body)=>run(id,async()=>{await reset();try{return await body();}finally{transport.interceptRequest=null;transport.transformResponse=null;transport.commandModes?.clear();await page.context().setOffline(false);}});
  const text=async(selector,expression)=>at(selector).filter({hasText:expression}).first().waitFor({timeout:20000});
  const read=async selector=>(await at(selector).innerText()).trim();
  const fit=async selector=>assert.equal(await at(selector).first().evaluate(element=>{
    const box=element.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&element.scrollWidth<=element.clientWidth+1;
  }),true,`${selector} fits without horizontal scrolling`);
  const sourceId=async(key,kind="entity")=>{
    const data=await inventory(),rows=[...(data.catalog?.candidates||[]),...data.nodes];
    const row=rows.find(item=>item.kind===kind&&(kind==="device"?item.attributes?.device?.includes(lab.devices[key]):item.entity_id===lab.entities[key])&&!item.monitoring_policy);
    assert.ok(row,`Discovered ${kind} source for ${key}`);return row.node_id;
  };
  const source=async(key,kind="entity")=>{
    const id=await sourceId(key,kind);await go("sources");
    const back=at('[data-action="back-sources"]');if(await back.isVisible())await back.click();
    await choose('[data-sources-monitoring]',"all");await fill('[data-sources-search]',kind==="device"?"Lab":lab.entities[key]);
    await at(`[data-sources-select="source:${id}"]`).click();await at('#sources-detail-title').waitFor();return id;
  };
  const tree=async()=>{await go("sources");if(await at('[data-action="back-sources"]').isVisible())await click('[data-action="back-sources"]');};
  const expandIssues=async()=>{
    for(const button of await at('[data-issue-group]').all())if(await button.getAttribute("aria-expanded")==="false")await button.click();
    while(await at('[data-issue-more]').count())await at('[data-issue-more]').first().click();
  };
  // Existing exact-issue cases exercise the published notification/history route.
  // Queue device entry is covered separately by issues.device-entry below.
  const openIssue=async id=>{await close();await page.goto(`${lab.url}/homeostatic/episode/${encodeURIComponent(id)}`);await at(`dialog[open] [data-shelf="${id}"]`).waitFor();};
  const episodeFor=async(key,kind,policy)=>{
    const data=await inventory(),rows=new Map(data.nodes.map(row=>[row.node_id,row]));
    const episode=data.episodes.find(item=>{const node=rows.get(item.anchor);return node&&(!kind||node.kind===kind)&&(!policy||node.monitoring_policy===policy)&&(!key||(lab.entities[key]?node.entity_id===lab.entities[key]:node.attributes?.device?.includes(lab.devices[key])));});
    assert.ok(episode,`Open ${kind||""} issue for ${key||"any source"}`);return episode;
  };
  const details=async()=>{for(let pass=0;pass<3;pass++)for(const item of await at('dialog[open] details').all())if(await item.locator("summary").first().isVisible()&&!await item.evaluate(element=>element.open))await item.locator("summary").first().click();};
  const realState=async(key,state,attributes)=>{await control("set_state",{entity_id:lab.entities[key],state,...(attributes?{attributes}:{})});if(clockActive)await control("advance",{seconds:1});};
  const grouped=async(existing=false)=>{
    await control("integration_failure",{failed:false});if(!existing)await control("recover");const config=await call("homeostatic/configuration"),settings=structuredClone(config.settings);
    settings.timings.settle=3;settings.timings.retry_hold=0;
    await call("homeostatic/save_settings",{revision:config.revision,settings});await control("advance",{seconds:5});
    await control("integration_failure");await control("outage");await control("advance",{seconds:5});
    const data=await inventory(),issue=data.episodes.find(item=>item.recorded.length>1);assert.ok(issue,"A real grouped issue contains multiple recorded members");return issue;
  };
  const flatGroupedEvidence=async(issue,data,settings)=>{
    const nodes=new Map([...data.catalog.candidates,...data.nodes].map(node=>[node.node_id,node]));
    const canonical=id=>nodes.get(id)?.monitoring_source||id;
    if(issue.form==="root"&&nodes.get(issue.anchor)?.kind==="integration"){
      const expected=new Map();
      for(const id of issue.recorded){const check=nodes.get(id),source=nodes.get(canonical(id))||check;assert.ok(source);if(!expected.has(canonical(id)))expected.set(canonical(id),{source,names:new Set()});if(check.monitoring_policy){const policy=settings.monitoring_policies.find(item=>item.id===check.monitoring_policy);assert.ok(policy);expected.get(canonical(id)).names.add(policy.name);}}
      assert.ok(expected.size>1,"A failed integration retains its affected device and entity identities");
      for(const attribute of ["data-acknowledge","data-shelf"])assert.equal(await at(`dialog[open] [${attribute}]`).getAttribute(attribute),issue.episode_id);
      assert.equal(await at('dialog[open] [data-disclosure="issue-details"]').count(),0);
      const links=at('dialog[open] .issue-recorded [data-source-link]');assert.deepEqual((await links.evaluateAll(items=>items.map(item=>item.dataset.sourceLink))).sort(),[...expected.keys()].sort());
      for(const [id,item] of expected)assert.equal(await at(`dialog[open] .issue-recorded [data-source-link="${id}"]`).innerText(),item.source.name);
      return expected;
    }
    const findings=issue.reasons.filter(item=>item.node_id!==issue.anchor&&item.status!=="pass"),expected=new Map(),groups=new Map();
    for(const finding of findings){
      const check=nodes.get(finding.node_id),id=canonical(finding.node_id),source=nodes.get(id)||check;
      assert.ok(source,`Actual contributing source ${id} is known`);
      if(!expected.has(id))expected.set(id,{source,names:new Set()});
      if(check?.monitoring_policy){const policy=settings.monitoring_policies.find(item=>item.id===check.monitoring_policy);assert.ok(policy,`Contributing policy ${check.monitoring_policy} is saved`);expected.get(id).names.add(policy.name);}
      const deviceId=["device","entity"].includes(source.kind)?source.attributes?.device?.[0]:null;
      groups.set(deviceId?`device:${deviceId}`:id,deviceId);
    }
    assert.ok(expected.size>1,"The grouped issue exercises distinct affected sources");
    const rows=at('dialog[open] [data-evidence-source]'),ids=await rows.evaluateAll(items=>items.map(item=>item.dataset.evidenceSource));
    assert.deepEqual([...ids].sort(),[...expected].filter(([,item])=>item.source.kind!=="device").map(([id])=>id).sort(),"Visible affected rows contain each canonical entity exactly once; devices are their group headings");
    assert.deepEqual((await at('dialog[open] [data-evidence-group]').evaluateAll(items=>items.map(item=>item.dataset.evidenceGroup))).sort(),[...groups.keys()].sort(),"Affected groups preserve exact registry device ownership");
    for(const [id,item] of expected){
      if(item.source.kind==="device")continue;
      const row=at(`dialog[open] [data-evidence-source="${id}"]`);
      assert.equal(await row.isVisible(),true,`Affected ${item.source.name} is visible before Details`);
      assert.equal(await row.evaluate(element=>Boolean(element.closest("details"))),false);
      assert.equal(await row.locator('[data-source-link]').getAttribute("data-source-link"),id);
      assert.equal(await row.locator('[data-source-link]').innerText(),item.source.name,"Known entity names remain meaningful");
      assert.equal(await row.locator('.affected-reading > span').innerText(),"Unavailable in Home Assistant","The current entity condition is visible beside its name");
    }
    for(const [id,deviceId] of groups){
      if(!deviceId)continue;
      const group=at(`dialog[open] [data-evidence-group="${id}"]`),device=nodes.get(`device:${deviceId}`),link=group.locator('h4 a');
      assert.ok(device,"The affected device resolves through its registry identity");
      assert.equal(await link.isVisible(),true);assert.equal(await link.innerText(),device.name);
      assert.equal(await link.getAttribute("href"),`/config/devices/device/${encodeURIComponent(deviceId)}`);
      if(expected.has(id))assert.equal(await group.locator(':scope > p').innerText(),"All selected entities unavailable","Device evidence remains visible without duplicating an entity row");
    }
    assert.equal(await at('dialog[open] .issue-facts').isVisible(),true,"Opening time is visible before Details");
    for(const attribute of ["data-acknowledge","data-shelf"]){const action=at(`dialog[open] [${attribute}]`);assert.equal(await action.isVisible(),true);assert.equal(await action.getAttribute(attribute),issue.episode_id,"Issue controls retain the complete original episode scope");}
    assert.equal(await at('dialog[open] [data-issue-availability="remove"]').getAttribute("data-issue-id"),issue.episode_id);
    assert.equal(await at('dialog[open] [data-disclosure="issue-details"]').count(),0,"Supporting evidence has no Details expander");
    assert.equal(await at('dialog[open] .issue-checks').isVisible(),true);
    const checks=at('dialog[open] [data-check-source]'),checkIds=await checks.evaluateAll(items=>items.map(item=>item.dataset.checkSource));
    assert.deepEqual([...checkIds].sort(),[...expected.keys()].sort(),"Checks retain every canonical device and entity once");
    for(const [id,item] of expected){const row=at(`dialog[open] [data-check-source="${id}"]`);assert.equal(await row.isVisible(),true);assert.equal(await row.locator(':scope > span').innerText(),item.source.name);assert.deepEqual((await row.locator(':scope > p').innerText()).split(" · ").sort(),[...item.names].sort(),`Canonical ${id} retains every independent policy contribution`);}
    const scope=[...new Set([issue.anchor,...issue.recorded,...issue.reasons.map(finding=>finding.node_id)].map(canonical))].sort(),anchor=canonical(issue.anchor);
    const earlier=scope.filter(id=>id!==anchor&&!expected.has(id)),recordedIds=await at('dialog[open] .issue-recorded [data-source-link]').evaluateAll(items=>items.map(item=>item.dataset.sourceLink));
    assert.deepEqual([...recordedIds].sort(),earlier,"Other recorded sources retain precisely the earlier scope absent from current evidence");
    assert.equal(await at('dialog[open] .issue-recorded').count(),earlier.length?1:0,"Already visible evidence is not repeated as recorded sources");
    assert.deepEqual([anchor,...checkIds,...recordedIds].sort(),scope,"The flat view preserves the complete canonical issue membership");
    const monitoring=at(`dialog[open] [data-source-link="${anchor}"]`);assert.equal(await monitoring.count(),0,"Generic anchor Monitoring detour is absent");
    return expected;
  };
  const expectedExclusions=async(before,ids,remove=true)=>{
    const after=await snapshot(),wanted=new Set(ids),expected=structuredClone(before);
    for(const policy of expected.monitoring_policies)if(policy.check==="availability"&&policy.match?.kind?.some(kind=>["entity","device"].includes(kind))&&policy.enabled){
      const actual=after.monitoring_policies.find(item=>item.id===policy.id);
      const additions=(actual.excluded_sources||[]).filter(id=>!(policy.excluded_sources||[]).includes(id));
      const removals=(policy.excluded_sources||[]).filter(id=>!(actual.excluded_sources||[]).includes(id));
      assert.ok(additions.every(id=>wanted.has(id))&&removals.every(id=>wanted.has(id)),"Only selected canonical entities change exclusions");
      const intended=new Set(policy.excluded_sources||[]);for(const id of ids)if(remove?availabilityBefore.get(policy.id)?.has(id):intended.has(id))remove?intended.add(id):intended.delete(id);
      assert.deepEqual([...(actual.excluded_sources||[])].sort(),[...intended].sort(),`Every selected entity changes in applicable policy ${policy.id}`);
      if(Object.hasOwn(actual,"excluded_sources"))policy.excluded_sources=actual.excluded_sources;else delete policy.excluded_sources;
    }
    assert.deepEqual(after,expected,"Only applicable availability exclusions change");
    for(const id of ids)assert.equal(after.monitoring_policies.some(policy=>policy.check==="availability"&&(policy.excluded_sources||[]).includes(id)),remove,`Selected exclusion ${id}`);
    return after;
  };
  const rejectSave=()=>{let count=0;transport.interceptRequest=(request,route)=>{
    if(request.type!=="homeostatic/save_settings")return false;
    count++;route.send(JSON.stringify({id:request.id,type:"result",success:false,error:{code:"acceptance_rejection",message:"Gap save rejected"}}));return true;
  };return()=>count;};
  const submit=()=>at('dialog[open] button[type="submit"]').click();
  const cancelTool=()=>at('dialog[open] [data-tool="close"]').click();
  const endTime=()=>new Date(Date.now()+3_600_000).toISOString().slice(0,16);
  const pause=async(episode,reason="Acceptance exact pause")=>{
    await openIssue(episode.episode_id);await click('[data-shelf]');const until=endTime();
    await fill('dialog[open] [name="untilLocal"]',until);
    const option=at('dialog[open] details').filter({has:page.locator('[name="reason"]')});
    if(await option.count()&&!await option.evaluate(element=>element.open))await option.locator("summary").click();
    if(await at('dialog[open] [name="reason"]').isVisible())await fill('dialog[open] [name="reason"]',reason);
    await submit();await text('dialog[open]',/Saved by Home Assistant/);
    const saved=(await controls()).find(item=>item.action==="shelve"&&item.target===episode.episode_id);assert.ok(saved);
    assert.equal(Date.parse(saved.until),Date.parse(until));assert.equal(saved.reason,reason);return saved;
  };

  await scenario("issues.not-provided",async()=>{
    const configuration=await call("homeostatic/configuration"),settings=structuredClone(configuration.settings),policy=settings.monitoring_policies.find(item=>item.check==="entity_not_provided");assert.ok(policy);policy.parameters.duration_seconds=60;
    await call("homeostatic/save_settings",{revision:configuration.revision,settings});await clean();const before=await snapshot();
    await realState("diagnostic","unavailable",{friendly_name:"Lab diagnostic reading",restored:true});await control("advance",{seconds:59});
    const matching=data=>data.episodes.filter(issue=>data.nodes.some(node=>node.node_id===issue.anchor&&node.kind==="entity_not_provided"&&node.entity_id===lab.entities.diagnostic));
    assert.equal(matching(await inventory()).length,0,"Restored entity does not qualify before the saved duration");await control("advance",{seconds:1});const issue=await episodeFor("diagnostic","entity_not_provided");
    assert.equal(issue.status,"warn");assert.equal(issue.importance,"normal");
    const mutations=[];transport.interceptRequest=request=>{if(request.type==="call_service"||/config\/entity_registry\/(update|remove)$/.test(request.type))mutations.push(request);return false;};
    await go("problems");await fill('[data-issue-search]',"Lab diagnostic reading");await expandIssues();await click(`[data-episode="${issue.episode_id}"]`);await at(`dialog[open] [data-shelf="${issue.episode_id}"]`).waitFor();await text('dialog[open]',/Entity not provided/);await text('dialog[open]',/loaded.*not providing/i);
    assert.equal(await at('dialog[open] [data-entity]').getAttribute("data-entity"),lab.entities.diagnostic);assert.equal(await at('[data-delete-entity],[data-cleanup-entity]').count(),0);
    await click('dialog[open] [data-entity]');await page.locator('ha-more-info-dialog').getByRole("dialog").waitFor({state:"visible"});await page.keyboard.press("Escape");await page.locator('ha-more-info-dialog').getByRole("dialog").waitFor({state:"hidden"});await openIssue(issue.episode_id);assert.equal(await at('dialog[open] [data-entity]').getAttribute("data-entity"),lab.entities.diagnostic);assert.deepEqual(mutations,[]);transport.interceptRequest=null;await noChange(before);
    await realState("diagnostic","unknown",{friendly_name:"Lab diagnostic reading"});assert.equal(matching(await inventory()).length,0,"A live unknown reading establishes that the entity is provided");
    return "Real loaded-owner restored evidence qualifies at the saved 60-second boundary; normal warning names the exact diagnostic entity. Search and rendered Open Entity reach native Home Assistant, returning preserves identity, inspection sends no service/registry mutation, and live unknown ends the provider warning.";
  });

  await scenario("sources.current-issue-badges",async()=>{
    const before=await snapshot(),original=[await episodeFor("offline","entity"),await episodeFor("offline_second","entity")].map(issue=>issue.episode_id);
    const badge=async(key,kind="entity",expected=true)=>{const id=await sourceId(key,kind);await tree();await fill('[data-sources-search]',kind==="device"?"Lab offline device":lab.entities[key]);const row=at(`[data-sources-select="source:${id}"]`);await row.waitFor();if(expected)await row.locator('.source-issue-count').waitFor();else await row.locator('.source-issue-count').waitFor({state:"hidden"});};
    await badge("offline");await badge("offline","device");await badge("unmonitored","entity",false);
    for(const key of ["offline","offline_second"])await realState(key,"unavailable",{friendly_name:key==="offline"?"Lab offline sensor":"Lab secondary reading",restored:true});
    const restored=await inventory();await writeFile(`${ctx.artifactDir}/restored-badge-evidence.json`,JSON.stringify({inventory:restored,sources:await Promise.all(["offline","offline_second"].map(async key=>call("homeostatic/source",{node_id:await sourceId(key)})))},null,2));
    await badge("offline","entity",false);await badge("offline_second","entity",false);await badge("offline","device",false);
    const retained=await inventory();for(const id of original)assert.ok(retained.episodes.some(issue=>issue.episode_id===id),"Missing current availability evidence retains the earlier issue without asserting recovery");
    await control("remove_state",{entity_id:lab.entities.offline});await badge("offline","entity",false);await realState("unmonitored","unavailable");await badge("unmonitored","entity",false);
    await realState("offline","unavailable",{friendly_name:"Lab offline sensor"});await badge("offline");await badge("offline","device");
    await control("integration_failure");await tree();await fill('[data-sources-search]',"");await at(`[data-sources-select="source:entry:${lab.fixture_entry_id}"] .source-issue-count`).waitFor();await noChange(before);
    return "Current unavailable entity and its device group have badges; restored/absent readings retain prior issue identities without badges, an unmonitored unavailable source remains neutral, and a real integration failure retains its error badge. Settings stay unchanged.";
  });

  await scenario("issues.notification-membership",async()=>{
    const screenshot=async name=>{await page.locator('#ha-launch-screen').waitFor({state:"hidden"});await page.screenshot({path:`${ctx.artifactDir}/${name}.png`});};
    const config=await call("homeostatic/configuration"),settings=structuredClone(config.settings),original=settings.monitoring_policies.find(policy=>policy.id==="default_entities");
    settings.monitoring_policies.push({...structuredClone(original),id:"acceptance_overlap",name:"Other issue on included device",match:{kind:["entity"],entity:[`registry:${lab.registry_ids.offline}`]},excluded_sources:[],notifications:[]});
    await call("homeostatic/save_settings",{revision:config.revision,settings});await clean();
    const before=await snapshot(),policyBefore=await query("policy");
    const first=await episodeFor("offline","entity","default_entities"),second=await episodeFor("offline_second","entity","default_entities"),other=await episodeFor("offline","entity","acceptance_overlap");
    const ids=[first.episode_id,second.episode_id],path=`/homeostatic/issues/notification/${ids.map(encodeURIComponent).join(",")}`,url=`${lab.url}${path}`;
    const shown=async()=>{await expandIssues();return [...new Set(await at('main [data-episode]').evaluateAll(items=>items.map(item=>item.dataset.episode)))].sort();};
    await page.goto(url);await text('main h1',/^Issues in this notification$/);
    assert.deepEqual(await shown(),[...ids].sort());assert.equal(await at('main [data-device-issues]').count(),0,"A notification cannot widen to other issues on the same device");
    assert.ok(!ids.includes(other.episode_id),"Another independent policy issue already exists on the included device");
    await fit('.intro');await screenshot("notification-membership");
    const openFirst=async()=>{await at(`[data-episode="${first.episode_id}"]`).focus();await page.keyboard.press("Enter");await at(`dialog[open] [data-acknowledge="${first.episode_id}"]`).waitFor();};
    await openFirst();assert.equal(new URL(page.url()).pathname,`${path}/episode/${encodeURIComponent(first.episode_id)}`);
    assert.equal(await at('dialog[open] [data-device-issue-select]').count(),0);
    await page.reload();await at(`dialog[open] [data-acknowledge="${first.episode_id}"]`).waitFor();
    await page.keyboard.press("Escape");await at('dialog[open]').waitFor({state:"hidden"});assert.equal(new URL(page.url()).pathname,path);assert.deepEqual(await shown(),[...ids].sort());
    await go("sources");await page.goBack();await text('main h1',/^Issues in this notification$/);assert.deepEqual(await shown(),[...ids].sort());
    await page.reload();await text('main h1',/^Issues in this notification$/);assert.deepEqual(await shown(),[...ids].sort());
    await realState("history","unavailable");await control("advance",{seconds:1});const later=await episodeFor("history","entity");assert.ok(!ids.includes(later.episode_id));
    await page.reload();await text('main h1',/^Issues in this notification$/);assert.deepEqual(await shown(),[...ids].sort(),"A later issue stays outside the message membership after reload");
    await openFirst();await click('[data-acknowledge]');await submit();await text('dialog[open]',/Awareness recorded/);
    const acknowledged=await query("policy");assert.ok(acknowledged.episodes.find(item=>item.episode_id===first.episode_id)?.acknowledgment);
    for(const issue of acknowledged.episodes.filter(item=>item.episode_id!==first.episode_id))assert.deepEqual(issue.acknowledgment,policyBefore.episodes.find(item=>item.episode_id===issue.episode_id)?.acknowledgment??null,"Other included, unrelated and later issues retain their acknowledgment");
    await cancelTool();await page.goto(url);await text('main h1',/^Issues in this notification$/);await shown();
    await at(`[data-episode="${first.episode_id}"]`).click();await at(`dialog[open] [data-shelf="${first.episode_id}"]`).waitFor();
    await realState("offline","23");await control("advance",{seconds:1});await text('dialog[open]',/This included issue is no longer open/);
    assert.equal(new URL(page.url()).pathname,`${path}/episode/${encodeURIComponent(first.episode_id)}`);assert.equal(await at('main h1').innerText(),"Issues in this notification","Recovery in an open dialog cannot silently navigate to the full history page");
    await page.reload();await text('dialog[open]',/This included issue is no longer open/);
    await click('dialog[open] [data-action="close"]');await text('[data-notification-scope]',/1 included issue is no longer open/);assert.deepEqual(await shown(),[second.episode_id]);
    await screenshot("notification-membership-partial");
    await realState("offline_second","23");await control("advance",{seconds:1});await page.reload();await text('main',/No included issues are still open/);
    assert.deepEqual(await shown(),[]);assert.equal(new URL(page.url()).pathname,path);await fit('.intro');await screenshot("notification-membership-ended");
    const all=at('[data-all-issues]');assert.equal(await all.getAttribute("href"),"/homeostatic/issues");assert.ok((await all.boundingBox()).height>=44);
    await all.focus();await page.keyboard.press("Enter");await text('main h1',/^Open issues$/);assert.equal(new URL(page.url()).pathname,"/homeostatic/issues");assert.ok((await shown()).includes(later.episode_id));
    await page.goBack();await text('main',/No included issues are still open/);assert.equal(new URL(page.url()).pathname,path);
    await noChange(before);assert.deepEqual(await controls(),[]);
    return "Exact included IDs survive direct entry, issue dialog refresh, close, browser Back and page reload. Same-device, unrelated and later issues stay excluded; acknowledgment affects only the chosen included issue. Partial and full recovery explain ended membership, and keyboard navigation to all issues preserves settings and fits this viewport.";
  });
  await scenario("issues.independent-devices",async()=>{
    await control("integration_failure",{failed:false});await control("recover");
    for(const key of ["offline","offline_second","battery","cleaner"])await realState(key,"unavailable");
    await control("advance",{seconds:1});await clean();
    const selected=await episodeFor("offline","entity"),others=[await episodeFor("battery","entity"),await episodeFor("cleaner","entity")];
    assert.equal(new Set([selected,...others].map(item=>item.episode_id)).size,3,"Healthy integration leaves entity issues on three devices independent");
    const data=await inventory(),nodes=new Map(data.nodes.map(item=>[item.node_id,item]));
    await openIssue(selected.episode_id);
    const content=await at('dialog[open]').innerText();
    for(const other of others)assert.equal(content.includes(nodes.get(other.anchor).name),false,"Selected issue omits unrelated devices");
    assert.equal(await at('dialog[open] [data-acknowledge]').getAttribute("data-acknowledge"),selected.episode_id);
    await click('[data-acknowledge]');await submit();await text('dialog[open]',/Awareness recorded/);
    const policy=await query("policy");
    assert.ok(policy.episodes.find(item=>item.episode_id===selected.episode_id).acknowledgment);
    for(const other of others)assert.equal(Boolean(policy.episodes.find(item=>item.episode_id===other.episode_id).acknowledgment),false);
    await pause(selected,"Selected device only");
    assert.deepEqual((await controls()).filter(item=>item.action==="shelve").map(item=>item.target),[selected.episode_id]);
    await page.reload();await at('[data-issue-search]').waitFor();await openIssue(others[0].episode_id);
    assert.equal(await at('dialog[open] [data-shelf]').getAttribute("data-shelf"),others[0].episode_id);
    await fit('dialog[open]');
    return "Real healthy integration: independent unavailable entities on three devices; selected detail excludes unrelated devices; acknowledge and pause affect only that entity issue, with another issue still independently actionable after refresh.";
  });
  await scenario("issues.device-availability-selection",async()=>{
    const before=await snapshot(),first=await episodeFor("offline","entity"),second=await episodeFor("offline_second","entity");
    const expected=[first,second].map(issue=>issue.episode_id).sort(),policyBefore=await query("policy");
    assert.equal(new Set(expected).size,2,"The device groups its two independent entity issues without an aggregate verdict");
    const deviceSource=await source("offline","device");
    await text('.source-device-summary',/0 of 2 entities available/);
    assert.equal(await at('.config-detail [data-device-issues]').count(),1,"Monitoring has one combined availability View");
    assert.equal(await at('.source-device-members [data-episode],.source-device-members [data-device-issues]').count(),0,"Entity rows have no issue popups");
    const links=await at('.source-device-members a').evaluateAll(items=>items.map(item=>({name:item.textContent.trim(),href:item.getAttribute("href")})));
    for(const [key,name] of [["offline","Lab offline sensor"],["offline_second","Lab secondary reading"]])assert.ok(links.some(link=>link.name===name&&link.href.includes(encodeURIComponent(lab.entities[key]))&&link.href.startsWith("/developer-tools/state?")),"Each actual entity name links directly to Home Assistant");
    await click('[data-device-issues]');await at('dialog[open] [data-device-issues-all]').waitFor();await text('dialog[open] .problem-brief',/0 of 2 monitored entities available/);
    const choices=()=>at('dialog[open] [data-device-issue-select]');
    assert.deepEqual((await choices().evaluateAll(items=>items.map(item=>item.dataset.deviceIssueSelect))).sort(),expected,"The combined view includes exactly this device's availability issues");
    assert.equal(await choices().evaluateAll(items=>items.every(item=>item.checked)),true,"All current issues initially selected");
    await check('dialog[open] [data-device-issues-all]',false);
    assert.equal(await at('dialog[open] [data-device-response="acknowledge"]').isDisabled(),true);
    assert.equal(await at('dialog[open] [data-device-response="pause"]').isDisabled(),true);
    await check(`dialog[open] [data-device-issue-select="${second.episode_id}"]`,true);
    assert.equal(await at('dialog[open] [data-device-issues-all]').evaluate(element=>element.indeterminate),true,"The master exposes partial selection");
    await click('dialog[open] [data-device-response="pause"]');await choose('dialog[open] [data-device-pause-duration]',"4");await click('dialog[open] [data-device-response="cancel-pause"]');
    assert.deepEqual(await controls(),[],"Canceling the pause saves no control");await noChange(before);
    const attempted=[];transport.interceptRequest=(request,route)=>{if(request.type!=="call_service"||request.domain!=="homeostatic"||request.service!=="acknowledge")return false;attempted.push(request.service_data.episode_id);if(request.service_data.episode_id!==second.episode_id)return false;route.send(JSON.stringify({id:request.id,type:"result",success:false,error:{code:"acceptance_rejection",message:"Selected issue rejected"}}));return true;};
    await check('dialog[open] [data-device-issues-all]',true);await click('dialog[open] [data-device-response="acknowledge"]');await text('dialog[open]',/1 issue acknowledged\. 1 not confirmed/);assert.deepEqual([...attempted].sort(),expected);const partialPolicy=await query("policy");assert.ok(partialPolicy.episodes.find(issue=>issue.episode_id===first.episode_id)?.acknowledgment);assert.equal(Boolean(partialPolicy.episodes.find(issue=>issue.episode_id===second.episode_id)?.acknowledgment),false);await realState("history","15");assert.equal(attempted.length,2,"A partial failure does not automatically retry");transport.interceptRequest=null;
    await check('dialog[open] [data-device-issues-all]',false);await check(`dialog[open] [data-device-issue-select="${second.episode_id}"]`,true);await click('dialog[open] [data-device-response="acknowledge"]');await text('dialog[open]',/1 issue acknowledged\./);
    const acknowledged=await query("policy");
    for(const id of expected)assert.ok(acknowledged.episodes.find(issue=>issue.episode_id===id)?.acknowledgment,"Every selected issue is acknowledged in real HA");
    for(const issue of policyBefore.episodes.filter(issue=>!expected.includes(issue.episode_id)))assert.deepEqual(acknowledged.episodes.find(current=>current.episode_id===issue.episode_id)?.acknowledgment,issue.acknowledgment,"Unrelated issue acknowledgment is unchanged");
    await check('dialog[open] [data-device-issues-all]',false);await check(`dialog[open] [data-device-issue-select="${second.episode_id}"]`,true);
    await click('dialog[open] [data-device-response="pause"]');await choose('dialog[open] [data-device-pause-duration]',"1");
    const pauseStarted=Date.now();await click('dialog[open] [data-device-response="apply-pause"]');await text('dialog[open]',/1 issue paused\./);
    const saved=(await controls()).filter(control=>control.action==="shelve");
    assert.deepEqual(saved.map(control=>control.target),[second.episode_id],"The subset pause affects only the selected entity issue");
    assert.ok(Date.parse(saved[0].until)>=pauseStarted+3_600_000-1000&&Date.parse(saved[0].until)<=Date.now()+3_600_000+1000,"The saved pause uses the selected one-hour duration");
    assert.equal(await at(`dialog[open] [data-device-issue-select="${second.episode_id}"]`).isChecked(),true,"Response preserves the individual exception selection");
    await fit('dialog[open]');await page.screenshot({path:`${ctx.artifactDir}/device-availability-selection.png`});await noChange(before);
    await close();await at('#sources-detail-title').waitFor();assert.equal(await at(`[data-sources-select="source:${deviceSource}"]`).getAttribute("aria-current"),"true","Closing restores the originating device");
    await realState("offline","23");await control("advance",{seconds:1});
    const recovered=await inventory();assert.equal(recovered.episodes.some(issue=>issue.episode_id===first.episode_id),false,"A current sibling clears only its own issue");
    assert.ok(recovered.episodes.some(issue=>issue.episode_id===second.episode_id),"The unavailable sibling retains its original issue");
    await source("offline","device");await text('.source-device-summary',/1 of 2 entities available/);const sourceUrl=page.url();
    assert.equal(await at('.config-detail [data-device-issues]').count(),1,"View remains available without an aggregate device issue");
    await click('[data-device-issues]');await at('dialog[open] [data-device-response="pause"]').waitFor();await text('dialog[open] .problem-brief',/1 of 2 monitored entities available/);
    assert.equal(await choices().count(),0);assert.equal(await at('dialog[open] [data-device-issues-all]').count(),0,"One remaining issue needs no selection controls");
    await text('dialog[open] .device-issues h3',/^Lab secondary reading$/);await text('dialog[open] .device-issues',/Sensor unavailable|Entity unavailable/);
    assert.equal(await at('dialog[open] [data-device-response="acknowledge"]').isDisabled(),true,"The remaining issue retains its acknowledgment");
    await click('dialog[open] [data-device-response="pause"]');await choose('dialog[open] [data-device-pause-duration]',"4");
    const extensionStarted=Date.now();await click('dialog[open] [data-device-response="apply-pause"]');await text('dialog[open]',/1 issue paused\./);
    const extended=(await controls()).filter(control=>control.action==="shelve");assert.deepEqual([...new Set(extended.map(control=>control.target))],[second.episode_id],"Direct response still targets only the remaining entity issue");
    assert.ok(extended.some(control=>Date.parse(control.until)>=extensionStarted+14_400_000-1000&&Date.parse(control.until)<=Date.now()+14_400_000+1000),"The direct action extends the same issue's pause to four hours");
    await fit('dialog[open]');await page.screenshot({path:`${ctx.artifactDir}/device-availability-single.png`});await noChange(before);
    const remainingEntity=await sourceId("offline_second");await click('dialog[open] [data-issue-availability="remove"]');await at('dialog[open] [data-issue-availability="confirm"]').waitFor();
    assert.equal(await at('dialog[open] .source-availability-confirm details').count(),0,"Coverage confirmation exposes its entity scope directly");await text('dialog[open] .source-availability-confirm',/Lab secondary reading/);await fit('dialog[open]');await page.screenshot({path:`${ctx.artifactDir}/device-stop-monitoring.png`});await click('dialog[open] [data-issue-availability="cancel"]');await noChange(before);
    await click('dialog[open] [data-issue-availability="remove"]');await click('dialog[open] [data-issue-availability="confirm"]');await at('dialog[open]').waitFor({state:"hidden"});
    await expectedExclusions(before,[remainingEntity]);await at('#sources-detail-title').waitFor();
    assert.equal(page.url(),sourceUrl,"A saved coverage change returns to the originating device route");
    assert.equal(await at(`[data-sources-select="source:${deviceSource}"]`).getAttribute("aria-current"),"true","The original device selection survives Stop Monitoring");
    assert.equal(await at('[data-workspace-return]').filter({hasText:/Back to issue/}).count(),0,"Completed coverage leaves no stale Back to issue route");
    await reset();const pendingBefore=await snapshot(),oldSecond=await episodeFor("offline_second","entity");await source("offline","device");await click('[data-device-issues]');await at('dialog[open] [data-device-response="acknowledge"]').waitFor();
    let firstRequest,responseRoute,heldResponse;const held=new Promise(resolve=>{transport.interceptRequest=(request,route)=>{if(!firstRequest&&request.type==="call_service"&&request.domain==="homeostatic"&&request.service==="acknowledge"){firstRequest=request;responseRoute=route;}return false;};transport.transformResponse=(result,request)=>{if(request===firstRequest&&result.type==="result"){heldResponse=result;resolve();return null;}return result;};});await click('dialog[open] [data-device-response="acknowledge"]');await held;assert.notEqual(firstRequest.service_data.episode_id,oldSecond.episode_id,"The first displayed entity response is held before the second request, while live refreshes continue");
    await realState("offline_second","12");await realState("offline_second","unavailable");const later=await episodeFor("offline_second","entity");assert.notEqual(later.episode_id,oldSecond.episode_id);await at(`dialog[open] [data-device-issue-select="${later.episode_id}"]`).waitFor();assert.equal(await at(`dialog[open] [data-device-issue-select="${later.episode_id}"]`).isChecked(),false,"A new issue never inherits the old selection");
    const pendingRequests=[];transport.interceptRequest=request=>{if(request.type==="call_service"&&request.domain==="homeostatic"&&request.service==="acknowledge")pendingRequests.push(request.service_data.episode_id);return false;};transport.transformResponse=null;responseRoute.send(JSON.stringify(heldResponse));await text('dialog[open]',/1 issue acknowledged\. 1 not confirmed/);assert.deepEqual(pendingRequests,[],"Ended and later issue IDs receive no queued acknowledgment request");const pendingPolicy=await query("policy");assert.ok(pendingPolicy.episodes.find(issue=>issue.episode_id===firstRequest.service_data.episode_id)?.acknowledgment);assert.equal(Boolean(pendingPolicy.episodes.find(issue=>issue.episode_id===later.episode_id)?.acknowledgment),false);await noChange(pendingBefore);assert.deepEqual(await controls(),[]);
    return "Real Home Assistant device grouping of two independent entity availability issues: one Monitoring View, native entity links, all/subset/zero selection, pause cancellation, partial acknowledgment failure without automatic retry and one-entity pause with unchanged unrelated acknowledgments/settings. After partial recovery, View remains and one named entity has direct controls without checkboxes; extending its pause preserves the exact issue identity. Separate Stop Monitoring cancellation saves nothing; confirmation excludes only that entity in the applicable availability policies and restores the originating device route without stale issue navigation. While the first acknowledgment response is delayed, an ended selected issue is skipped and its new replacement remains unselected and unacknowledged. Screenshots record combined and single-issue layouts.";
  });
  await scenario("issues.device-entry",async()=>{
    const before=await snapshot(),first=await episodeFor("offline","entity"),second=await episodeFor("offline_second","entity");
    const expected=[first,second].map(issue=>issue.episode_id).sort();
    let queueUrl;
    const openDevice=async(key,search="")=>{
      await go("problems");await fill('[data-issue-search]',search);await expandIssues();
      const group=at(`[data-issue-device="${lab.devices[key]}"]`),button=group.locator('[data-device-issues]');
      assert.equal(await button.count(),1,"One device action owns its issue workflow");
      assert.equal(await group.locator('[data-episode]').count(),0,"Owned findings do not repeat individual dialog buttons");
      queueUrl=page.url();await button.click();await at('dialog[open] .device-issues').waitFor();
      assert.equal(await at('dialog[open] #detail-label').innerText(),"Device");
      assert.equal(await at(`dialog[open] a[href="/config/devices/device/${lab.devices[key]}"]`).count(),1,"One native Open device action");
    };
    const choices=()=>at('dialog[open] [data-device-issue-select]');
    const currentIds=()=>choices().evaluateAll(items=>items.map(item=>item.dataset.deviceIssueSelect).sort());
    await openDevice("offline","Lab offline device");
    assert.deepEqual(await currentIds(),expected);assert.equal(await choices().evaluateAll(items=>items.every(item=>item.checked)),true);
    assert.equal(await at('dialog[open] .issue-facts').count(),0,"Combined context omits ambiguous opening chronology");
    assert.equal(await at('dialog[open] .problem-brief a.primary').count(),0,"Native navigation has secondary emphasis");
    const sizes=await at('dialog[open] [data-device-response]').evaluateAll(items=>items.map(item=>({width:item.getBoundingClientRect().width,height:item.getBoundingClientRect().height})));
    assert.ok(Math.abs(sizes[0].width-sizes[1].width)<=1&&Math.abs(sizes[0].height-sizes[1].height)<=1,"Acknowledge and pause share dimensions");
    for(const section of [".issue-policy-links",".issue-notification-links"]){
      const geometry=await at(`dialog[open] ${section}`).evaluate(element=>({label:element.querySelector('h3').getBoundingClientRect().top,actions:element.querySelector('.actions').getBoundingClientRect().top}));
      assert.ok(Math.abs(geometry.label-geometry.actions)<25,"Configuration labels and editor controls share a compact row when space permits");
    }
    await fit('dialog[open]');await page.screenshot({path:`${ctx.artifactDir}/device-entry-all.png`});
    await close();await at('dialog[open]').waitFor({state:"hidden"});await at('[data-issue-search]').waitFor();assert.equal(page.url(),queueUrl,"Close returns to the originating queue");
    assert.equal(await at('[data-issue-search]').inputValue(),"Lab offline device","Close preserves the originating search");
    assert.equal(await at(`[data-issue-device="${lab.devices.offline}"] [data-device-issues]`).evaluate(element=>element.getRootNode().activeElement===element),true,"Close restores focus to the device View");
    await openDevice("offline");await page.goBack();await at('dialog[open]').waitFor({state:"hidden"});await at('[data-issue-search]').waitFor();
    assert.equal(await at(`[data-issue-device="${lab.devices.offline}"]`).isVisible(),true,"Browser Back restores the expanded device group");
    await realState("offline","23");await control("advance",{seconds:1});
    const partial=await inventory();assert.equal(partial.episodes.some(issue=>issue.episode_id===first.episode_id),false);assert.ok(partial.episodes.some(issue=>issue.episode_id===second.episode_id));
    await openDevice("offline");await text('dialog[open] .problem-brief',/1 of 2 monitored entities available/);
    assert.equal(await choices().count(),0);assert.equal(await at('dialog[open] [data-device-issues-all]').count(),0,"An entity-only device problem has direct controls");
    await text('dialog[open] .device-issues',/Lab secondary reading/);await close();
    const deviceSource=await source("offline","device"),sourceUrl=page.url();await click('[data-device-issues]');
    await text('dialog[open] .device-issues',/Lab secondary reading/);await close();assert.equal(page.url(),sourceUrl,"Monitoring returns to its source route");
    assert.equal(await at(`[data-sources-select="source:${deviceSource}"]`).getAttribute('aria-current'),"true");
    await control("remove_state",{entity_id:lab.entities.offline});await control("advance",{seconds:1});
    await openDevice("offline");await text('dialog[open] .problem-brief',/0 of 2 monitored entities available/);
    await text('dialog[open] .device-issues',/Lab secondary reading/);await close();
    const battery=await episodeFor("battery","battery");await openDevice("battery");await text('dialog[open] .device-issues',/battery/i);
    assert.equal(await choices().count(),0,"A single battery condition needs no selection controls");
    await click('dialog[open] [data-device-response="acknowledge"]');await text('dialog[open]',/1 issue acknowledged\./);
    const policy=await query("policy");assert.ok(policy.episodes.find(issue=>issue.episode_id===battery.episode_id)?.acknowledgment);
    assert.equal(Boolean(policy.episodes.find(issue=>issue.episode_id===second.episode_id)?.acknowledgment),false,"Another device remains untouched");
    await close();await realState("history","unavailable");await control("advance",{seconds:1});
    const standalone=await episodeFor("history","entity");await go("problems");await fill('[data-issue-search]',"");await expandIssues();await click(`[data-episode="${standalone.episode_id}"]`);
    await at(`dialog[open] [data-acknowledge="${standalone.episode_id}"]`).waitFor();assert.equal(await choices().count(),0,"Unattached entity retains exact singular controls");await close();
    await openIssue(second.episode_id);assert.equal(await at('dialog[open] [data-shelf]').getAttribute('data-shelf'),second.episode_id,"An exact notification link retains its original issue scope");
    assert.equal(await at('dialog[open] .device-issues').count(),0);await close();
    await openDevice("offline");
    await at('dialog[open]').evaluate(dialog=>{const values=[...dialog.querySelectorAll('label,button,input,select,p,h1,h2,h3,a,span')].map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]);for(const [node,size] of values)node.style.fontSize=`${size*2}px`;});
    const readableActions=await at('dialog[open] .device-issue-actions button').evaluateAll(buttons=>buttons.every(button=>{
      const style=getComputedStyle(button),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.font;
      const longest=Math.max(...button.textContent.trim().split(/\s+/).map(word=>context.measureText(word).width));
      return button.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+1>=longest;
    }));
    assert.equal(readableActions,true,"Enlarged response buttons fit whole words, wrapping the pair when necessary");
    await fit('dialog[open]');await page.screenshot({path:`${ctx.artifactDir}/device-entry-enlarged.png`});
    await close();await noChange(before);
    return "Pointer and keyboard paths verify one queue View opens the same device dialog as Monitoring, even after partial recovery and missing evidence; one remaining entity and a battery condition have direct controls. Acknowledging the battery affects only its exact issue. Unattached entity and exact notification URL stay singular. Close and browser Back restore their origins. Shared controls have matching dimensions, outlined native navigation, compact configuration rows, no combined opening date and no horizontal overflow at ordinary and doubled text. Saved configuration remains unchanged.";
  });
  await scenario("issues.device-hierarchy",async()=>{
    const before=await snapshot();await control("bulk");await clean();await go("problems");
    assert.ok(await at('[data-issue-group]').count());await expandIssues();
    const devices=await at('[data-issue-device]').evaluateAll(items=>items.map(item=>item.dataset.issueDevice));assert.equal(new Set(devices).size,devices.length);
    for(const device of await at('[data-issue-device]').all())assert.equal(await device.locator('.issue-device-title').count(),1);
    const ids=await at('[data-episode]').evaluateAll(items=>items.map(item=>item.dataset.episode));assert.ok(ids.length>40,"Pagination exposes more than40 issues");assert.equal(new Set(ids).size,ids.length);
    const first=at('[data-episode]').first(),id=await first.getAttribute("data-episode");await first.focus();await page.keyboard.press("Enter");await at('dialog[open]').waitFor();
    assert.equal(await at('dialog[open] [data-shelf]').getAttribute("data-shelf"),id);await close();
    await fill('[data-issue-search]',lab.entities.bulk_59);assert.ok(await at('[data-episode]').count());await choose('[data-issue-sort]',"name");
    await page.reload();await at('[data-issue-search]').waitFor();await noChange(before);
    return "Real registry device headings, standalone issues, complete Show more, keyboard issue opening, search/sort/refresh and unchanged saved settings.";
  });
  await scenario("issues.filter",async()=>{
    await page.goto("about:blank");await control("importance_cases");
    await control("bulk");await clean();const before=await snapshot();await go("problems");
    const modes=await at('[data-issue-sort] option').evaluateAll(items=>items.map(item=>item.value));let all;
    for(const mode of modes){await choose('[data-issue-sort]',mode);await expandIssues();const ids=await at('[data-episode]').evaluateAll(items=>items.map(item=>item.dataset.episode));assert.ok(ids.length>40);if(all)assert.deepEqual([...ids].sort(),all);else all=[...ids].sort();}
    const data=await inventory(),nodes=new Map(data.nodes.map(node=>[node.node_id,node])),byId=new Map(data.episodes.map(item=>[item.episode_id,item]));for(const importance of ["high","critical"]){const expected=data.episodes.find(item=>item.importance===importance&&nodes.get(item.anchor)?.name===`Lab ${importance} importance`);assert.ok(expected,`Actual ${importance} situation exists`);assert.ok(all.includes(expected.episode_id),`Rendered results include the configured ${importance} situation`);}
    await choose('[data-issue-sort]',"importance");await expandIssues();const rank={critical:3,high:2,normal:1,low:0};assert.ok(data.episodes.some(item=>item.importance==="critical")&&data.episodes.some(item=>item.importance==="high"));const groups=await at('.issue-group').evaluateAll(items=>items.map(group=>[...group.querySelector('.issue-group-body').children].map(subject=>[...subject.querySelectorAll('[data-episode]')].map(row=>row.dataset.episode)).filter(ids=>ids.length)));const descending=values=>assert.deepEqual(values,[...values].sort((a,b)=>b-a),"Importance sorts highest first within the hierarchy");descending(groups.map(group=>Math.max(...group.flat().map(id=>rank[byId.get(id).importance]))));for(const group of groups){descending(group.map(subject=>Math.max(...subject.map(id=>rank[byId.get(id).importance]))));for(const subject of group)descending(subject.map(id=>rank[byId.get(id).importance]));}
    await fill('[data-issue-search]',"Lab standalone reading");
    for(const mode of ["name","newest","oldest"]){await choose('[data-issue-sort]',mode);await expandIssues();const actual=await at('[data-episode]').evaluateAll(items=>items.map(item=>item.dataset.episode)),expected=[...actual].sort((a,b)=>mode==="name"?nodes.get(byId.get(a).anchor).name.localeCompare(nodes.get(byId.get(b).anchor).name)||a.localeCompare(b):(mode==="newest"?-1:1)*byId.get(a).opened_at.localeCompare(byId.get(b).opened_at)||a.localeCompare(b));assert.equal(actual.length,60);assert.deepEqual(actual,expected,`${mode} orders the complete standalone results`);}
    await fill('[data-issue-search]',lab.entities.bulk_59);assert.ok(await at('[data-episode]').count());assert.ok((await bodyText()).includes("match"));
    await fill('[data-issue-search]',"does-not-exist-acceptance");await text('main',/No matching issues/);await click('[data-action="clear-issue-search"]');await expandIssues();
    assert.deepEqual((await at('[data-episode]').evaluateAll(items=>items.map(item=>item.dataset.episode))).sort(),all);await noChange(before);
  });
  await scenario("issues.evidence",async()=>{
    const configuration=await call("homeostatic/configuration"),setup=structuredClone(configuration.settings),original=setup.monitoring_policies.find(policy=>policy.id==="default_entities");setup.monitoring_policies.push({...structuredClone(original),id:"acceptance_overlap",name:"Second availability rule"});await call("homeostatic/save_settings",{revision:configuration.revision,settings:setup});
    const issue=await grouped();await clean();const before=await snapshot(),data=await inventory();await openIssue(issue.episode_id);
    const expected=await flatGroupedEvidence(issue,data,before);assert.ok([...expected.values()].some(item=>item.names.size>1),"Overlapping actual availability checks were exercised");
    const [id,item]=[...expected].find(([,member])=>member.source.kind==="entity");await at(`dialog[open] [data-source-link="${id}"]`).first().click();await at('#sources-detail-title').waitFor();assert.equal(await read('#sources-detail-title'),item.source.name,"A named entity link opens the exact canonical Monitoring source");
    await noChange(before);return "Actual grouped issue shows exact device/entity names, conditions, independent policies and complete recorded scope without a Details expander. Named evidence links and original-issue controls preserve identity without saves.";
  });
  await scenario("issues.recovery",async()=>{
    const first=await episodeFor("offline","entity"),secondIssue=await episodeFor("offline_second","entity");await openIssue(first.episode_id);
    await realState("offline","23");await clean();const partial=await inventory();
    assert.ok(partial.episodes.some(episode=>partial.nodes.find(node=>node.node_id===episode.anchor)?.entity_id===lab.entities.offline_second),"The still-unavailable sibling remains an issue");
    await realState("offline_second","12");await clean();const full=await inventory();
    assert.ok(!full.episodes.some(episode=>{const source=full.nodes.find(node=>node.node_id===episode.anchor);return source?.entity_id===lab.entities.offline_second||source?.entity_id===lab.entities.offline||source?.kind==="device"&&source.attributes?.device?.includes(lab.devices.offline);}));
    await go("history");await text('main',/Lab offline|Lab secondary/);const history=await query("resolved_history");for(const issue of [first,secondIssue])assert.ok(history.episodes.some(row=>row.episode.episode_id===issue.episode_id),"Each recovered entity retains its original history identity");
    const shared=await grouped();await realState("offline","23");let remaining=await inventory();const second=remaining.nodes.filter(node=>node.entity_id===lab.entities.offline_second).map(node=>node.node_id);assert.ok(remaining.episodes.some(item=>[item.anchor,...item.recorded,...item.reasons.map(reason=>reason.node_id)].some(id=>second.includes(id))),"Partial grouped recovery retains the outstanding entity");
    await control("recover");await control("integration_failure",{failed:false});await control("advance",{seconds:5});remaining=await inventory();assert.ok(!remaining.episodes.some(item=>item.episode_id===shared.episode_id));
  });
  await scenario("issues.empty",async()=>{
    await go("problems");await fill('[data-issue-search]',"no-matching-acceptance-source");await text('main',/No matching issues/);await click('[data-action="clear-issue-search"]');
    let config=await call("homeostatic/configuration");const settings=structuredClone(config.settings);for(const policy of settings.monitoring_policies)policy.enabled=policy.id==="lab_temperature";
    await call("homeostatic/save_settings",{revision:config.revision,settings});await control("recover");await clean();await text('main',/No open issues/);assert.ok(await at('main [data-page="policies"]').count());
    config=await call("homeostatic/configuration");for(const policy of settings.monitoring_policies)policy.enabled=false;await call("homeostatic/save_settings",{revision:config.revision,settings});await call("call_service",{domain:"homeostatic",service:"manage_alert",service_data:{automation:lab.entities.automation,operation:"retire"},return_response:true});await clean();await text('main',/Nothing is monitored/);assert.ok(await at('main [data-page="policies"]').count());
    transport.transformResponse=(packet,request)=>packet.type==="event"&&request?.type==="homeostatic/subscribe"?{...packet,event:{...packet.event,available:false}}:packet;
    await page.goto(lab.panel_url);await text('.shell',/Monitoring unavailable/);transport.transformResponse=null;await clean();
    transport.commandModes.set("homeostatic/subscribe","hold");const navigation=page.goto(lab.panel_url);await navigation;await text('.shell',/Connecting|Loading|Waiting/i);transport.release?.();transport.commandModes.clear();await clean();
    return "Distinct filtered, configured-empty, transport-unavailable and pending-subscription states with their rendered next actions; unavailable/loading replies injected at browser transport.";
  });
  await scenario("issues.individual",async()=>{
    const before=await snapshot(),episode=await episodeFor("temperature","temperature_limit");await openIssue(episode.episode_id);
    await text('dialog[open]',/Temperature above|87/);assert.ok(await at('dialog[open] [data-acknowledge]').isVisible());assert.ok(await at('dialog[open] [data-shelf]').isVisible());
    assert.equal(await at('dialog[open] [data-disclosure="issue-details"]').count(),0);
    assert.equal(await at('dialog[open] [data-entity]').innerText(),"Open Entity");
    assert.ok(!(await read('dialog[open]')).includes("View in Monitoring"));
    const coverage=await call("homeostatic/source",{node_id:await sourceId("temperature")});
    const policyIds=(coverage.monitoring_policies||[]).map(policy=>policy.id);
    const visiblePolicies=await at('dialog[open] .issue-policy-links [data-definition-action="open-policy"]').evaluateAll(items=>items.map(item=>item.dataset.definitionId));
    assert.ok(policyIds.length&&policyIds.every(id=>visiblePolicies.includes(id)),"Every canonical entity policy is offered, beyond the current issue policy");
    const profiles=[...new Set(before.monitoring_policies.filter(policy=>visiblePolicies.includes(policy.id)).flatMap(policy=>policy.notifications.map(row=>row.profile).filter(id=>before.notification_definitions.profiles[id])))].sort();
    assert.deepEqual((await at('dialog[open] [data-definition-action="open-notification"]').evaluateAll(items=>items.map(item=>item.dataset.definitionId))).sort(),profiles,"Named notifications cover all saved entity policies without duplicates");
    if(profiles.length){
      const profileId=profiles[0],notification=at(`dialog[open] [data-definition-action="open-notification"][data-definition-id="${profileId}"]`);
      await notification.focus();await page.keyboard.press("Enter");await at('.notification-profile-editor').waitFor();
      assert.equal(await at(field("name")).inputValue(),before.notification_definitions.profiles[profileId].name);
      await fill(field("name"),"Pending issue notification");await click('[data-workspace-return]');await at('dialog[open]').waitFor();
      assert.equal(await at('dialog[open] [data-shelf]').getAttribute("data-shelf"),episode.episode_id);
      await at(`dialog[open] [data-definition-action="open-notification"][data-definition-id="${profileId}"]`).click();
      assert.equal(await at(field("name")).inputValue(),"Pending issue notification","Back preserves the independent notification draft");
      await discard();await openIssue(episode.episode_id);
    }
    await text('dialog[open]',/Required duration|Duration/);const policy=at('dialog[open] .issue-policy-links [data-definition-action="open-policy"][data-definition-id="lab_temperature"]');assert.ok(await policy.isVisible());await policy.click();
    assert.equal(await at(field("name")).inputValue(),before.monitoring_policies.find(item=>item.id==="lab_temperature").name);await click('[data-workspace-return]');await at('dialog[open]').waitFor();
    await realState("temperature","unknown");await text('dialog[open]',/Waiting for a temperature reading|No temperature reading|unknown/i);assert.ok(!(await read('dialog[open]')).includes("87 °F"));
    await realState("temperature","87");await text('dialog[open]',/87/);await pause(episode);await openIssue(episode.episode_id);await text('dialog[open]',/Until/);await click('[data-cancel-control]');await cancelTool();
    await openIssue(episode.episode_id);await click('[data-cancel-control]');await submit();await text('dialog[open]',/selected control has ended/);await noChange(before);await fit('dialog[open]');await realState("temperature","70");await clean();assert.ok(!(await inventory()).episodes.some(item=>item.episode_id===episode.episode_id));
  });
  await scenario("issues.entity-navigation",async()=>{
    // The synthetic integration has no diagnostics platform. Native HA asks for
    // its capabilities without handling the unsupported-domain error; model
    // those empty capabilities while exercising the actual native destinations.
    transport.interceptRequest=(request,route)=>{
      if(request.type!=="diagnostics/get"||request.domain!=="homeostatic_ui_lab")return false;
      route.send(JSON.stringify({id:request.id,type:"result",success:true,result:{domain:request.domain,handlers:{config_entry:false,device:false}}}));return true;
    };
    const before=await snapshot(),episode=await episodeFor("offline","entity");await openIssue(episode.episode_id);
    const entityButton=at('dialog[open] [data-entity]'),deviceButton=at('dialog[open] .issue-native-actions a[href^="/config/devices/device/"]');
    assert.equal(await entityButton.innerText(),"Open Entity");assert.equal(await entityButton.getAttribute("data-entity"),lab.entities.offline);
    assert.equal(await deviceButton.innerText(),"Open Device");
    assert.equal(await at('dialog[open] [data-issue-availability="remove"]').innerText(),"Stop Monitoring");
    const actionMetrics=await at('dialog[open] .issue-native-actions a,dialog[open] .issue-native-actions button,dialog[open] [data-issue-availability="remove"],dialog[open] [data-acknowledge],dialog[open] [data-shelf]').evaluateAll(elements=>elements.map(element=>({label:element.textContent.trim(),height:element.getBoundingClientRect().height,width:element.getBoundingClientRect().width,minHeight:getComputedStyle(element).minHeight})));
    await writeFile(`${ctx.artifactDir}/issue-action-metrics.json`,JSON.stringify(actionMetrics,null,2));
    assert.ok(actionMetrics.every(item=>item.height>=44),"Every issue action has a touch target at least 44 pixels high");
    await page.screenshot({path:`${ctx.artifactDir}/unavailable-entity-issue.png`,fullPage:false});
    await entityButton.click();await page.locator('ha-more-info-dialog').getByRole("dialog").waitFor({state:"visible"});
    await page.keyboard.press("Escape");await page.locator('ha-more-info-dialog').getByRole("dialog").waitFor({state:"hidden"});
    await openIssue(episode.episode_id);
    const destination=await deviceButton.getAttribute("href");assert.equal(destination,`/config/devices/device/${lab.devices.offline}`);
    await deviceButton.click();await page.waitForURL(new URL(destination,lab.url).href);await page.locator('ha-config-device-page').getByText("Lab offline device",{exact:true}).first().waitFor({state:"visible"});
    await page.goBack();await at('[data-issue-search]').waitFor();await openIssue(episode.episode_id);
    assert.equal(await at('dialog[open] [data-shelf]').getAttribute("data-shelf"),episode.episode_id);
    await noChange(before);return "Open Entity opens native Home Assistant more-info and Escape dismisses it; Open Device opens the exact registry device page and browser Back retains the issue destination. Saved settings remain unchanged. Only the synthetic integration's diagnostics/get capability response is modeled as having no diagnostic handlers; all navigation and Homeostatic requests use real isolated Home Assistant.";
  });
  await scenario("issues.compact-popups",async()=>{
    const before=await snapshot(),data=await inventory(),nodes=new Map([...data.catalog.candidates,...data.nodes].map(node=>[node.node_id,node]));const seen=new Set(),focusFailures=[],focusChecks=[];let update=10;
    const evidence={device:/Lab offline sensor · unavailable in Home Assistant/,entity:/unavailable/i,battery:/Battery low|12\s*%/,vacuum:/Vacuum error|error/i,ups:/backup power|low reserve|replacement|alarm/i,repair:/Home Assistant Repairs|Repair/i,broken_automation:/light.ui_lab_missing_porch/,situation:/This reported condition remains open/,temperature_limit:/87\s*°F/};
    for(const episode of data.episodes){const node=nodes.get(episode.anchor),kind=node?.kind;if(seen.has(kind))continue;seen.add(kind);await openIssue(episode.episode_id);const canonical=["temperature_limit","thermostat"].includes(kind)?[...nodes.values()].find(item=>item.kind==="entity"&&item.entity_id===node.entity_id&&!item.monitoring_policy):nodes.get(node.monitoring_source)||node,title=await read('dialog[open] h2');assert.ok([canonical.name,node.name].includes(title),`${kind} preserves exact canonical or recorded source identity: ${title}`);await text('dialog[open]',evidence[kind]);assert.equal(await at('dialog[open] [data-shelf]').getAttribute("data-shelf"),episode.episode_id);assert.equal(await at('dialog[open] [data-acknowledge]').getAttribute("data-acknowledge"),episode.episode_id);
      if(kind==="device")await text('dialog[open]',/Lab secondary reading · unavailable in Home Assistant/);assert.equal(await at('dialog[open] [data-disclosure="issue-details"]').count(),0);await details();await fit('dialog[open]');await page.evaluate(()=>new Promise(requestAnimationFrame));const active=at('dialog[open] [data-shelf]'),original=await active.elementHandle(),dialog=await at('dialog[open]').elementHandle(),temperatureBefore=kind==="temperature_limit"?await at('dialog[open] .temperature-issue').textContent():null;await active.focus();const beforeFocus=await page.evaluate(captureIssueActionFocus,{dialog,previous:original,id:episode.episode_id});assert.equal(beforeFocus.focused,true,`${kind} focus precondition`);if(temperatureBefore)await control("advance",{seconds:1});await realState("history",String(++update));if(temperatureBefore)await page.waitForFunction(({dialog,before})=>{const current=dialog.querySelector('.temperature-issue');return current&&current.textContent!==before;},{dialog,before:temperatureBefore});await page.waitForFunction(id=>{let focused=document.activeElement;while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;return focused?.dataset.shelf===id;},episode.episode_id,{timeout:5000});const afterFocus=await page.evaluate(captureIssueActionFocus,{dialog,previous:original,id:episode.episode_id});await original.dispose();await dialog.dispose();const result={kind,episode:episode.episode_id,before:beforeFocus,after:afterFocus};focusChecks.push(result);if(!afterFocus.focused)focusFailures.push(result);await writeFile(`${ctx.artifactDir}/issues-popup-focus.json`,JSON.stringify({focusChecks,focusFailures},null,2));await close();}
    for(const kind of ["entity","battery","vacuum","ups","repair","broken_automation","situation","temperature_limit"])assert.ok(seen.has(kind),`Real popup variant ${kind} was exercised`);
    await source("offline","device");await click('[data-device-issues]');await at('dialog[open] .device-issues').waitFor();
    const deviceIds=[await episodeFor("offline","entity"),await episodeFor("offline_second","entity")].map(issue=>issue.episode_id).sort();
    assert.deepEqual((await at('dialog[open] [data-device-issue-select]').evaluateAll(items=>items.map(item=>item.dataset.deviceIssueSelect))).sort(),deviceIds,"Device popup retains the exact independent entity issues");
    const deviceAction=at('dialog[open] [data-device-response="pause"]'),deviceHandle=await deviceAction.elementHandle();await deviceAction.focus();await realState("history",String(++update));
    await page.evaluate(()=>new Promise(requestAnimationFrame));const deviceFocus=await deviceAction.evaluate((element,previous)=>({sameDOM:element===previous,focused:element.getRootNode().activeElement===element,previousConnected:previous.isConnected}),deviceHandle);await writeFile(`${ctx.artifactDir}/combined-device-focus.json`,JSON.stringify(deviceFocus,null,2));await page.waitForFunction(()=>{let focused=document.activeElement;while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;return focused?.matches('[data-device-response="pause"]');},null,{timeout:5000});await deviceHandle.dispose();await fit('dialog[open]');await close();
    const popupErrors=[];const popup=async(name,body)=>{
      await close();
      try{await body();}
      catch(error){
        const screenshot=`${ctx.artifactDir}/issues-popup-${name}.png`,dom=`${ctx.artifactDir}/issues-popup-${name}.txt`;
        const failure={variant:name,error:error.stack||String(error),screenshot,dom};popupErrors.push(failure);
        await page.screenshot({path:screenshot,fullPage:true,timeout:5000}).catch(error=>{failure.screenshot_error=String(error);});
        const text=await (await at('.shell').count().catch(()=>0)?bodyText():page.locator('body').innerText({timeout:3000})).catch(error=>{failure.dom_error=String(error);return "Page unavailable";});
        await writeFile(dom,text).catch(error=>{failure.dom_error=String(error);});
      }finally{await writeFile(`${ctx.artifactDir}/issues-popup-diagnostics.json`,JSON.stringify({focusChecks,focusFailures,popupErrors},null,2));await close();}
    };
    await popup("integration",async()=>{await control("integration_failure");await clean();const integration=await episodeFor(null,"integration"),current=await inventory(),source=current.catalog.candidates.find(node=>node.node_id===`entry:${lab.fixture_entry_id}`);assert.ok(source);await openIssue(integration.episode_id);await text('dialog[open]',/Connection is retrying/);assert.equal(await read('dialog[open] h2'),`${source.attributes.domain[0]} · ${source.name}`);assert.equal(await at('dialog[open] [data-acknowledge]').getAttribute("data-acknowledge"),integration.episode_id);await details();await fit('dialog[open]');await noChange(before);});
    await popup("source-only-canonical",async()=>{await control("integration_failure",{failed:false});await page.goto(`${lab.url}/homeostatic/node/${encodeURIComponent(await sourceId("history"))}`);await at('dialog[open] .issue-policy-links').waitFor();assert.equal(await read('dialog[open] h2'),"Lab previously failed sensor");await text('dialog[open]',/Current condition isn't confirmed/);assert.equal(await at('dialog[open] [data-shelf],dialog[open] [data-acknowledge],dialog[open] .problem-progress').count(),0);await details();await fit('dialog[open]');});
    await popup("source-only-check",async()=>{await control("integration_failure",{failed:false});const current=await inventory(),source=current.nodes.find(node=>node.entity_id===lab.entities.history&&node.monitoring_policy==="default_entities");assert.ok(source);assert.ok(!current.episodes.some(episode=>episode.anchor===source.node_id));await page.goto(`${lab.url}/homeostatic/node/${encodeURIComponent(source.node_id)}`);await at('dialog[open] .issue-policy-links').waitFor();assert.ok(["Lab previously failed sensor",source.name].includes(await read('dialog[open] h2')),"Source-only check retains its exact canonical or recorded name");await text('dialog[open]',/Sensor available/);assert.equal(await at('dialog[open] [data-shelf],dialog[open] [data-acknowledge],dialog[open] .problem-progress').count(),0);await details();await fit('dialog[open]');});
    await popup("grouped",async()=>{const shared=await grouped(),configured=await snapshot(),current=await inventory();await openIssue(shared.episode_id);await flatGroupedEvidence(shared,current,configured);await fit('dialog[open]');await noChange(configured);});
    assert.deepEqual({focusFailures,popupErrors},{focusFailures:[],popupErrors:[]},"All popup variants preserve current evidence, identity and action focus");
  });
  await scenario("issues.controls",async()=>{
    const before=await snapshot(),episode=await episodeFor("temperature","temperature_limit");await openIssue(episode.episode_id);await click('[data-acknowledge]');await cancelTool();
    assert.ok(!(await query("policy")).episodes.find(item=>item.episode_id===episode.episode_id)?.acknowledgment);await openIssue(episode.episode_id);await click('[data-acknowledge]');await submit();await text('dialog[open]',/Awareness recorded/);
    assert.ok((await query("policy")).episodes.find(item=>item.episode_id===episode.episode_id)?.acknowledgment);await openIssue(episode.episode_id);assert.equal(await at('dialog[open] [data-acknowledge]').count(),0);
    const saved=await pause(episode);await openIssue(episode.episode_id);await click('[data-cancel-control]');await cancelTool();assert.ok((await controls()).some(item=>item.control_id===saved.control_id));
    let responses=0;transport.transformResponse=(packet,request)=>{
      if(request?.type==="call_service"&&request.domain==="homeostatic"&&request.service==="cancel_control"&&packet.type==="result"&&packet.success){responses++;return {...packet,success:false,error:{code:"acceptance_response_lost",message:"Control response deliberately lost"}};}return packet;
    };
    await openIssue(episode.episode_id);await click('[data-cancel-control]');await submit();await text('dialog[open]',/may already have been saved/);assert.equal(responses,1);assert.ok(!(await controls()).some(item=>item.control_id===saved.control_id));
    await realState("history","12");assert.equal(responses,1,"No automatic ambiguous-control retry");await noChange(before);
  });
  await scenario("issues.availability-batch",async()=>{
    const before=await snapshot(),ids=[await sourceId("offline"),await sourceId("offline_second")];await go("problems");assert.equal(await at('main [data-issue-availability]').count(),0);await expandIssues();assert.equal(await at('main [data-issue-availability]').count(),0);
    await click(`[data-device-issues="${lab.devices.offline}"]`);await at('dialog[open] [data-device-response="pause"]').waitFor();await at('dialog[open] [data-device-issue-select]').first().uncheck();const stopMonitoring=at('dialog[open] [data-issue-availability="remove"]');assert.equal(await stopMonitoring.innerText(),"Stop Monitoring");assert.equal(await stopMonitoring.evaluate(button=>button.classList.contains("button")&&!button.classList.contains("link")),true);await stopMonitoring.click();assert.equal(await at('dialog[open] [data-issue-availability="confirm"]').innerText(),"Stop Monitoring");await details();await text('dialog[open]',/Lab offline|Lab secondary/);await click('dialog[open] [data-issue-availability="cancel"]');await noChange(before);assert.ok(await at('dialog[open]').count());
    await click('dialog[open] [data-issue-availability="remove"]');const count=rejectSave();await click('dialog[open] [data-issue-availability="confirm"]');await text('dialog[open]',/Gap save rejected/);await noChange(before);assert.equal(count(),1);transport.interceptRequest=null;
    await click('dialog[open] [data-issue-availability="confirm"]');await at('dialog[open]').waitFor({state:"hidden"});await expectedExclusions(before,ids);assert.equal(await at('main [data-issue-availability]').count(),0);assert.ok(!(await bodyText()).includes("Changes saved."));
  });
  await scenario("issues.split-history",async()=>{
    const original=await grouped();await control("integration_failure",{failed:false});await control("advance",{seconds:5});await clean();
    const before=await snapshot(),history=await query("resolved_history"),split=history.episodes.find(item=>item.episode.episode_id===original.episode_id);
    await writeFile(`${ctx.artifactDir}/split-lifecycle.json`,JSON.stringify({original,history,inventory:await inventory()},null,2));
    assert.equal(split?.resolution,"split");assert.ok(split.split_into.length>1);
    const data=await inventory();for(const id of split.split_into)assert.ok(data.episodes.some(item=>item.episode_id===id));
    await page.goto(`${lab.url}/homeostatic/history/${encodeURIComponent(original.episode_id)}`);
    await at(`[data-history-toggle="${original.episode_id}"][aria-expanded="true"]`).waitFor();
    await text('.history-content:visible',/Recovery was not established/);
    const links=at('.history-content:visible [data-open-episode]');
    assert.deepEqual((await links.evaluateAll(items=>items.map(item=>item.dataset.openEpisode))).sort(),[...split.split_into].sort());
    const target=await links.first().getAttribute("data-open-episode");await links.first().click();await at(`dialog[open] [data-shelf="${target}"]`).waitFor();await noChange(before);
    return "A real failed integration recovers with device failures remaining; History reports Issues separated, retains exact successor links and opens the selected successor without claiming recovery.";
  });
  await scenario("issues.history",async()=>{
    await control("bulk");await control("advance",{seconds:61});await control("bulk",{failed:false});await control("recover");const config=await call("homeostatic/configuration"),settings=structuredClone(config.settings);settings.timings.settle=30;settings.timings.retry_hold=0;await call("homeostatic/save_settings",{revision:config.revision,settings});await control("advance",{seconds:1});await realState("bulk_0","unavailable");await control("advance",{seconds:4});await episodeFor("bulk_0","entity");await realState("bulk_1","unavailable");await realState("bulk_2","unavailable");await control("advance",{seconds:4});await control("integration_failure");await control("advance",{seconds:4});await clean();const before=await snapshot(),history=await query("resolved_history");assert.ok(history.episodes.length>20);await go("history");
    const all=new Set();for(let index=0;index<10;index++){for(const id of await at('[data-history-toggle]').evaluateAll(items=>items.map(item=>item.dataset.historyToggle)))all.add(id);if(!await at('[data-tool="next"]').count()||await at('[data-tool="next"]').isDisabled())break;await click('[data-tool="next"]');}assert.equal(all.size,history.episodes.length);
    await fill('[data-history-search]',"no-acceptance-match");assert.equal(await at('[data-history-toggle]').count(),0);await fill('[data-history-search]',"");for(const value of await at('[data-history-filter] option').evaluateAll(items=>items.map(item=>item.value))){await choose('[data-history-filter]',value);const visible=await at('[data-history-toggle]').evaluateAll(items=>items.map(item=>item.dataset.historyToggle));assert.ok(visible.every(id=>history.episodes.some(item=>item.episode.episode_id===id&&(!value||item.resolution===value))),`Outcome filter ${value} matches recorded resolutions`);}await choose('[data-history-filter]',"");
    const ordinary=history.episodes.find(item=>item.resolution==="cleared"&&item.source?.kind==="entity"&&item.source.name.includes("standalone")),id=ordinary.episode.episode_id;await page.goto(`${lab.url}/homeostatic/history/${encodeURIComponent(id)}`);const row=at(`[data-history-toggle="${id}"]`);await row.waitFor();assert.equal(await row.getAttribute("aria-expanded"),"true");assert.equal(await at('dialog[open]').count(),0);await text(`[data-history-toggle="${id}"]`,ordinary.source.name);await text('.history-content:visible',/Home Assistant reported this entity as unavailable/);const observed=await read('.history-content:visible .history-times dd'),times=await page.evaluate(({start,end})=>[start,end].map(value=>({day:new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}),time:new Date(value).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})})),{start:ordinary.episode.opened_at,end:ordinary.resolved_at});for(const value of times)assert.ok(observed.includes(value.day)&&observed.includes(value.time),"Recorded opened and ended times appear in the observed range");assert.ok(observed.includes("1 min"));await realState("history","13");assert.equal(await row.getAttribute("aria-expanded"),"true");await row.click();
    const joined=history.episodes.find(item=>item.resolution==="absorbed"&&item.absorbed_into);assert.ok(joined,"A real integration failure absorbs affected issues with a related-issue link");await page.goto(`${lab.url}/homeostatic/history/${encodeURIComponent(joined.episode.episode_id)}`);await at(`[data-history-toggle="${joined.episode.episode_id}"][aria-expanded="true"]`).waitFor();await text('.history-content:visible',/Recovery was not established/);const link=at('.history-content:visible [data-open-episode],.history-content:visible [data-history]').first();await link.click();if(await at('dialog[open]').count())await at('dialog[open] [data-shelf]').waitFor();else await at(`[data-history-toggle="${joined.absorbed_into}"][aria-expanded="true"]`).waitFor();await noChange(before);
  });

  await scenario("sources.tree-layout",async()=>{
    await control("bulk");await clean();const before=await snapshot();await tree();await fill('[data-sources-search]',"Lab");
    const metrics=await at('.config-nav-row').evaluateAll(rows=>rows.filter(row=>row.getClientRects().length).map(row=>{
      const pick=row.querySelector('.config-pick'),title=pick?.querySelector('.source-row-title'),button=row.querySelector('.config-toggle');if(!pick||!title)return null;
      const range=document.createRange();range.selectNodeContents(title.firstChild);const line=range.getClientRects()[0],arrow=button?.querySelector('.disclosure')?.getBoundingClientRect();return {fits:pick.scrollWidth<=pick.clientWidth+1,aligned:!arrow||Math.abs(arrow.top+arrow.height/2-line.top-line.height/2)<=4,full:!button||button.getBoundingClientRect().height>=row.getBoundingClientRect().height-1};
    }).filter(Boolean));assert.ok(metrics.length>20);assert.ok(metrics.every(item=>item.fits&&item.aligned&&item.full));assert.equal(await at('.source-issue-count').filter({hasText:/\d/}).count(),0);await noChange(before);
  });
  await scenario("sources.tree",async()=>{
    const before=await snapshot();await source("offline");const selected=await at('[data-sources-select][aria-current]').getAttribute("data-sources-select");assert.equal(selected,`source:${await sourceId("offline")}`);await tree();await fill('[data-sources-search]',"Lab");while(await at('[data-source-more]').count())await at('[data-source-more]').first().click();assert.ok(await at(`[data-sources-select="source:${await sourceId("bulk_59")}"]`).count());await fill('[data-sources-search]',"");
    const toggle=at('[data-sources-toggle]').first();await toggle.focus();const initial=await toggle.getAttribute("aria-expanded");await toggle.click();assert.notEqual(await toggle.getAttribute("aria-expanded"),initial);await page.keyboard.press("ArrowRight");assert.equal(await toggle.getAttribute("aria-expanded"),"true");await page.keyboard.press("ArrowLeft");assert.equal(await toggle.getAttribute("aria-expanded"),"false");
    await fill('[data-sources-search]',lab.entities.offline);assert.equal(await at(`[data-sources-select="${selected}"]`).getAttribute("aria-current"),"true");await go("policies");await tree();assert.equal(await at('[data-sources-search]').inputValue(),lab.entities.offline);assert.equal(await at(`[data-sources-select="${selected}"]`).getAttribute("aria-current"),"true");await at(`[data-sources-select="${selected}"]`).click();await text('#sources-detail-title',/^Lab offline sensor$/);await noChange(before);return `Pointer and keyboard disclosure, search and navigation retain selected source ${selected}.`;
  });
  await scenario("sources.monitoring-inspector",async()=>{
    await control("bulk");await clean();const before=await snapshot();await tree();await fill('[data-sources-search]',"Lab");
    const known={monitored:await sourceId("offline"),unmonitored:await sourceId("unmonitored")};
    for(const mode of ["all","monitored","unmonitored"]){await choose('[data-sources-monitoring]',mode);for(const [coverage,key] of [["monitored","offline"],["unmonitored","unmonitored"]]){await fill('[data-sources-search]',lab.entities[key]);assert.equal(await at(`[data-sources-select="source:${known[coverage]}"]`).count(),mode==="all"||mode===coverage?1:0,`${mode} filters the known ${coverage} entity correctly`);if(mode==="all"||mode===coverage)await text(`[data-sources-select="source:${known[coverage]}"]`,coverage==="monitored"?/Monitored/:/Not monitored/);}}
    await source("unmonitored");await text('.source-monitoring-status',/not monitor|not monitored/i);assert.equal(await at('[data-source-policies="open"]').count(),0);
    await source("offline");await text('.config-detail',/Home Assistant reports this entity as unavailable/);assert.ok(await at('[data-source-policies="open"]').count());assert.ok(await at('[data-availability-action="stop"]').isVisible());
    const id=await sourceId("offline");await page.goto(`${lab.url}/homeostatic/sources/${encodeURIComponent(`source:${id}`)}/history`);await at('#source-history-title').waitFor();await click('[data-sources-view="source"]');await noChange(before);
  });
  await scenario("sources.compact-inspector-details",async()=>{
    const before=await snapshot();await source("temperature");await text('.config-detail',/87/);assert.equal(await at('.config-detail [data-shelf],.config-detail [data-acknowledge],.config-detail .source-monitoring-explanation').count(),0);assert.ok(await at('[data-source-policies="open"]').count());
    await source("offline","device");assert.equal(await at('.source-monitoring-explanation').count(),0);await at('.source-device-coverage').waitFor();await text('.config-detail',/entity|reading|availability/i);
    const data=await inventory(),battery=data.catalog.candidates.find(item=>item.kind==="battery"&&item.entity_id===lab.entities.battery);assert.ok(battery);await tree();await fill('[data-sources-search]',"Lab battery");await at(`[data-sources-select="source:${battery.node_id}"]`).click();await text('.config-detail',/12|Battery/);await click('.source-monitoring-explanation > summary');
    await click('.source-navigation [data-sources-view="history"]');await at('#source-history-title').waitFor();await click('[data-sources-view="source"]');await at('.config-detail [data-page="policies"]').click();await at('h1').filter({hasText:"Monitoring policies"}).waitFor();await tree();await noChange(before);
  });
  await scenario("sources.monitoring-toolbar",async()=>{
    const before=await snapshot(),selected=await source("offline");await tree();await fill('[data-sources-search]',"");const size=await at('.sources-tools').boundingBox();await click('[data-sources-filters]');await at('#sources-more-filters').waitFor({state:"visible"});assert.equal((await at('.sources-tools').boundingBox()).height,size.height);
    await check('[data-sources-disabled]',true);await text('[data-sources-filters]',/1/);await at('[data-sources-disabled]').focus();await realState("history","14");assert.equal(await at('[data-sources-disabled]').evaluate(element=>element.getRootNode().activeElement===element),true);
    await page.keyboard.press("Escape");assert.equal(await at('[data-sources-filters]').evaluate(element=>element.getRootNode().activeElement===element),true);await click('[data-sources-filters]');await at('[data-sources-search]').click();assert.equal(await at('#sources-more-filters').isVisible(),false);
    for(const grouping of ["location","integration"]){await choose('[data-sources-group]',grouping);assert.equal(await at('#sources-detail-title').textContent(),"Lab offline sensor");assert.equal(await at(`[data-sources-select="source:${selected}"]`).getAttribute("aria-current"),"true");}await at('[data-sources-toggle][aria-expanded="false"]').first().click();await click('[data-action="collapse-sources"]');assert.equal(await at('[data-sources-toggle][aria-expanded="true"]').count(),0);assert.equal(await at('[data-action="collapse-sources"]').isDisabled(),true);assert.equal(await at('#sources-detail-title').textContent(),"Lab offline sensor");await realState("history","16");assert.equal(await at('#sources-detail-title').textContent(),"Lab offline sensor");
    await fill('[data-sources-search]',lab.entities.offline);assert.equal(await at('[data-action="collapse-sources"]').isDisabled(),true);await go("policies");await tree();assert.equal(await at('[data-sources-search]').inputValue(),lab.entities.offline);assert.equal(await at(`[data-sources-select="source:${selected}"]`).getAttribute("aria-current"),"true");await noChange(before);
  });
  await scenario("sources.temperature-monitoring",async()=>{
    await control("temperature_device");
    const config=await call("homeostatic/configuration"),settings=structuredClone(config.settings),first=settings.monitoring_policies.find(policy=>policy.id==="lab_temperature");
    first.parameters.duration_seconds=60;settings.monitoring_policies.push({...structuredClone(first),id:"acceptance_second_temperature",name:"Second temperature rule",parameters:{unit:"°F",minimum:50,maximum:null,duration_seconds:0}});
    await realState("temperature","70");await call("homeostatic/save_settings",{revision:config.revision,settings});await control("advance",{seconds:1});await realState("temperature","87");await clean();
    const before=await snapshot(),canonical=await source("temperature");await text('.config-detail',/Lab temperature limits/);await text('[data-temperature-check]',/Waiting/);assert.equal(await at('[data-temperature-check]').count(),2);await text('[data-temperature-check]',/Within limits/);await text('[data-temperature-check]',/1 minute/);
    for(const grouping of ["integration","location"]){await tree();await choose('[data-sources-group]',grouping);await fill('[data-sources-search]',lab.entities.temperature);assert.equal(await at(`[data-sources-select="source:${canonical}"]`).count(),1);await at(`[data-sources-select="source:${canonical}"]`).click();await text('[data-temperature-check]',/Waiting/);}
    await click('[data-source-policies="open"]');const link=at('.source-policy-dialog [data-definition-action="open-policy"][data-definition-id="lab_temperature"]');await link.click();await at(field("name")).waitFor();await click('[data-workspace-return]');await at('#sources-detail-title').waitFor();
    await control("advance",{seconds:61});await text('[data-temperature-check]',/Temperature needs attention/);
    await realState("temperature","unknown");await text('.config-detail',/Waiting for a temperature reading|No temperature reading|unknown/i);await realState("temperature","87");await text('.config-detail',/87/);
    const data=await inventory(),old=data.nodes.find(node=>node.monitoring_policy==="lab_temperature");assert.ok(old);await page.goto(`${lab.url}/homeostatic/sources/${encodeURIComponent(`source:${old.node_id}`)}`);await at('#sources-detail-title').waitFor();await text('.config-detail',/Lab room temperature/);
    await source("thermostat");await text('.config-detail',/Lab thermostat comfort/);await noChange(before);
    await source("temperature");await click('[data-availability-action="stop"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="resume"]').waitFor();await expectedExclusions(before,[canonical]);assert.equal(await at('[data-temperature-check]').count(),2);await text('.source-monitoring-status',/temperature/i);
    await source("temperature","device");assert.equal(await at('[data-temperature-check]').count(),2);await at('.source-device-coverage').waitFor();await at('[data-action="more-source-evidence"]').waitFor();const firstPage=await at('.source-device-member').count();await click('[data-action="more-source-evidence"]');await at('[data-action="more-source-evidence"]').waitFor({state:"hidden"});assert.equal(await at('[data-temperature-check]').count(),2);
    const loaded=await at('.source-device-member').count();assert.ok(loaded>firstPage,"Load more retains the earlier evidence page");
    await at('.source-device-summary [data-device-issues]').click();await at('dialog[open]').waitFor();await close();await at('dialog[open]').waitFor({state:"hidden"});
    assert.equal(await at('.source-device-member').count(),loaded,"Closing the device issue dialog retains the loaded evidence pages");assert.equal(await at('[data-action="more-source-evidence"]').count(),0);
    assert.equal(await at('.source-device-members').evaluate(list=>[...list.querySelectorAll('li')].every(row=>{const name=row.querySelector('a'),state=row.querySelector('.source-device-member-state');return !name||!state||state.getBoundingClientRect().top>=name.getBoundingClientRect().bottom-1;})),true,"Each reading is visually separated from its linked entity name");
    await page.screenshot({path:`${ctx.artifactDir}/temperature-evidence-pages.png`,fullPage:true});await at(`.source-temperature [data-source-link="${canonical}"]`).first().click();await text('#sources-detail-title',/Lab room temperature/);await fit('.config-detail');
  });
  await scenario("sources.monitoring-policies",async()=>{
    const setup=await call("homeostatic/configuration"),initial=await inventory();
    const check=initial.nodes.find(node=>node.entity_id===lab.entities.offline&&node.check_id==="availability"&&node.monitoring_policy);
    const original=setup.settings.monitoring_policies.find(policy=>policy.id===check?.monitoring_policy);assert.ok(original,"An active availability policy supplies the overlap fixture");
    const settings=structuredClone(setup.settings);settings.monitoring_policies.push({...structuredClone(original),id:"acceptance_overlap",name:"Overlapping entity availability"});
    await call("homeostatic/save_settings",{revision:setup.revision,settings});await clean();
    const before=await snapshot();
    await edit("policies","lab_temperature");await fill(field("name"),"Preserved temperature draft");
    await edit("methods","lab_messages");await fill(field("name"),"Preserved method draft");
    const selected=await source("offline"),data=await inventory();
    const entry=[...data.catalog.candidates,...data.nodes].find(item=>item.kind==="integration"&&item.entry_id===lab.fixture_entry_id);
    const expectedDevice=`/config/devices/device/${lab.devices.offline}`,expectedIntegration=`/config/integrations/integration/${entry.attributes.domain[0]}#config_entry=${lab.fixture_entry_id}`;
    const identity=()=>at('.source-identity a').evaluateAll(items=>items.map(item=>({name:item.textContent,href:item.getAttribute("href")})));
    const initialIdentity=await identity();
    assert.ok(initialIdentity.some(item=>item.href===expectedDevice&&item.name.includes("Lab")),"The known device name links to its actual registry device");
    assert.ok(initialIdentity.some(item=>item.href===expectedIntegration&&item.name),"The known integration name links to its exact connection");
    for(const grouping of ["location","integration"]){
      await tree();await choose('[data-sources-group]',grouping);await at(`[data-sources-select="source:${selected}"]`).click();
      assert.deepEqual(await identity(),initialIdentity,"Grouping preserves linked registry ownership");
    }
    assert.equal(await at('.source-policy-links [data-source-policies="open"]').count(),1);
    assert.equal(await at('.config-detail [data-definition-id]').count(),0,"The entity pane has no individual policy edit controls");
    await at('[data-source-policies="open"]').focus();await page.keyboard.press("Enter");await at('.source-policy-dialog[open]').waitFor();
    await text('.source-policy-dialog',/Lab offline sensor/);await text('.source-policy-dialog',/Checks this entity.s availability individually/);assert.ok(await at('.source-policy-dialog .source-policy').count()>=2,"Both overlapping entity availability policies remain visible");
    const ids=await at('.source-policy-dialog [data-definition-id]').evaluateAll(items=>items.map(item=>item.dataset.definitionId));
    const contributing=new Set(data.nodes.filter(node=>node.watched&&node.kind==="entity"&&node.check_id==="availability"&&node.monitoring_source===selected).map(node=>node.monitoring_policy));
    const availability=before.monitoring_policies.filter(policy=>policy.enabled&&contributing.has(policy.id));
    assert.ok(availability.length>=2&&availability.every(policy=>ids.includes(policy.id)),"Each real contributing availability policy remains reachable");
    const editPolicy=at(`.source-policy-dialog [data-definition-id="${availability[0].id}"]`);await editPolicy.focus();await realState("history","15");
    await at('.source-policy-dialog[open]').waitFor();assert.equal(await editPolicy.evaluate(element=>element.getRootNode().activeElement===element),true,"Live monitoring preserves dialog focus");
    await page.keyboard.press("Escape");await at('.source-policy-dialog').waitFor({state:"detached"});
    assert.equal(await at('[data-source-policies="open"]').evaluate(element=>element.getRootNode().activeElement===element),true,"Escape restores trigger focus");
    await click('[data-source-policies="open"]');await click('[data-source-policies="close"]');
    assert.equal(await at('[data-source-policies="open"]').evaluate(element=>element.getRootNode().activeElement===element),true,"Close restores trigger focus");
    for(const policy of availability){
      await click('[data-source-policies="open"]');await at(`.source-policy-dialog [data-definition-id="${policy.id}"]`).click();
      assert.equal(await at(field("name")).inputValue(),policy.name,"Contextual Edit opens the selected policy");assert.equal(await at('.source-policy-dialog').count(),0);
      await text('[data-workspace-return]',/Back to source/);await click('[data-workspace-return]');await text('#sources-detail-title',/^Lab offline sensor$/);
      assert.equal(await at(`[data-sources-select="source:${selected}"]`).getAttribute("aria-current"),"true","Contextual return preserves selected entity");
    }
    await edit("policies","lab_temperature");assert.equal(await at(field("name")).inputValue(),"Preserved temperature draft");
    await edit("methods","lab_messages");assert.equal(await at(field("name")).inputValue(),"Preserved method draft");
    await source("offline");await noChange(before);
    return "Actual registry ownership stays linked across integration/location grouping. Keyboard Enter opens Monitoring policies; real Escape and pointer Close restore focus, live evidence updates preserve the dialog and focused policy, and each contributing availability policy opens its exact editor. Back to source retains the entity and independent policy/method drafts; saved settings are unchanged.";
  });
  await scenario("sources.details",async()=>{
    const before=await snapshot();await source("offline","device");await text('.source-device-summary',/0 of 2 entities available/);assert.equal(await at('.source-monitoring-explanation').count(),0);await at('.source-device-coverage').waitFor();assert.ok(await at('.source-device-members a[href^="/developer-tools/state?entity_id="]').count());
    await source("offline");await text('.config-detail',/Home Assistant reports this entity as unavailable/);await click('[data-source-policies="open"]');assert.ok(await at('.source-policy-dialog [data-definition-id]').count());await click('[data-source-policies="close"]');
    for(const [value,expected] of [["unknown",/Home Assistant reports no value/],["0",/0/],["unavailable",/Home Assistant reports this entity as unavailable/]]){await realState("offline",value);await text('.config-detail',expected);}
    await control("remove_state",{entity_id:lab.entities.offline});await text('.config-detail',/No current Home Assistant state|No current state|not provided|unavailable/i);await noChange(before);
  });
  await scenario("sources.availability",async()=>{
    const before=await snapshot(),id=await sourceId("offline");await edit("policies","lab_temperature");await fill(field("name"),"Preserved temperature draft");await edit("methods","lab_messages");await fill(field("name"),"Preserved method draft");await source("offline");
    await click('[data-availability-action="stop"]');await click('[data-availability-action="cancel"]');await noChange(before);await click('[data-availability-action="stop"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="resume"]').waitFor({timeout:30000});await expectedExclusions(before,[id]);await text('.config-detail',/Home Assistant reports this entity as unavailable/);
    await edit("policies","lab_temperature");assert.equal(await at(field("name")).inputValue(),"Preserved temperature draft");await discard();await edit("methods","lab_messages");assert.equal(await at(field("name")).inputValue(),"Preserved method draft");await discard();await source("offline");await click('[data-availability-action="resume"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="stop"]').waitFor({timeout:30000});await noChange(before);
  });
  await scenario("sources.availability-batch",async()=>{
    const before=await snapshot(),ids=[await sourceId("offline"),await sourceId("offline_second")];await source("offline","device");await click('[data-availability-action="select"]');for(const id of ids)await check(`[data-availability-select="${id}"]`,true);
    await click('[data-availability-action="stop-selected"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="confirm"]').waitFor({state:"hidden"});const after=await expectedExclusions(before,ids);
    await click('[data-availability-action="select"]');await check(`[data-availability-select="${ids[0]}"]`,true);await click('[data-availability-action="resume-selected"]');await click('[data-availability-action="confirm"]');await at('[data-availability-action="confirm"]').waitFor({state:"hidden"});await expectedExclusions(after,[ids[0]],false);
    await tree();await fill('[data-sources-search]',"");await click('[data-sources-filters]');await check('[data-sources-excluded]',true);await page.keyboard.press("Escape");assert.equal(await at(`[data-sources-select="source:${ids[0]}"]`).count(),0);assert.ok(await at(`[data-sources-select="source:${ids[1]}"]`).count());
  });
  await scenario("sources.availability-conflicts",async()=>{
    const before=await snapshot(),policy=before.monitoring_policies.find(item=>item.check==="availability"&&item.match?.kind?.includes("entity"));await edit("policies",policy.id);await fill(field("name"),"Affected pending draft");await source("offline");await click('[data-availability-action="stop"]');await click('[data-availability-action="confirm"]');await text('.config-detail',/draft/i);await noChange(before);await click('[data-availability-action="cancel"]');await edit("policies",policy.id);assert.equal(await at(field("name")).inputValue(),"Affected pending draft");await discard();
    await source("offline");await click('[data-availability-action="stop"]');const config=await call("homeostatic/configuration"),changed=structuredClone(config.settings);changed.timings.coalesce_count+=1;await call("homeostatic/save_settings",{revision:config.revision,settings:changed});await click('[data-availability-action="confirm"]');await text('.config-detail',/changed/i);assert.deepEqual(await snapshot(),changed);
    if(await at('[data-availability-action="cancel"]').isVisible())await click('[data-availability-action="cancel"]');await clean();await source("offline");await click('[data-availability-action="stop"]');const count=rejectSave();await click('[data-availability-action="confirm"]');await text('.config-detail',/Gap save rejected/);assert.equal(count(),1);assert.deepEqual(await snapshot(),changed);transport.interceptRequest=null;await click('[data-availability-action="confirm"]');await at('[data-availability-action="resume"]').waitFor({timeout:30000});await expectedExclusions(changed,[await sourceId("offline")]);
  });
  await scenario("sources.device-issue-navigation",async()=>{
    const before=await snapshot(),deviceSource=await source("offline","device"),sourceUrl=page.url(),expected=[await episodeFor("offline","entity"),await episodeFor("offline_second","entity")].map(issue=>issue.episode_id).sort();
    assert.equal(await at('.config-detail [data-device-issues]').count(),1);const entityLink=at('.source-device-members a').filter({hasText:"Lab offline sensor"}),entityHref=await entityLink.getAttribute("href");assert.ok(entityHref.includes(encodeURIComponent(lab.entities.offline)));await entityLink.click();await page.waitForURL(new URL(entityHref,lab.url).href);await page.goBack();await at('#sources-detail-title').waitFor();assert.equal(page.url(),sourceUrl);
    const open=async()=>{await click('.config-detail [data-device-issues]');await at('dialog[open] [data-device-response="pause"]').waitFor();assert.deepEqual((await at('dialog[open] [data-device-issue-select]').evaluateAll(items=>items.map(item=>item.dataset.deviceIssueSelect))).sort(),expected);};
    await open();await check(`dialog[open] [data-device-issue-select="${expected[0]}"]`,false);await click('dialog[open] [data-issue-availability="remove"]');await at('dialog[open] [data-issue-availability="confirm"]').waitFor();await text('dialog[open] .source-availability-confirm',/Lab offline sensor/);await text('dialog[open] .source-availability-confirm',/Lab secondary reading/);await click('dialog[open] [data-issue-availability="cancel"]');await noChange(before);
    const policyLink=at('dialog[open] [data-definition-action="open-policy"]').first(),policyId=await policyLink.getAttribute("data-definition-id");await policyLink.click();await at(field("name")).waitFor();assert.equal(await at(field("name")).inputValue(),before.monitoring_policies.find(policy=>policy.id===policyId).name);await click('[data-workspace-return]');await at('dialog[open] [data-device-response="pause"]').waitFor();await text('dialog[open] h2',/^Lab offline device$/);
    transport.interceptRequest=(request,route)=>{if(request.type!=="diagnostics/get"||request.domain!=="homeostatic_ui_lab")return false;route.send(JSON.stringify({id:request.id,type:"result",success:true,result:{domain:request.domain,handlers:{config_entry:false,device:false}}}));return true;};
    const native=at(`dialog[open] a[href="/config/devices/device/${lab.devices.offline}"]`);await native.click();await page.waitForURL(new URL(`/config/devices/device/${lab.devices.offline}`,lab.url).href);await page.locator('ha-config-device-page').getByText("Lab offline device",{exact:true}).first().waitFor();await page.goBack();await at('dialog[open] [data-device-response="pause"]').waitFor();await close();await writeFile(`${ctx.artifactDir}/device-navigation-return.json`,JSON.stringify({actual:page.url(),expected:sourceUrl,selected:await at('[data-sources-select][aria-current]').evaluateAll(items=>items.map(item=>item.dataset.sourcesSelect))},null,2));await at('#sources-detail-title').waitFor();assert.equal(page.url(),sourceUrl);assert.equal(await at(`[data-sources-select="source:${deviceSource}"]`).getAttribute("aria-current"),"true");await noChange(before);assert.deepEqual(await controls(),[]);
    return "Monitoring has one combined device View; exact native entity/device destinations and browser Back preserve source identity. The linked policy editor returns to the same device dialog. Removing an issue from response selection does not narrow the separate Stop Monitoring confirmation; cancel saves nothing and no response control is created.";
  });

  await scenario("sources.contextual-issue-controls",async()=>{
    const before=await snapshot(),policyBefore=await query("policy"),expected=[await episodeFor("offline","entity"),await episodeFor("offline_second","entity")].map(issue=>issue.episode_id).sort();await source("offline");const sourceUrl=page.url();assert.equal(await at('.config-detail [data-shelf],.config-detail [data-acknowledge]').count(),0);const link=at('.config-detail [data-episode]').first(),id=await link.getAttribute("data-episode");assert.ok(expected.includes(id));await link.click();await at('dialog[open] [data-device-response="pause"]').waitFor();
    assert.deepEqual((await at('dialog[open] [data-device-issue-select]').evaluateAll(items=>items.map(item=>item.dataset.deviceIssueSelect))).sort(),expected,"Owned entity routes to its device's exact current issue set");
    await check('dialog[open] [data-device-issues-all]',false);assert.equal(await at('dialog[open] [data-device-response="acknowledge"]').isDisabled(),true);await check(`dialog[open] [data-device-issue-select="${id}"]`,true);
    await click('dialog[open] [data-device-response="pause"]');await click('dialog[open] [data-device-response="cancel-pause"]');await close();assert.equal(page.url(),sourceUrl);assert.deepEqual(await controls(),[]);assert.deepEqual((await query("policy")).episodes.map(issue=>[issue.episode_id,issue.acknowledgment]),policyBefore.episodes.map(issue=>[issue.episode_id,issue.acknowledgment]));await noChange(before);
  });
  await scenario("sources.compact-layout",async()=>{
    const before=await snapshot();await source("offline");await fit('.config-detail');assert.equal(await at('.config-detail details').count(),0);assert.ok(await at('[data-source-policies="open"]').isVisible());assert.ok(await at('[data-availability-action="stop"]').isVisible());await at('[data-availability-action="stop"]').focus();await realState("history","15");assert.equal(await at('[data-availability-action="stop"]').evaluate(element=>element.getRootNode().activeElement===element),true);await click('[data-source-policies="open"]');await fit('.source-policy-dialog');await click('[data-source-policies="close"]');await noChange(before);
  });
  await scenario("sources.history",async()=>{
    const before=await snapshot(),id=`entry:${lab.fixture_entry_id}`,past=(await query("resolved_history")).episodes.find(row=>row.episode.recorded?.some(source=>source.includes(lab.registry_ids.history))||row.source?.name?.includes("previously"));assert.ok(past);
    await control("rename_registry",{entity_id:lab.entities.history,name:"Renamed current sensor"});await control("remove_registry",{entity_id:lab.entities.history});await clean();await page.goto(`${lab.url}/homeostatic/sources/${encodeURIComponent(`source:${id}`)}/history`);await at('#source-history-title').waitFor();
    const retained=await query("resolved_history");assert.ok(retained.episodes.some(item=>item.episode.episode_id===past.episode.episode_id),"The recorded issue remains in real HA history");assert.ok(await at(`[data-history="${past.episode.episode_id}"]`).count(),`Current integration history must retain the removed child's recorded membership; actual stored source=${JSON.stringify(past.source)}`);
    await at(`[data-history="${past.episode.episode_id}"]`).click();await at(`[data-history-toggle="${past.episode.episode_id}"][aria-expanded="true"]`).waitFor();await text(`[data-history-toggle="${past.episode.episode_id}"]`,/Lab previously failed sensor/);await text('.history-content:visible',/Home Assistant reported this entity as unavailable/);await page.goBack();await at('#source-history-title').waitFor();await noChange(before);
  });
  await scenario("sources.maintenance",async()=>{
    const before=await snapshot(),target=await source("offline");
    assert.equal(await at('[data-maintenance]').count(),0,"Entity details offer no new-maintenance action");
    await source("offline","device");assert.equal(await at('[data-maintenance]').count(),0,"Device details offer no new-maintenance action");
    await tree();await fill('[data-sources-search]',"");await at(`[data-sources-select="source:entry:${lab.fixture_entry_id}"]`).click();
    assert.equal(await at('[data-maintenance]').count(),0,"Integration details offer no new-maintenance action");
    const seed=async(reason,minutes)=>(await call("call_service",{domain:"homeostatic",service:"start_maintenance",service_data:{node_id:target,until:new Date(Date.now()+minutes*60000).toISOString(),reason},return_response:true})).response.control;
    const saved=await seed("Existing API-created maintenance",30),overlap=await seed("Separate overlapping maintenance",1);
    await source("offline");await at(`[data-cancel-control="${saved.control_id}"]`).waitFor();await text('.config-detail',/Until/);await text('.config-detail',/Existing API-created maintenance/);
    assert.equal(await at('[data-maintenance]').count(),0,"Existing controls do not restore a creation entry");
    await click(`[data-cancel-control="${saved.control_id}"]`);await cancelTool();assert.deepEqual(await controls(),[saved,overlap],"Closing confirmation keeps both windows");
    let requests=0;transport.interceptRequest=(request,route)=>{
      if(request.type!=="call_service"||request.service!=="cancel_control")return false;
      requests++;route.send(JSON.stringify({id:request.id,type:"result",success:false,error:{code:"acceptance_rejection",message:"Control response could not be confirmed"}}));return true;
    };
    await click(`[data-cancel-control="${saved.control_id}"]`);await submit();await text('dialog[open]',/may already have been saved/);
    assert.equal(requests,1,"An uncertain result does not automatically retry");assert.deepEqual(await controls(),[saved,overlap]);
    transport.interceptRequest=null;await submit();await text('dialog[open]',/selected control has ended/);
    assert.deepEqual(await controls(),[overlap],"The rendered end action removes exactly its selected window");await cancelTool();
    await source("offline");assert.equal(await at(`[data-cancel-control="${saved.control_id}"]`).count(),0);await at(`[data-cancel-control="${overlap.control_id}"]`).waitFor();
    await click(`[data-cancel-control="${overlap.control_id}"]`);await control("advance",{seconds:120});
    await at('dialog[open] button[type="submit"]:disabled').waitFor();assert.deepEqual(await controls(),[],"The overlapping window expires without UI cancellation");await cancelTool();
    assert.equal(await at('.config-detail [data-cancel-control]').count(),0);await noChange(before);
    return "Entity, device and integration details offer no maintenance creation. Existing API-created windows retain reason/expiry; closing confirmation preserves both. A rejected end request never retries automatically, deliberate pointer submission removes exactly one window, and expiry disables an already-open end confirmation for the other. Settings remain unchanged.";
  });
}
