/** Complete policy contracts against a disposable real Home Assistant instance. */
import assert from "node:assert/strict";

export async function runPolicyGaps(ctx) {
  const {page,lab,call,run,at,bodyText,action,field,snapshot,click,fill,choose,check,clean,go,listing,edit,menu,save,discard,deleteConfirm,addPolicy,noChange,transport}=ctx;
  const policy=(settings,id)=>settings.monitoring_policies.find(p=>p.id===id);
  const currentId=()=>at(field("name")).getAttribute("data-definition-id");
  const name=()=>at(field("name")).inputValue();
  const selection=id=>`${field("source-choice")}[data-definition-value="${id}"]`;
  const groupChoice=id=>`${field("source-group")}[data-definition-value="${id}"]`;
  const focus=async selector=>assert.equal(await at(selector).first().evaluate(el=>el.getRootNode().activeElement===el),true,`${selector} should retain focus`);
  const reset=async()=>{await page.goto("about:blank");Object.assign(lab,await call("homeostatic_ui_lab/control",{action:"reset"}));await clean();};
  const setup=async mutate=>{await page.goto("about:blank");const config=await call("homeostatic/configuration");const settings=structuredClone(config.settings);mutate(settings);await call("homeostatic/save_settings",{revision:config.revision,settings});await noChange(settings);await clean();return settings;};
  const test=async(id,body)=>run(id,async()=>{await reset();return body();});
  const expectPolicy=async(before,id,expected)=>{const next=structuredClone(before),index=next.monitoring_policies.findIndex(p=>p.id===id);if(expected!==null){expected=structuredClone(expected);for(const values of Object.values(expected.match))values.sort();for(const key of ["included_sources","excluded_sources"])expected[key]?.sort();}if(expected===null)next.monitoring_policies.splice(index,1);else if(index<0)next.monitoring_policies.push(expected);else next.monitoring_policies[index]=expected;await noChange(next);return next;};
  const savePolicy=async(before,id,expected)=>{const requests=transport.saveRequests;await save();assert.equal(transport.saveRequests,requests+1);return expectPolicy(before,id,expected);};
  const removeRows=async()=>{while(await at(action("remove-row")).count())await click(action("remove-row"));};
  const rows=()=>at('.policy-notification-row [data-row-field="profile"]').evaluateAll(els=>els.map(el=>({id:el.dataset.rowId,profile:el.value})));
  const waitError=()=>at(".config-error").filter({hasText:"Acceptance transport rejected"}).waitFor();
  const companion=async()=>{await edit("profiles","morning");await fill(field("name"),"Unrelated notification draft");};
  const checkCompanion=async()=>{await edit("profiles","morning");assert.equal(await name(),"Unrelated notification draft");};
  const waitCatalog=()=>at(`${field("source-choice")}`).first().waitFor();
  const invalid=async(before,selector,value)=>{const requests=transport.saveRequests;await fill(selector,value);await click(action("save-scoped"));assert.equal(transport.saveRequests,requests,"Invalid form must not submit");assert.equal(await at(selector).inputValue(),String(value));assert.ok(!await at(selector).evaluate(el=>el.validity.valid)||await at('[aria-invalid="true"]').count()>0);await noChange(before);};
  const observeRequest=type=>{
    let resolve,settled=false;const outcome=new Promise(done=>{resolve=done;});
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);page.off("close",closed);if(transport.interceptRequest===handler)transport.interceptRequest=null;resolve(result);};
    const handler=request=>{if(request.type===type)finish({request});return false;};
    const closed=()=>finish({error:Error(`Page closed while waiting for ${type}`)});
    const timer=setTimeout(()=>finish({error:Error(`No ${type} request within 30 seconds`)}),30000);timer.unref?.();
    transport.interceptRequest=handler;page.once("close",closed);if(page.isClosed())closed();
    // The stored outcome never rejects before the caller finishes its action.
    return async()=>{const result=await outcome;if(result.error)throw result.error;return result.request;};
  };

  await test("policies.not-provided",async()=>{
    const before=await snapshot(),id=await addPolicy("entity_not_provided","Missing diagnostic readings"),duration=field("parameters:duration_seconds");
    assert.equal(await at(duration).inputValue(),"24");assert.equal(await at(field("enabled")).isChecked(),false);
    assert.equal(await at(field("entity-choice")).count(),0,"Entity tree starts collapsed");
    const identity=key=>`entity:registry:${lab.registry_ids[key]}`,choice=key=>`${field("entity-choice")}[data-definition-value="${identity(key)}"]`;
    await fill(field("entity-search"),lab.entities.diagnostic);await at(choice("diagnostic")).waitFor();assert.equal(await at(choice("diagnostic")).isChecked(),true);assert.equal(await at(choice("diagnostic")).isDisabled(),false,"Enabled diagnostics are eligible");
    await fill(field("entity-search"),lab.entities.disabled);assert.equal(await at(choice("disabled")).isDisabled(),true,"Disabled registrations cannot be selected");
    await fill(field("entity-search"),lab.entities.offline);await check(choice("offline"),false);await check(field("enabled"),true);
    await invalid(before,duration,"-1");await fill(duration,"2");
    const count=transport.saveRequests;transport.mode="reject";await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,count+1);await noChange(before);assert.equal(await at(duration).inputValue(),"2");assert.equal(await at(choice("offline")).isChecked(),false);
    await save();const saved=await snapshot(),created=policy(saved,id);assert.equal(created.name,"Missing diagnostic readings");assert.equal(created.enabled,true);assert.equal(created.check,"entity_not_provided");assert.deepEqual(created.match,{kind:["entity"]});assert.deepEqual(created.parameters,{duration_seconds:7200});assert.deepEqual(created.excluded_sources,[identity("offline")]);await expectPolicy(before,id,created);
    await edit("policies",id);assert.equal(await at(duration).inputValue(),"2");await fill(field("entity-search"),lab.entities.offline);assert.equal(await at(choice("offline")).isChecked(),false);await fill(duration,"3");await discard();assert.equal(await at(duration).inputValue(),"2");await noChange(saved);
    assert.equal(await at('[data-delete-entity],[data-cleanup-entity]').count(),0);return "Added the separate policy through rendered controls, selected enabled diagnostic and excluded exact entity, rejected disabled selection/negative duration, retained failed-save draft, saved 7200 seconds with unrelated settings intact, reopened membership and discarded a later duration edit.";
  });

  await test("policies.availability-create",async()=>{
    const initial=await snapshot();await companion();
    const id=await addPolicy("entity","Focused availability"),duration=field("parameters:duration_seconds"),identity=`entity:registry:${lab.registry_ids.offline}`,choice=`${field("entity-choice")}[data-definition-value="${identity}"]`;
    assert.equal(await at(field("enabled")).isChecked(),false);assert.equal(await at(duration).inputValue(),"0");
    await at(field("entity-integration")).first().waitFor();assert.equal(await at(`${field("entity-integration")}:checked`).count(),0);assert.equal(await at(`${field("entity-integration")}[aria-checked="mixed"]`).count(),0);
    assert.match(await bodyText(),/New entities start unchecked/);await fill(field("entity-search"),lab.entities.offline);await at(choice).waitFor();assert.equal(await at(choice).isChecked(),false);await noChange(initial);
    await save();let saved=await snapshot(),created=policy(saved,id);assert.equal(created.enabled,false);assert.deepEqual(created.match,{kind:["entity"],entity:[]});assert.deepEqual(created.parameters,{});assert.equal(created.included_sources,undefined);await expectPolicy(initial,id,created);
    await edit("policies",id);await fill(field("entity-search"),lab.entities.offline);assert.equal(await at(choice).isChecked(),false);
    await at(choice).focus();await page.keyboard.press("Space");await focus(choice);assert.equal(await at(choice).isChecked(),true);await fill(duration,"5");
    const overlap=`${action("open-policy")}[data-definition-id="default_entities"]`;await at(overlap).waitFor();assert.match(await bodyText(),/Other enabled policies also monitor selected entities/);
    await click(overlap);assert.equal(await currentId(),"default_entities");await noChange(saved);
    await edit("policies",id);assert.equal(await at(duration).inputValue(),"5");await fill(field("entity-search"),lab.entities.offline);assert.equal(await at(choice).isChecked(),true);
    saved=await savePolicy(saved,id,{...created,parameters:{duration_seconds:300},included_sources:[identity]});
    await menu("policies",id,"duplicate");const copy=await currentId();assert.notEqual(copy,id);assert.equal(await at(field("enabled")).isChecked(),false);assert.equal(await at(duration).inputValue(),"5");await fill(field("entity-search"),lab.entities.offline);assert.equal(await at(choice).isChecked(),true);
    saved=await savePolicy(saved,copy,{...policy(saved,id),id:copy,name:"Focused availability copy",enabled:false});await checkCompanion();await noChange(saved);
    await clean();await edit("policies",id);assert.equal(await at(duration).inputValue(),"5");await fill(field("entity-search"),lab.entities.offline);assert.equal(await at(choice).isChecked(),true);await noChange(saved);
    for(const [category,label,scope] of [["cameras","Cameras",{domain:["camera"]}],["locks","Locks",{domain:["lock"]}],["alarm_panels","Alarm panels",{domain:["alarm_control_panel"]}],["safety_sensors","Safety sensors",{domain:["binary_sensor"],device_class:["smoke","carbon_monoxide","gas","moisture"]}]]){
      await listing("policies");await click(`${action("add")}[data-definition-kind="policies"]`);await choose('[data-definition-template]',"entity");await choose('[data-definition-category]',category);await click(action("create"));
      const focused=await currentId();assert.equal(await at(field("enabled")).isChecked(),false);assert.equal(await at(field("source-future")).inputValue(),"selected");assert.equal(await at(`${field("source-choice")}:checked`).count(),0);assert.equal(await at('.entity-selection-tree').count(),0);assert.ok((await bodyText()).includes(label));
      await fill(field("name"),`Renamed ${category}`);await save();const created=policy(await snapshot(),focused);assert.deepEqual(created.match,{kind:["entity"],...Object.fromEntries(Object.entries(scope).map(([field,values])=>[field,[...values].sort()])),entity:[]});assert.equal(created.enabled,false);await expectPolicy(saved,focused,created);saved=await snapshot();
      await edit("policies",focused);assert.equal(await at(field("source-future")).inputValue(),"selected");assert.equal(await at('.entity-selection-tree').count(),0);assert.ok((await bodyText()).includes(label));
      await menu("policies",focused,"duplicate");const duplicate=await currentId();await save();const copied=policy(await snapshot(),duplicate);assert.deepEqual(copied.match,created.match);assert.equal(copied.enabled,false);await expectPolicy(saved,duplicate,copied);saved=await snapshot();
    }
    await clean();await edit("policies",saved.monitoring_policies.find(item=>item.name==="Renamed safety_sensors").id);assert.ok((await bodyText()).includes("Safety sensors"));assert.equal(await at('.entity-selection-tree').count(),0);await noChange(saved);
    return "Rendered Add creates disabled empty policies; general entities retain their tree, keyboard membership, overlaps and five-minute wait. All four focused source categories use flat lists and preserve their metadata after zero-selection save, arbitrary renaming, disabled duplication and full reload. Complete unrelated settings and an independent notification draft remain intact.";
  });

  await test("policies.availability-wait",async()=>{
    let saved=await setup(settings=>{delete policy(settings,"default_entities").parameters.duration_seconds;});await companion();
    const id="default_entities",duration=field("parameters:duration_seconds"),unit=field("duration-unit:duration_seconds");await edit("policies",id);
    assert.equal(await at(duration).inputValue(),"0");assert.equal(await at(action("save-scoped")).count(),0);await choose(unit,"hours");assert.equal(await at(action("save-scoped")).count(),0);await noChange(saved);
    await fill(field("name"),"Existing availability renamed");saved=await savePolicy(saved,id,{...policy(saved,id),name:"Existing availability renamed"});assert.deepEqual(policy(saved,id).parameters,{});
    await choose(unit,"minutes");await fill(duration,"1.5");await focus(duration);assert.match(await at('.policy-rule').innerText(),/90 seconds/);
    saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{duration_seconds:90}});await edit("policies",id);assert.equal(await at(duration).inputValue(),"1.5");
    await listing("policies");assert.match(await at('.definition-list-item').filter({has:page.locator(`${action("edit")}[data-definition-id="${id}"]`)}).innerText(),/Unavailable for at least 90 seconds/);await edit("policies",id);
    await choose(unit,"seconds");assert.equal(await at(duration).inputValue(),"90");assert.equal(await at(action("save-scoped")).count(),0);
    for(const value of ["","-1","0.5","31536001"]){await invalid(saved,duration,value);assert.match(await bodyText(),/whole number of seconds/);}
    await discard();assert.equal(await at(duration).inputValue(),"90");assert.equal(await at('[aria-invalid="true"]').count(),0);await noChange(saved);
    await fill(duration,"120");transport.mode="reject";const requests=transport.saveRequests;await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,requests+1);assert.equal(await at(duration).inputValue(),"120");await noChange(saved);
    await discard();assert.equal(await at(duration).inputValue(),"90");await fill(duration,"120");transport.mode="reject";await click(action("save-scoped"));await waitError();await noChange(saved);
    saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{duration_seconds:120}});await fill(duration,"0");saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{duration_seconds:0}});await checkCompanion();await noChange(saved);
    await clean();await edit("policies",id);assert.equal(await at(duration).inputValue(),"0");assert.match(await at('.policy-rule').innerText(),/without waiting/);await noChange(saved);
    for(const selector of [duration,unit])assert.equal(await at(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),true,"Availability timing controls fit their policy editor");
    return "Legacy absent duration remains effective zero and is not inserted on a rename. Minutes save exactly 90 seconds and reopen with a truthful list summary; units alone do not dirty settings. Blank, negative, fractional and excessive seconds never submit. Rejected saves retain the draft, discard restores it, explicit retry saves once and zero remains immediate after reload; complete unrelated settings and another editor's draft remain intact.";
  });

  await test("policies.lifecycle",async()=>{
    const initial=await snapshot();await companion();
    const custom=await addPolicy("entity","Lifecycle custom");await check(field("enabled"),true);await save();
    let saved=await snapshot();const created=policy(saved,custom);
    assert.equal(created.name,"Lifecycle custom");assert.equal(created.enabled,true);assert.equal(created.check,"availability");assert.deepEqual(created.match,{kind:["entity"],entity:[]});
    await expectPolicy(initial,custom,created);
    for(const id of [custom,"default_batteries"]){
      const original=policy(saved,id);await edit("policies",id);await fill(field("name"),`${original.name} edited`);await check(field("enabled"),!original.enabled);
      saved=await savePolicy(saved,id,{...original,name:`${original.name} edited`,enabled:!original.enabled});
      await edit("policies",id);assert.equal(await name(),`${original.name} edited`);assert.equal(await at(field("enabled")).isChecked(),!original.enabled);
      await fill(field("name"),"Discard this exact policy draft");await check(field("enabled"),original.enabled);await discard();assert.equal(await name(),`${original.name} edited`);assert.equal(await at(field("enabled")).isChecked(),!original.enabled);await noChange(saved);
      await menu("policies",id,"duplicate");const copy=await currentId();assert.notEqual(copy,id);await fill(field("name"),`${original.name} independent copy`);await check(field("enabled"),true);await noChange(saved);
      saved=await savePolicy(saved,copy,{...policy(saved,id),id:copy,name:`${original.name} independent copy`,enabled:true});
      await edit("policies",copy);assert.equal(await name(),`${original.name} independent copy`);
      for(const target of [copy,id]){await menu("policies",target,"delete");await click(action("cancel-delete"));await noChange(saved);await menu("policies",target,"delete");await deleteConfirm();saved=await expectPolicy(saved,target,null);}
    }
    await checkCompanion();await noChange(saved);
    return "Custom and supplied policies: exact add/edit/enable/disable/duplicate/discard/delete/cancel effects; full installation snapshots and independent notification draft checked.";
  });

  await test("policies.delete-visible",async()=>{
    const id="lab_delete_visible",before=await setup(settings=>{
      const example={id,name:"Delete visibility target",check:"availability",match:{kind:["entity"],entity:[]},parameters:{},enabled:false,notifications:[]};
      settings.monitoring_policies.unshift(example);
      for(let index=0;index<20;index++)settings.monitoring_policies.push({...structuredClone(example),id:`lab_delete_filler_${index}`,name:`Visibility filler ${index}`});
    });
    const editTarget=`${action("edit")}[data-definition-kind="policies"][data-definition-id="${id}"]`,prompt='.settings-preview[aria-label="Confirm deletion"]';
    const inViewport=async selector=>{
      const geometry=await at(selector).evaluate(element=>{
        const root=element.getRootNode(),rect=element.getBoundingClientRect(),viewport=window.visualViewport;
        const top=Math.max(viewport?.offsetTop||0,root.querySelector('.shell > .header')?.getBoundingClientRect().bottom||0),left=viewport?.offsetLeft||0,bottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight),right=left+(viewport?.width||innerWidth);
        const hit=root.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,viewport:{top,bottom,left,right},inside:rect.top>=top-1&&rect.bottom<=bottom+1&&rect.left>=left-1&&rect.right<=right+1,uncovered:hit===element||element.contains(hit)};
      });
      assert.equal(geometry.inside,true,`${selector} must already fit the visible viewport: ${JSON.stringify(geometry)}`);assert.equal(geometry.uncovered,true,`${selector} must not be obscured`);
    };
    const opened=async()=>{
      await menu("policies",id,"delete");await at(prompt).waitFor({state:"visible"});
      await at(prompt).evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      // Geometry checks precede any confirmation-control interaction: locator.click would auto-scroll and hide the regression.
      for(const selector of [`${prompt} h3`,`${prompt} ${action("confirm-delete")}`,`${prompt} ${action("cancel-delete")}`])await inViewport(selector);
      await focus(`${prompt} ${action("cancel-delete")}`);await noChange(before);
    };
    await opened();await page.screenshot({path:`${ctx.artifactDir}/policy-delete-confirmation-${page.viewportSize().width}.png`,fullPage:false});
    await page.keyboard.press("Enter");assert.equal(await at(prompt).count(),0);await noChange(before);await focus(editTarget);await inViewport(editTarget);
    await opened();await deleteConfirm();await expectPolicy(before,id,null);
    return `From an early row in a long policy list, the confirmation heading and both buttons are immediately visible and unobscured at ${page.viewportSize().width}×${page.viewportSize().height}, before any locator could auto-scroll them. Cancel has focus, Enter saves nothing and returns to the visible original Edit policy control. Reopened confirmation deletes only that disabled target; complete unrelated settings are preserved.`;
  });

  await test("policies.entity-selection",async()=>{
    const before=await snapshot(),id="default_entities",original=policy(before,id),source=`entity:registry:${lab.registry_ids.offline}`;
    await edit("policies",id);await at('.entity-selection-tree > li > .entity-selection-branch > .entity-selection-toggle').first().waitFor();
    assert.equal(await at(field("entity-choice")).count(),0);
    await at('.entity-selection-tree > li > .entity-selection-branch > .entity-selection-toggle').first().click();
    assert.equal(await at(field("entity-choice")).count(),0);
    await at('.entity-selection-tree > li > .entity-selection-children > li > .entity-selection-branch > .entity-selection-toggle').first().click();
    assert.ok(await at(field("entity-choice")).count()>0);await noChange(before);
    await fill(field("entity-search"),lab.entities.offline);
    const checkbox=`${field("entity-choice")}[data-definition-value="${source}"]`;
    await at(checkbox).waitFor();const wasChecked=await at(checkbox).isChecked();
    const matching=await at(`${field("entity-choice")}:not(:disabled)`).evaluateAll(elements=>elements.map(element=>element.dataset.definitionValue));
    const integration=field("entity-integration"),device=field("entity-group");
    await at(device).click();assert.equal(await at(checkbox).isChecked(),!wasChecked);
    await at(integration).click();assert.equal(await at(checkbox).isChecked(),wasChecked);
    await at(integration).focus();await page.keyboard.press("Space");await focus(integration);
    assert.equal(await at(checkbox).isChecked(),!wasChecked);
    const expected=structuredClone(original);
    assert.deepEqual(original.match,{kind:["entity"]});
    expected.excluded_sources=(original.excluded_sources||[]).filter(id=>!matching.includes(id));
    if(wasChecked)expected.excluded_sources.push(...matching);
    if(!expected.excluded_sources.length)delete expected.excluded_sources;
    expected.included_sources=(original.included_sources||[]).filter(id=>!matching.includes(id));
    if(!expected.included_sources.length)delete expected.included_sources;
    const saved=await savePolicy(before,id,expected);await edit("policies",id);await fill(field("entity-search"),lab.entities.offline);
    assert.equal(await at(checkbox).isChecked(),!wasChecked);await noChange(saved);
    await page.screenshot({path:`${ctx.artifactDir}/entity-selection.png`,fullPage:false});
    await at(checkbox).click();await discard();assert.equal(await at(checkbox).isChecked(),!wasChecked);
    return "Collapsed branches open without changing saved settings; filtered device and integration checkboxes change the displayed matches. Keyboard bulk selection saves and reopens the complete filtered membership, preserves future selectors and discards only this policy.";
  });

  await test("policies.scope",async()=>{
    const id="lab_temperature",before=await snapshot(),reference=`registry:${lab.registry_ids.temperature}`,source=`entity:${reference}`;
    await page.goto("about:blank");transport.commandModes.set("homeostatic/catalog","hold");const requested=observeRequest("homeostatic/catalog");await clean();await edit("policies",id);await requested();
    assert.match(await bodyText(),/Loading available sources/);assert.match(await bodyText(),new RegExp(source));
    assert.doesNotMatch(await bodyText(),/No temperature sensors available|No temperature sensors match/);assert.equal(await at(`[data-definition-field="source-forget"][data-definition-value="${source}"]`).isDisabled(),true);await noChange(before);
    transport.release("reject");await at('[data-action="retry-catalog"]').waitFor();assert.match(await bodyText(),/Could not load available sources/);await noChange(before);
    await click('[data-action="retry-catalog"]');await at(`${selection(source)}:not(:disabled)`).waitFor();assert.equal(await at(selection(source)).isChecked(),true);
    await check(selection(source),false);let requests=transport.saveRequests;await click(action("save-scoped"));assert.equal(transport.saveRequests,requests);assert.match(await bodyText(),/Choose at least one/);await noChange(before);await discard();
    const broadMatch={...policy(before,id).match};delete broadMatch.entity;
    await choose(field("source-future"),"all");let saved=await savePolicy(before,id,{...policy(before,id),match:broadMatch});await edit("policies",id);
    await fill(field("source-search"),lab.entities.temperature);await check(selection(source),false);assert.equal(await at(selection(source)).isChecked(),false,"Unchecked always means unmonitored");
    saved=await savePolicy(saved,id,{...policy(saved,id),excluded_sources:[source]});await edit("policies",id);await fill(field("source-search"),"");
    const monitored=await at(`${field("source-choice")}:checked`).evaluateAll(elements=>elements.map(element=>element.dataset.definitionValue.slice(7)).sort());assert.ok(monitored.length>1);assert.ok(!monitored.includes(reference));
    await choose(field("source-future"),"selected");assert.equal(await at(`${field("source-choice")}:checked`).count(),monitored.length,"Turning off future inclusion keeps present coverage");
    saved=await savePolicy(saved,id,{...policy(saved,id),match:{...broadMatch,entity:monitored}});await edit("policies",id);assert.equal(await at(field("source-future")).inputValue(),"selected");
    await fill(field("source-search"),source);await check(selection(source),true);await check(field("source-selected-only"),true);assert.equal(await at(field("source-choice")).count(),1);await fill(field("source-search"),"no-such-lab-source");assert.equal(await at(field("source-choice")).count(),0);assert.match(await bodyText(),/match your selection or search/);await fill(field("source-search"),source);assert.equal(await at(selection(source)).isChecked(),true);
    const expected={...policy(saved,id),match:{...broadMatch,entity:[...monitored,reference]}};delete expected.excluded_sources;saved=await savePolicy(saved,id,expected);await edit("policies",id);await noChange(saved);
    return "Real catalog held, rejected and retried; saved identity remains visible and read-only until complete. Explicit and future scope save exactly; checked always means monitored, canonical exclusions persist, filters preserve selections and empty temperature scope is blocked.";
  });

  await test("policies.picker-context",async()=>{
    await companion();const before=await snapshot(),id="lab_temperature";await edit("policies",id);await waitCatalog();
    await fill(field("source-search"),"Lab identical temperature");assert.equal(await at(field("source-choice")).count(),2);
    const duplicates=await at(field("source-choice")).evaluateAll(elements=>elements.map(element=>element.closest("label").textContent));for(const text of duplicates){assert.match(text,/Office/);assert.match(text,/Ground floor/);}assert.notEqual(duplicates[0],duplicates[1]);
    const chosen=`registry:${lab.registry_ids.temperature_0}`;await check(selection(`entity:${chosen}`),true);await check(field("source-selected-only"),true);assert.equal(await at(field("source-choice")).count(),1);await fill(field("source-search"),"unmatched source");assert.equal(await at(field("source-choice")).count(),0);await fill(field("source-search"),"Office");assert.equal(await at(selection(`entity:${chosen}`)).isChecked(),true);
    let saved=await savePolicy(before,id,{...policy(before,id),match:{entity:[`registry:${lab.registry_ids.temperature}`,chosen]}});
    for(const [mode,collection,relevant,empty,expectedCount] of [["area",lab.areas,"Office","Future room",23],["label",lab.labels,"Lab temperature","Future equipment",45]]){
      await edit("policies",id);await choose(field("source-future"),mode);await fill(field("source-search"),"");await check(field("source-selected-only"),false);
      const relevantChoice=at(groupChoice(collection[relevant]));
      assert.match(await relevantChoice.evaluate(element=>element.closest("label").textContent),new RegExp(`${expectedCount} eligible temperature sensors`));
      assert.equal(await at(groupChoice(collection[empty])).count(),0);await check(field("source-show-all"),true);assert.match(await at(groupChoice(collection[empty])).evaluate(element=>element.closest("label").textContent),/0 eligible temperature sensors/);
      await check(groupChoice(collection[empty]),true);await check(groupChoice(collection[relevant]),true);await check(field("source-show-all"),false);assert.equal(await at(groupChoice(collection[empty])).isChecked(),true,"Selected empty groups remain removable");
      assert.equal(await at(field("source-choice")).count(),expectedCount,"The current list follows the selected future group scope");
      const match={...policy(saved,id).match};delete match.entity;delete match.area;delete match.label;match[mode]=[collection[empty],collection[relevant]];
      const expected={...policy(saved,id),match};saved=await savePolicy(saved,id,expected);await edit("policies",id);assert.equal(await at(groupChoice(collection[empty])).isChecked(),true);
    }
    await checkCompanion();await noChange(saved);
    return "Inline duplicate names retain distinct identities and location/floor. Area and label groups expose empty future groups directly; each current source list matches its selected groups and group scope preserves future coverage and saved empty groups, with unrelated drafts retained.";
  });

  await test("policies.detection",async()=>{
    let saved=await snapshot();
    for(const type of ["integration","entity","battery","vacuum","repair","broken_automation","thermostat","temperature_limit","ups_power","ups_reserve","ups_battery_replacement","ups_fault"]){
      const id=await addPolicy(type,`Detection ${type}`);const expected={id,name:`Detection ${type}`,check:["integration","entity"].includes(type)?"availability":type,match:{kind:[["integration","entity"].includes(type)?type:type.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(type)?"entity":type]},parameters:{},enabled:false};
      if(type==="entity")expected.match.entity=[];
      if(type==="battery"){for(const bad of ["-1","101","25.5"])await invalid(saved,field("parameters:threshold"),bad);await fill(field("parameters:threshold"),"25");expected.parameters={threshold:25};}
      if(type==="thermostat"){
        for(const key of ["margin","progress","worsening","progress_seconds"])await invalid(saved,field(`parameters:${key}`),"-1").then(()=>fill(field(`parameters:${key}`),key==="progress_seconds"?"120":"9"));
        await choose(field("parameters:unit"),"°C");for(const key of ["margin","progress","worsening"])assert.equal(Number(await at(field(`parameters:${key}`)).inputValue()),5);
        await choose(field("parameters:unit"),"K");expected.parameters={unit:"K",margin:5,progress:5,worsening:5,progress_seconds:120};
      }
      if(type==="temperature_limit"){await fill(field("parameters:minimum"),"32");await fill(field("parameters:maximum"),"212");await choose(field("parameters:unit"),"°C");assert.equal(await at(field("parameters:minimum")).inputValue(),"0");assert.equal(await at(field("parameters:maximum")).inputValue(),"100");await choose(field("parameters:unit"),"K");expected.parameters={unit:"K",minimum:273.15,maximum:373.15,duration_seconds:0};}
      if(type==="ups_reserve"){
        await at(field("parameters:charge_low")).waitFor();for(const [key,value] of [["charge_low",25],["charge_clear",35],["runtime_low_minutes",4.5],["runtime_clear_minutes",7.5]]){await invalid(saved,field(`parameters:${key}`),"-1");await fill(field(`parameters:${key}`),value);expected.parameters[key]=value;}expected.parameters.replace_battery_check=false;
      }
      expected.notifications=(await rows()).map(row=>type==="ups_reserve"?{...row,when:null}:row);
      if(type==="ups_reserve")for(const row of expected.notifications)row.when=await at(`[data-row-id="${row.id}"][data-row-field="when"]`).inputValue();
      saved=await savePolicy(saved,id,expected);await edit("policies",id);assert.equal(await name(),expected.name);assert.equal(await at(field("enabled")).isChecked(),false);
      for(const [key,value] of Object.entries(expected.parameters).filter(([key])=>key!=="replace_battery_check"))assert.equal(Number.isFinite(value)?Number(await at(field(`parameters:${key}`)).inputValue()):await at(field(`parameters:${key}`)).inputValue(),value);
      if(type==="ups_reserve")for(const [values,message] of [[{charge_low:101,charge_clear:102},/valid nonnegative UPS threshold/],[{charge_clear:20},/recovery threshold must exceed/],[{charge_clear:""},/both raise and clear/],[{runtime_low_minutes:525601,runtime_clear_minutes:525602},/valid nonnegative UPS threshold/]]){
        for(const [key,value] of Object.entries(values))await fill(field(`parameters:${key}`),value);const requests=transport.saveRequests;await click(action("save-scoped"));await at('.config-error').filter({hasText:message}).waitFor();assert.equal(transport.saveRequests,requests+1);await noChange(saved);for(const [key,value] of Object.entries(values))assert.equal(await at(field(`parameters:${key}`)).inputValue(),String(value));await discard();
      }
      await menu("policies",id,"delete");await deleteConfirm();saved=await expectPolicy(saved,id,null);
    }
    return "All 13 policy types created/reopened/deleted with exact check, scope, parameters and notifications; every detection numeric field boundary blocked before submission; absolute and difference temperature units converted.";
  });

  await test("policies.temperature-detection",async()=>{
    let saved=await snapshot();const id="lab_temperature";await edit("policies",id);
    for(const limits of [{minimum:41},{maximum:90},{minimum:50,maximum:85}]){
      await fill(field("parameters:minimum"),limits.minimum??"");await fill(field("parameters:maximum"),limits.maximum??"");await choose(field("duration-unit:duration_seconds"),"hours");await fill(field("parameters:duration_seconds"),"1.25");
      const expected={...policy(saved,id),parameters:{unit:"°F",minimum:null,maximum:null,...limits,duration_seconds:4500}};saved=await savePolicy(saved,id,expected);await edit("policies",id);await choose(field("duration-unit:duration_seconds"),"minutes");assert.equal(Number(await at(field("parameters:duration_seconds")).inputValue()),75);assert.equal(await at(action("save-scoped")).count(),0);await noChange(saved);
    }
    await fill(field("parameters:minimum"),"");await invalid(saved,field("parameters:maximum"),"");assert.match(await bodyText(),/at least one limit/);
    await fill(field("parameters:maximum"),"45");await invalid(saved,field("parameters:minimum"),"60");assert.match(await bodyText(),/less than or equal/);
    await fill(field("parameters:minimum"),"40");await choose(field("duration-unit:duration_seconds"),"seconds");
    for(const value of ["-1","0.5","31536001"])await invalid(saved,field("parameters:duration_seconds"),value);
    await fill(field("parameters:duration_seconds"),"1");await check(field("enabled"),false);saved=await savePolicy(saved,id,{...policy(saved,id),enabled:false,parameters:{unit:"°F",minimum:40,maximum:45,duration_seconds:1}});
    await check(field("enabled"),true);saved=await savePolicy(saved,id,{...policy(saved,id),enabled:true});assert.equal(saved.notifications,false);assert.equal(await at('[data-notifications-switch]').isChecked(),false);
    return "Lower-only, upper-only and paired limits persist; 1.25 hours equals exactly 4500 seconds; display-only unit change stays clean; absent/reversed bounds and invalid durations blocked; monitoring toggle leaves sending off.";
  });

  await test("policies.temperature-save",async()=>{
    await companion();let saved=await snapshot();const id="lab_temperature";await edit("policies",id);await fill(field("parameters:minimum"),"44");await fill(field("parameters:maximum"),"99");await choose(field("duration-unit:duration_seconds"),"seconds");await fill(field("parameters:duration_seconds"),"77");
    saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{unit:"°F",minimum:44,maximum:99,duration_seconds:77}});await edit("policies",id);assert.equal(await at(field("parameters:minimum")).inputValue(),"44");assert.equal(await at(field("parameters:duration_seconds")).inputValue(),"77");
    await fill(field("parameters:minimum"),"45");await fill(field("parameters:maximum"),"100");transport.mode="reject";let requests=transport.saveRequests;await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,requests+1);assert.equal(await at(field("parameters:minimum")).inputValue(),"45");assert.equal(await at(field("parameters:maximum")).inputValue(),"100");await noChange(saved);
    await discard();assert.equal(await at(field("parameters:minimum")).inputValue(),"44");assert.equal(await at(field("parameters:maximum")).inputValue(),"99");await noChange(saved);await checkCompanion();
    await edit("policies",id);await fill(field("parameters:minimum"),"46");transport.mode="reject";await click(action("save-scoped"));await waitError();await noChange(saved);saved=await savePolicy(saved,id,{...policy(saved,id),parameters:{...policy(saved,id).parameters,minimum:46}});
    await checkCompanion();await clean();await edit("policies",id);assert.equal(await at(field("parameters:minimum")).inputValue(),"46");await noChange(saved);
    return "Exact temperature fields reopen after save and full reload; rejected save retains all edited values, discard restores saved values, explicit retry submits once; independent notification draft was preserved unsaved through save/failure/discard.";
  });

  await test("policies.temperature-picker",async()=>{
    const before=await snapshot(),id="lab_temperature";await edit("policies",id);await waitCatalog();await fill(field("source-search"),"Lab temperature reading");
    const choices=at(field("source-choice"));assert.ok(await choices.count()>=40);const target=choices.nth(35),value=await target.getAttribute("data-definition-value");await target.scrollIntoViewIfNeeded();
    const top=await target.evaluate(element=>element.getBoundingClientRect().top);await target.check();
    assert.equal(await at(field("source-search")).inputValue(),"Lab temperature reading");await focus(selection(value));assert.ok(Math.abs(await at(selection(value)).evaluate(element=>element.getBoundingClientRect().top)-top)<2,"Selection retains reading position");
    const context=await at(selection(value)).evaluate(element=>element.closest("label").textContent);assert.match(context,/Office|Upstairs/);
    assert.equal(await at('[data-definition-action="pick"],[data-definition-action="finish-pick"],.policy-picker-options').count(),0,"Inline selection adds no picker, Done or nested scroll area");
    for(const selector of [field("source-search"),field("source-future"),field("source-choice")]){
      const boxes=await at(selector).evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,overflow:el.scrollWidth>el.clientWidth+1};}));for(const box of boxes){assert.ok(box.left>=-1&&box.right<=page.viewportSize().width+1,`${selector} fits viewport`);assert.ok(!box.overflow,`${selector} needs no horizontal scroll`);}
    }
    await savePolicy(before,id,{...policy(before,id),match:{entity:[...policy(before,id).match.entity,value.slice(7)]}});await edit("policies",id);await fill(field("source-search"),"Lab temperature reading");assert.equal(await at(selection(value)).isChecked(),true);
    return `Real inline temperature selection retains checkbox focus, search and reading position, saves and reopens exactly, and fits ${page.viewportSize().width}×${page.viewportSize().height} without nested scrolling. Theme/layout matrix is recorded by the runner.`;
  });

  await test("policies.restore",async()=>{
    const initial=await setup(settings=>{settings.monitoring_policies=settings.monitoring_policies.filter(p=>!["default_batteries","default_vacuums"].includes(p.id));delete settings.notification_definitions.profiles.morning;for(const p of settings.monitoring_policies)p.notifications=p.notifications.filter(row=>row.profile!=="morning");});
    await listing("policies");await click(action("restore"));assert.equal(await at('[data-definition-restore]').count(),2);await check('[data-definition-restore="default_batteries"]',true);await click(action("cancel-restore"));await noChange(initial);assert.equal(await at(`${action("edit")}[data-definition-id="default_batteries"]`).count(),0);
    await click(action("restore"));await check('[data-definition-restore="default_batteries"]',true);await click(action("confirm-restore"));await noChange(initial);assert.equal(await at(`${action("edit")}[data-definition-id="default_batteries"]`).count(),1);assert.equal(await at(`${action("edit")}[data-definition-id="default_vacuums"]`).count(),0);
    await edit("policies","default_batteries");const draftRows=await rows();assert.ok(draftRows.every(row=>row.profile!=="morning"));await save();const saved=await snapshot(),restored=policy(saved,"default_batteries");assert.ok(restored);assert.deepEqual(restored.notifications,draftRows);await expectPolicy(initial,restored.id,restored);assert.ok(!saved.notification_definitions.profiles.morning);
    return "From two missing defaults and a missing referenced notification: cancel writes nothing; confirm stages only selected default; one scoped save restores it without dangling profile or resurrecting the other default/profile.";
  });

  await test("policies.notification",async()=>{
    await companion();let saved=await snapshot();const id="lab_temperature";await edit("policies",id);assert.equal(await at('.policy-notification-add select').inputValue(),"");const oldRows=policy(saved,id).notifications;
    await choose('.policy-notification-add select',"urgent");const added=(await rows()).at(-1);assert.equal(await at('.policy-notification-add select').inputValue(),"");await focus(`[data-row-field="profile"][data-row-id="${added.id}"]`);await choose(`[data-row-field="profile"][data-row-id="${added.id}"]`,"weekly");
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[...oldRows,{id:added.id,profile:"weekly"}]});await edit("policies",id);assert.deepEqual(await rows(),policy(saved,id).notifications);
    await removeRows();await focus('.policy-notification-add select');assert.match(await bodyText(),/No notifications/);transport.mode="reject";let requests=transport.saveRequests;await click(action("save-scoped"));await waitError();assert.equal(transport.saveRequests,requests+1);assert.deepEqual(await rows(),[]);await noChange(saved);
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[]});await edit("policies",id);assert.deepEqual(await rows(),[]);assert.match(await bodyText(),/No notifications/);await checkCompanion();await noChange(saved);
    return "Explicit add and replacement retain stable row identity and keyboard focus; removing last row, rejected save, one retry and reopen preserve empty notification assignment and all unrelated saved/draft settings.";
  });

  await test("policies.legacy",async()=>{
    const legacy={id:"legacy-lab-row",timing:{mode:"immediate"},methods:["lab_messages"]};let saved=await setup(settings=>{policy(settings,"lab_temperature").notifications=[legacy];});const id="lab_temperature";
    await edit("policies",id);assert.match(await at('.policy-notification-row').innerText(),/Custom notification/);assert.equal(await at('.policy-notification-row [data-row-field="profile"]').inputValue(),"");await fill(field("name"),"Legacy preserved on rename");saved=await savePolicy(saved,id,{...policy(saved,id),name:"Legacy preserved on rename"});assert.deepEqual(policy(saved,id).notifications,[legacy]);
    await edit("policies",id);await choose('.policy-notification-row [data-row-field="profile"]',"urgent");saved=await savePolicy(saved,id,{...policy(saved,id),notifications:[{id:legacy.id,profile:"urgent"}]});await edit("policies",id);assert.deepEqual(await rows(),[{id:legacy.id,profile:"urgent"}]);
    return "Legacy inline timing/method row remains byte-for-byte equivalent through rename; only explicit named replacement removes inline fields and preserves assignment ID.";
  });

  await test("policies.ups",async()=>{
    let saved=await snapshot();const id="lab_ups_reserve";await edit("policies",id);await removeRows();await choose('.policy-notification-add select',"morning");await choose('.policy-notification-add select',"urgent");const values=await rows();assert.equal(values.length,2);
    assert.equal(await at(`[data-row-id="${values[0].id}"][data-row-field="when"]`).inputValue(),"mains");assert.equal(await at(`[data-row-id="${values[1].id}"][data-row-field="when"]`).inputValue(),"backup");
    saved=await savePolicy(saved,id,{...policy(saved,id),notifications:values.map((row,i)=>({...row,when:i?"backup":"mains"}))});await edit("policies",id);
    await choose(`[data-row-id="${values[0].id}"][data-row-field="when"]`,"backup");await choose(`[data-row-id="${values[1].id}"][data-row-field="when"]`,"mains");await choose(`[data-row-id="${values[0].id}"][data-row-field="profile"]`,"evening");
    const expected=[{id:values[0].id,profile:"evening",when:"backup"},{id:values[1].id,profile:"urgent",when:"mains"}];saved=await savePolicy(saved,id,{...policy(saved,id),notifications:expected});await edit("policies",id);assert.deepEqual(await rows(),expected.map(({when,...row})=>row));for(const row of expected)assert.equal(await at(`[data-row-id="${row.id}"][data-row-field="when"]`).inputValue(),row.when);
    return "Two reserve conditions get independent mains/backup defaults; swapping both conditions and changing one notification preserves IDs, other condition and complete saved configuration.";
  });

  await test("settings.timing-only",async()=>{
    const before=await snapshot();await page.goto(`${lab.url}/homeostatic/settings/grouping`);
    await at('[data-setting-path="timings.clear_hold"]').waitFor();
    assert.equal(await at('main h1').innerText(),"Settings");
    assert.equal(await at('[data-settings-section], [data-setting-path="timings.coalesce_count"], [data-setting-path="timings.coalesce_window"]').count(),0);
    assert.ok((await bodyText()).includes("Timing"));await noChange(before);
    return "Legacy grouping link opens Timing; inactive controls are absent and browsing preserves all saved settings.";
  });
  await test("settings.edit",async()=>{
    const before=await snapshot();await companion();await edit("policies","lab_temperature");await fill(field("name"),"Unrelated policy draft");await edit("methods","lab_messages");await fill(field("name"),"Unrelated method draft");await go("configuration");
    await click('details[data-ui-key="settings-advanced-timing"] summary');const expected=structuredClone(before);
    const changeVisible=async()=>{for(const key of await at('[data-setting-path^="timings."]').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.dataset.settingPath))){const selector=`[data-setting-path="${key}"]`,scale=Number(await at(selector).getAttribute("data-setting-scale")||1),value=Number(await at(selector).inputValue())+1;await fill(selector,value);expected.timings[key.slice(8)]=value*scale;}};
    assert.equal(await at('[data-settings-section], [data-setting-path="timings.coalesce_count"], [data-setting-path="timings.coalesce_window"]').count(),0);
    await changeVisible();let requests=transport.saveRequests;await save();assert.equal(transport.saveRequests,requests+1);await noChange(expected);
    const timing='[data-setting-path="timings.clear_hold"]';await fill(timing,Number(await at(timing).inputValue())+1);await invalid(expected,timing,"-1");await discard();assert.equal(Number(await at(timing).inputValue())*Number(await at(timing).getAttribute("data-setting-scale")),expected.timings.clear_hold);await noChange(expected);
    await checkCompanion();await edit("policies","lab_temperature");assert.equal(await name(),"Unrelated policy draft");await edit("methods","lab_messages");assert.equal(await name(),"Unrelated method draft");
    return "Every rendered installation timing field saved in one request with exact scale; inactive grouping controls are absent and saved legacy values remain unchanged; invalid timing blocks request and retains input; discard restores saved fields; policy, method and notification drafts remain unsaved.";
  });

  await test("sending.switch",async()=>{
    const before=await snapshot();assert.equal(before.notifications,false);await companion();await edit("policies","lab_temperature");await fill(field("name"),"Policy draft while sending changes");
    for(const enabled of [true,false]){
      const requested=observeRequest("homeostatic/save_settings");transport.mode="hold";const requests=transport.saveRequests;await click('[data-notifications-switch]');await requested();assert.equal(await at('[data-notifications-switch]').isChecked(),!enabled);assert.equal(await at('[data-notifications-switch]').isDisabled(),true);await noChange({...before,notifications:!enabled});
      transport.release();await at(`[data-notifications-switch]${enabled?":checked":":not(:checked)"}:not(:disabled)`).waitFor({timeout:45000});assert.equal(transport.saveRequests,requests+1);await noChange({...before,notifications:enabled});await at(field("name")).waitFor();assert.equal(await name(),"Policy draft while sending changes");
    }
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:lab.entities.bulk_0,state:"unavailable"});await go("problems");for(const button of await at('[data-issue-group]').all())if(await button.getAttribute("aria-expanded")==="false")await button.click();await at('[data-episode]').filter({hasText:"Lab standalone reading 00"}).waitFor({timeout:30000});await noChange(before);
    await edit("policies","lab_temperature");assert.equal(await name(),"Policy draft while sending changes");await checkCompanion();
    return "Held On/Off transactions keep confirmed switch state and prevent resubmission; only global setting persists; a newly failed real sensor becomes an issue while sending is off; unrelated drafts survive.";
  });
}
