/** Cross-page navigation, keyboard, retained updates and responsive checks. */
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";

export async function runLayoutGaps(ctx) {
  const {page,lab,call,run,at,card,action,field,snapshot,click,fill,clean,go,listing,edit,discard,menu,noChange,transport,artifactDir}=ctx;
  const reset=async()=>{transport.interceptRequest=null;transport.transformResponse=null;await page.goto("about:blank");Object.assign(lab,await call("homeostatic_ui_lab/control",{action:"reset"}));await clean();};
  const focused=locator=>locator.evaluate(el=>el.getRootNode().activeElement===el);
  const waitFocus=selector=>page.waitForFunction(selector=>{let el=document.activeElement;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement;return Boolean(el?.matches(selector));},selector,{timeout:5000});
  const tabTo=async(selector,backward=false)=>{
    const target=at(selector).first();await target.waitFor();
    for(let n=0;n<220;n++){
      if(await focused(target)&&await target.evaluate(el=>el.matches(':focus-visible'))){
        const ring=await target.evaluate(el=>{const style=getComputedStyle(el);return {width:parseFloat(style.outlineWidth),style:style.outlineStyle,color:style.outlineColor};});
        assert.ok(ring.width>0&&ring.style!=="none"&&ring.color!=="transparent"&&ring.color!=="rgba(0, 0, 0, 0)",`Keyboard focus is visible on ${selector}`);
        return target;
      }
      await page.keyboard.press(backward?"Shift+Tab":"Tab");
    }
    throw Error(`Keyboard focus did not reach ${selector}`);
  };
  const destinationVisible=async destination=>{
    if(destination==="configuration")await at('main h1').filter({hasText:/^Settings$/}).waitFor();
    else await at(`.header [data-page="${destination}"][aria-current="page"]`).waitFor();
  };
  await run("navigation.history",async()=>{
    await reset();const before=await snapshot(),destinations=[];
    for(const destination of ["problems","sources","policies","notifications","history","configuration"]){await go(destination);await destinationVisible(destination);destinations.push({url:page.url(),destination});}
    for(let index=destinations.length-2;index>=0;index--){await page.goBack();assert.equal(page.url(),destinations[index].url);await destinationVisible(destinations[index].destination);}
    for(let index=1;index<destinations.length;index++){await page.goForward();assert.equal(page.url(),destinations[index].url);await destinationVisible(destinations[index].destination);}
    await edit("policies",before.monitoring_policies[0].id);const policyUrl=page.url();
    await page.reload();await at(field("name")).waitFor();assert.equal(await at(field("name")).inputValue(),before.monitoring_policies[0].name);
    await page.goto(policyUrl);await at(field("name")).waitFor();assert.equal(await at(field("name")).inputValue(),before.monitoring_policies[0].name);
    await go("sources");await fill('[data-sources-search]',lab.entities.offline);const source=at('[data-sources-select]').last(),sourceId=await source.getAttribute('data-sources-select');await source.click();const sourceUrl=page.url(),sourceTitle=await at('#sources-detail-title').innerText();
    await go("history");await page.goBack();await at('#sources-detail-title').waitFor();assert.equal(page.url(),sourceUrl);assert.equal(await at('#sources-detail-title').innerText(),sourceTitle);assert.equal(await at(`[data-sources-select="${sourceId}"]`).getAttribute('aria-current'),"true");
    await page.reload();await at('#sources-detail-title').waitFor();assert.equal(await at('#sources-detail-title').innerText(),sourceTitle);
    await page.goto(lab.url+"/homeostatic/episode/acceptance-missing-issue");
    await at('dialog[open]').waitFor();await at('dialog[open]').filter({hasText:/not found|no longer|unavailable|does not exist/i}).waitFor();
    await page.keyboard.press("Escape");await noChange(before);
    return "All page Back/Forward routes; direct and refreshed policy/source routes; missing issue explanation; no saved configuration changes.";
  });
  await run("updates.retention",async()=>{
    await reset();const before=await snapshot(),id=before.monitoring_policies[0].id;
    await edit("policies",id);await fill(field("name"),"Retained acceptance draft");
    const input=at(field("name")),handle=await input.elementHandle();await input.press("Home");await input.press("ArrowRight");await input.press("Shift+ArrowRight");
    const selection=await input.evaluate(el=>[el.selectionStart,el.selectionEnd]);
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:lab.entities.offline,state:"unavailable"});
    assert.equal(await input.evaluate((el,old)=>el===old,handle),true);assert.equal(await focused(input),true);
    assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),selection);
    let releaseAuth;const authReady=new Promise(resolve=>{transport.interceptRequest=(request,_route,server)=>{if(request.type!=="auth")return false;releaseAuth=()=>server.send(JSON.stringify(request));resolve();return true;};});
    for(const connection of transport.connections)await connection.route.close({code:1012,reason:"Acceptance reconnect check"});
    await at('.shell').filter({hasText:/Reconnecting|Connection lost/}).waitFor({timeout:20000});
    assert.equal(await input.inputValue(),"Retained acceptance draft");
    assert.ok(await input.evaluate(el=>Boolean(el.closest('[inert]'))||el.disabled),"Stale editor must be read-only");
    await Promise.race([authReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("No reconnect auth request")),20000))]);
    transport.interceptRequest=null;releaseAuth();await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});
    assert.equal(await input.inputValue(),"Retained acceptance draft");assert.equal(await input.evaluate((el,old)=>el===old,handle),true);
    assert.equal(await focused(input),true,"Reconnect returns focus to the retained input");assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),selection,"Reconnect preserves the selection");
    await discard();await noChange(before);
    return "Native socket close/reconnect retained DOM, typed draft, selection and focus across unchanged updates; disconnected editor was read-only.";
  });
  await run("layout.menus",async()=>{
    await reset();const before=await snapshot();await listing("profiles");
    const toggle='[popovertarget="notification-actions-weekly"]';await at(toggle).scrollIntoViewIfNeeded();
    for(const dismissal of ["escape","outside"]){
      await click(toggle);const popover=at('#notification-actions-weekly');
      for(const item of await popover.locator('button').all()){
        assert.equal(await item.isVisible(),true);const box=await item.boundingBox(),viewport=page.viewportSize();
        assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,"Menu action clipped by viewport");
      }
      if(dismissal==="escape"){await page.keyboard.press("Escape");assert.equal(await focused(at(toggle)),true);}else{await click('main h1');assert.equal(await popover.isVisible(),false);assert.equal(await popover.evaluate(el=>el.contains(el.getRootNode().activeElement)),false,"Outside dismissal leaves no focus in the hidden menu");}
    }
    await noChange(before);
  });
  await run("layout.keyboard",async()=>{
    await reset();const before=await snapshot();
    for(const destination of ["sources","policies","notifications","history","configuration","problems"]){
      const target=await tabTo(`.header [data-page="${destination}"]`);await page.keyboard.press("Enter");
      if(destination!=="configuration")assert.equal(await target.getAttribute("aria-current"),"page");else assert.equal(await at('main h1').innerText(),"Settings");
    }
    await go("policies");await tabTo(`${action("edit")}[data-definition-kind="policies"]`);await page.keyboard.press("Enter");
    const name=await tabTo(field("name"));const old=await name.inputValue();await name.press("Control+A");await name.pressSequentially("Keyboard draft");
    const enable=await tabTo(field("enabled"));const enabled=await enable.isChecked();await page.keyboard.press("Space");assert.equal(await enable.isChecked(),!enabled);
    await tabTo(action("discard-scoped"),true);await page.keyboard.press("Enter");assert.equal(await at(field("name")).inputValue(),old);
    await edit("methods","lab_messages");const opener=await tabTo(action("destination-open"));await page.keyboard.press("Enter");
    await tabTo('[data-definition-delivery-type]');await page.keyboard.press("Escape");assert.equal(await focused(opener),true);
    await menu("profiles","weekly","delete");const cancel=await tabTo(action("cancel-delete"));await page.keyboard.press("Enter");assert.equal(await cancel.count(),0);
    await go("sources");await tabTo('[data-sources-filters]');await page.keyboard.press("Enter");await tabTo('[data-sources-disabled]');await page.keyboard.press("Space");
    await at('[data-sources-disabled]:checked').waitFor();await waitFocus('[data-sources-disabled]');await page.keyboard.press("Space");
    await at('[data-sources-disabled]:not(:checked)').waitFor();await page.keyboard.press("Escape");await waitFocus('[data-sources-filters]');await noChange(before);
    return "Tab/Shift+Tab/Enter/Space/Escape traversed page navigation, editable policy fields, discard, destination picker, deletion and filter dialogs with focus return.";
  });
  await run("layout.themes",async()=>{
    await reset();const observations=[],failures=[],originalViewport=page.viewportSize(),originalScheme=await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?"dark":"light");
    for(const width of [1440,390,320])for(const colorScheme of ["light","dark"]){
      await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme});
      for(const destination of ["problems","sources","policies","notifications","history","configuration"]){
        await go(destination);
        const geometry=await card.evaluate(el=>{
          const root=el.shadowRoot,shell=root.querySelector('.shell'),nav=root.querySelector('.nav');
          const main=root.querySelector('main'),rect=main.getBoundingClientRect();
          const tabs=[...nav.querySelectorAll('button')].map(button=>{const bounds=button.getBoundingClientRect();return {label:button.textContent.trim(),left:bounds.left,right:bounds.right,top:bounds.top,height:bounds.height};});
          return {width:innerWidth,shellScroll:shell.scrollWidth,shellWidth:shell.clientWidth,navScroll:nav?.scrollWidth,navWidth:nav?.clientWidth,navRows:new Set(tabs.map(tab=>Math.round(tab.top))).size,tabs,mainLeft:rect.left,mainRight:rect.right,mainScroll:main.scrollWidth,mainWidth:main.clientWidth};
        });
        observations.push({width,colorScheme,destination,geometry});
        if(geometry.shellScroll>geometry.shellWidth+2||geometry.mainScroll>geometry.mainWidth+2||geometry.mainLeft< -1||geometry.mainRight>width+1)failures.push(`${width}px ${colorScheme} ${destination}: ordinary content overflows`);
        if(geometry.navScroll>geometry.navWidth+2)failures.push(`${width}px ${colorScheme} ${destination}: navigation requires horizontal scrolling`);
        if(geometry.tabs.some(tab=>tab.left<0||tab.right>width+1||tab.height<44))failures.push(`${width}px ${colorScheme} ${destination}: a navigation tab is clipped or below the touch-target height`);
        if(geometry.navRows!==(width===320?2:1))failures.push(`${width}px ${colorScheme} ${destination}: navigation should use ${width===320?"two rows":"one row"} at normal text size`);
      }
      await edit("profiles","morning");
      const beforeTime=await at('input[data-definition-field="timing:at"]').inputValue();
      // A test-only user stylesheet simulates doubled text while retaining the
      // layout viewport. This is text enlargement, not a physical-browser claim.
      await card.evaluate(el=>{const sizes=[...el.shadowRoot.querySelectorAll('label,button,input,select,p,h1,h2,h3,summary')].map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]);for(const [node,size] of sizes)node.style.fontSize=`${size*2}px`;});
      const enlarged=await card.evaluate(el=>{
        const root=el.shadowRoot,main=root.querySelector('main'),nav=root.querySelector('.nav'),input=root.querySelector('input[data-definition-field="timing:at"]'),label=input.closest('label');
        // The native time editor has an intrinsic width that includes its
        // hour/minute segments, locale period and picker. Measure that width
        // without the form's flex constraints; scrollWidth hides native clipping.
        const probe=input.cloneNode(true);probe.removeAttribute('data-definition-field');
        Object.assign(probe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',width:'max-content',minWidth:'0',maxWidth:'none',flex:'none'});
        label.append(probe);const intrinsicWidth=probe.getBoundingClientRect().width;probe.remove();
        const bounds=input.getBoundingClientRect(),labelBounds=label.getBoundingClientRect();
        return {overflow:main.scrollWidth>main.clientWidth+2,navScroll:nav.scrollWidth,navWidth:nav.clientWidth,timeWidth:bounds.width,intrinsicWidth,timeLeft:bounds.left,timeRight:bounds.right,labelLeft:labelBounds.left,labelRight:labelBounds.right,value:input.value};
      });
      observations.push({width,colorScheme,destination:"summary-doubled-text",geometry:enlarged});
      if(enlarged.overflow||enlarged.navScroll>enlarged.navWidth+2)failures.push(`${width}px ${colorScheme}: doubled text overflows`);
      if(enlarged.timeWidth+1<enlarged.intrinsicWidth||enlarged.timeLeft<enlarged.labelLeft-1||enlarged.timeRight>enlarged.labelRight+1)failures.push(`${width}px ${colorScheme}: enlarged Summary time clips its native editor`);
      assert.equal(enlarged.value,beforeTime,"Text enlargement preserves the configured Summary time");
      await page.screenshot({path:join(artifactDir,`text-${width}-${colorScheme}.png`),fullPage:true});
      await clean();
    }
    await page.setViewportSize(originalViewport);await page.emulateMedia({colorScheme:originalScheme});await writeFile(join(artifactDir,"layout-matrix.json"),JSON.stringify({observations,failures},null,2));
    assert.deepEqual(failures,[]);return "Desktop/390/320, light/dark, all pages and doubled editor text examined for content and control clipping.";
  });
}
