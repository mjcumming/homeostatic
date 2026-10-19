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
    const connection=await card.evaluateHandle(el=>el._hass.connection);
    // Record the originating cleanup stack without changing requests or errors.
    // Some HA clients reuse old subscription ids before resubscribe completes.
    const trace=await connection.evaluateHandle(connection=>{
      const send=connection.sendMessagePromise,calls=[];
      connection.sendMessagePromise=function(request){
        if(request.type==="unsubscribe_events")calls.push({request:{...request},stack:new Error().stack});
        return send.call(this,request);
      };
      return {calls,restore:()=>{connection.sendMessagePromise=send;}};
    });
    const subscriptionCount=transport.requestCounts["homeostatic/subscribe"]??0,saveCount=transport.saveRequests;
    try {
    let releaseAuth;const authReady=new Promise(resolve=>{transport.interceptRequest=(request,_route,server)=>{if(request.type!=="auth")return false;releaseAuth=()=>server.send(JSON.stringify(request));resolve();return true;};});
    for(const connection of transport.connections)await connection.route.close({code:1012,reason:"Acceptance reconnect check"});
    await at('.shell').filter({hasText:/Reconnecting|Connection lost/}).waitFor({timeout:20000});
    assert.equal(await input.inputValue(),"Retained acceptance draft");
    assert.ok(await input.evaluate(el=>Boolean(el.closest('[inert]'))||el.disabled),"Stale editor must be read-only");
    assert.equal(await card.evaluate(el=>el.store.baseline),null,"Disconnect invalidates the available catalog baseline");
    await Promise.race([authReady,new Promise((_,reject)=>setTimeout(()=>reject(Error("No reconnect auth request")),20000))]);
    transport.interceptRequest=null;releaseAuth();await at('[data-notifications-switch]:not(:disabled)').waitFor({timeout:30000});
    assert.equal(await input.inputValue(),"Retained acceptance draft");assert.equal(await input.evaluate((el,old)=>el===old,handle),true);
    assert.equal(await focused(input),true,"Reconnect returns focus to the retained input");assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),selection,"Reconnect preserves the selection");
    assert.equal(await card.evaluate((el,previous)=>el._hass.connection===previous,connection),true,"Native reconnect retains the shared HA connection");
    assert.equal(transport.requestCounts["homeostatic/subscribe"],subscriptionCount+1,"Exactly one Homeostatic stream is re-established");
    const previousUpdate=await card.evaluate(el=>el.current.data.updated_at);
    let received;
    const freshEvent=new Promise(resolve=>{received=resolve;});
    transport.transformResponse=(packet,request)=>{
      if(request?.type==="homeostatic/subscribe"&&packet.type==="event"&&packet.event.available&&packet.event.updated_at!==previousUpdate)received(packet.event.updated_at);
      return packet;
    };
    await call("homeostatic_ui_lab/control",{action:"set_state",entity_id:lab.entities.offline,state:"on"});
    let deadline;
    const updatedAt=await Promise.race([freshEvent,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error("No fresh Homeostatic update after reconnect")),15000);})]).finally(()=>clearTimeout(deadline));
    await page.waitForFunction(({element,updatedAt})=>element.current.status==="current"&&Date.parse(element.current.data?.updated_at)>=Date.parse(updatedAt),{element:await card.elementHandle(),updatedAt});
    transport.transformResponse=null;
    assert.equal(await input.inputValue(),"Retained acceptance draft");assert.equal(await focused(input),true);
    assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),selection);
    await discard();await noChange(before);
    assert.equal(transport.saveRequests,saveCount,"Reconnect and draft discard send no configuration save");
    await writeFile(join(artifactDir,"reconnect-workflow.json"),JSON.stringify({
      homeostatic_workflow:"pass",whole_browser_result:"See report.json; native HA errors remain failures.",
      assertions:["same HA connection","one replacement subscription","disconnected baseline invalidated","stale editor read-only","DOM, draft, focus and selection retained","fresh live update after reconnect","saved settings unchanged","zero configuration saves"],
      unsubscribe_calls:await trace.evaluate(value=>value.calls),
    },null,2));
    return "Native reconnect retained DOM, draft, selection and focus, invalidated the old baseline and restored one live stream. A new state change reached the retained editor; configuration stayed unchanged and no save was sent.";
    } finally {
      transport.transformResponse=null;
      await trace.evaluate(value=>value.restore());await trace.dispose();await connection.dispose();
    }
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
  await run("live.sources.narrow-header",async()=>{
    await reset();const before=await snapshot(),saveCount=transport.saveRequests,originalViewport=page.viewportSize(),observations=[];
    try {
      for(const width of [320,390])for(const enlarged of [false,true]){
        await page.setViewportSize({width,height:844});await clean();await go("sources");
        await at('[data-sources-search]').waitFor();
        if(enlarged)await card.evaluate(el=>{
          const style=el.shadowRoot.querySelector("style");
          style.textContent=style.textContent.replace(/font-size:([\d.]+)(px|rem|em)/g,(_,size,unit)=>`font-size:${Number(size)*2}${unit}`);
        });
        await fill('[data-sources-search]',lab.entities.offline);
        const sourceId=await card.evaluate((el,id)=>el.current.data.inventory.nodes.find(source=>source.entity_id===id&&!source.monitoring_policy)?.node_id,lab.entities.offline);
        assert.ok(sourceId,"The monitored entity has a canonical source");
        const selector=`.config-rail [data-sources-select="source:${sourceId}"]`,row=at(selector);
        for(const keyboard of [false,true]){
          if(keyboard){await tabTo(selector);await page.keyboard.press("Enter");}else await row.click();
          await waitFocus('#sources-detail-title');
          const measure=()=>card.evaluate(el=>{
            const root=el.shadowRoot,header=root.querySelector('.shell > .header').getBoundingClientRect();
            const controls=['#sources-detail-title','[data-action="back-sources"]'].map(selector=>{
              const element=root.querySelector(selector),rect=element.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
              let hit=document.elementFromPoint(x,y);
              while(hit?.shadowRoot){const inner=hit.shadowRoot.elementFromPoint(x,y);if(!inner||inner===hit)break;hit=inner;}
              return {selector,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,hit:hit===element||element.contains(hit),focused:root.activeElement===element};
            });
            const pane=root.querySelector('.config-detail');
            const context=['.shell > .header','.sources-workspace','.config-detail','.source-heading'].map(selector=>{
              const node=root.querySelector(selector),style=getComputedStyle(node),rect=node.getBoundingClientRect();
              return {selector,top:rect.top,bottom:rect.bottom,height:rect.height,position:style.position,offset:style.top,scrollMarginTop:style.scrollMarginTop,scrollTop:node.scrollTop,overflowY:style.overflowY};
            });
            return {headerBottom:header.bottom,viewportHeight:innerHeight,viewportWidth:innerWidth,controls,overflow:pane.scrollWidth>pane.clientWidth+1,context};
          });
          // Rendering and native scrolling may finish on the next frame.
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const geometry=await measure();observations.push({width,enlarged,input:keyboard?"keyboard":"pointer",geometry});
          await page.screenshot({path:join(artifactDir,`live-source-header-${width}-${enlarged?"enlarged":"normal"}-${keyboard?"keyboard":"pointer"}.png`)});
          for(const control of geometry.controls){
            assert.ok(control.top>=geometry.headerBottom-1&&control.bottom<=geometry.viewportHeight+1,`${width}px enlarged=${enlarged}: ${control.selector} remains below the sticky header and inside the viewport`);
            assert.ok(control.left>=-1&&control.right<=geometry.viewportWidth+1&&control.hit,`${width}px enlarged=${enlarged}: ${control.selector} is directly reachable`);
          }
          assert.equal(geometry.overflow,false,"Source details fit without horizontal scrolling");
          if(keyboard){await page.keyboard.press("Shift+Tab");await waitFocus('[data-action="back-sources"]');await page.keyboard.press("Enter");}
          else await click('[data-action="back-sources"]');
          await waitFocus(`[data-sources-select="source:${sourceId}"]`);
          assert.equal(await row.getAttribute("aria-current"),"true","Returning preserves the selected source");
          assert.equal(await at('[data-sources-search]').inputValue(),lab.entities.offline,"Returning preserves the search");
        }
      }
      await noChange(before);assert.equal(transport.saveRequests,saveCount,"Narrow-screen browsing sends no save");
      return "Pointer and keyboard entity selection and return passed at 320/390 pixels with normal/doubled text. Title and Back stayed below the sticky header, fully in view and hit-test accessible; focus, selected source, search and saved settings were retained.";
    } finally {
      await writeFile(join(artifactDir,"live-source-header-matrix.json"),JSON.stringify({observations},null,2));
      await page.setViewportSize(originalViewport);await clean();
    }
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
