import {mkdir, writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {join} from "node:path";
import {controlPaths} from "../tests/frontend/control-path-inventory.mjs";

const timeout = 30_000;
const evidenceKind = "Synthetic backend; existing fixture uses DOM-scripted interactions. This is not real Home Assistant acceptance.";
const knownIds = new Set(controlPaths.map(row => row.id));
const localCases = {
  "policy-picker.html": {
    "policies.entity-selection": ["entity-tree","entity-list","entity-branch-selection","entity-save","entity-missing-loading","entity-household","entity-scroll","entity-filter-focus","selection-layout","entity-keyboard","entity-enlarged"],
  },
  "temperature-policy-editor.html": {
    "policies.temperature-detection": ["initial-state", "lower-only", "upper-only", "both-bounds", "missing-bounds", "reversed-bounds", "missing-sensors", "duration-units", "enabled-state"],
    "policies.temperature-save": ["lower-only", "upper-only", "both-bounds", "save-and-discard", "scoped-draft"],
    "policies.temperature-picker": ["picker-retention", "responsive-themes"],
  },
};

// Each fixture belongs to one shard, including fixtures that check several pages.
const fixtureGroup = fixture => fixture === "reusable-editors.html" || /delivery|mobile/.test(fixture)
  ? "notifications" : /policy|picker/.test(fixture) ? "policies" : "issues";

async function collect(page) {
  return page.evaluate(() => {
    let receipt = null;
    const raw = document.querySelector("#receipt")?.textContent;
    if (raw?.trim()) receipt = JSON.parse(raw);
    return {
      receipt,
      messages: (window.acceptanceMessages || []).slice(-1),
      feedback: [...document.querySelectorAll("#feedback,#result")].map(node => node.textContent).join("\n"),
    };
  });
}

async function finished(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("#feedback,#result")].some(node =>
    /^(PASS\b|FAIL(?:ED)?\b|ERROR\b)|checks passed|^\d+ passed, \d+ failed/i.test(node.textContent.trim())), null, {timeout});
}

async function configure(page, viewport, colorScheme) {
  for (const [selector, value] of [["#dark", colorScheme === "dark"], ["#narrow", viewport.width < 600], ["#wide", viewport.width >= 600]]) {
    const input = page.locator(selector);
    if (await input.count()) await input.setChecked(value);
  }
  for (const [selector, desired] of [["#theme", colorScheme], ["#width", String(viewport.width)]]) {
    const select = page.locator(selector);
    if (!await select.count()) continue;
    const options = await select.locator("option").evaluateAll(nodes => nodes.map(node => node.value));
    const value = options.includes(desired) ? desired : selector === "#width"
      ? options.reduce((best, candidate) => Math.abs(Number(candidate) - viewport.width) < Math.abs(Number(best) - viewport.width) ? candidate : best)
      : null;
    if (value) await select.selectOption(value);
  }
}

/** Exercise the actual pointer/keyboard scroll path below a wrapping sticky header. */
async function compactInspectorNavigation(page, artifactDir, colorScheme) {
  for (const width of [320, 390]) for (const enlarged of [false, true]) {
    await page.setViewportSize({width, height: 844});
    await page.goto(new URL("/tests/frontend/monitoring-inspector.html", page.url()).href, {waitUntil: "load"});
    await page.locator("#width").selectOption(String(width));
    await page.locator("#theme").selectOption(colorScheme);
    if (enlarged) await page.locator("homeostatic-panel").evaluate(panel => {
      const style = panel.shadowRoot.querySelector("style");
      style.textContent = style.textContent.replace(/font-size:([\d.]+)(px|rem|em)/g,
        (_, size, unit) => `font-size:${Number(size) * 2}${unit}`);
    });
    await page.locator("[data-sources-search]").fill("3rd Floor");
    for (const keyboard of [false, true]) {
      const row = page.locator('[data-sources-select="source:entity:third-floor-temperature"]');
      if (keyboard) {await row.focus(); await page.keyboard.press("Enter");}
      else await row.click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      try {await page.waitForFunction(() => {
        const root = document.querySelector("homeostatic-panel").shadowRoot;
        const header = root.querySelector(".shell > .header").getBoundingClientRect();
        return ["#sources-detail-title", "[data-action=back-sources]"].every(selector => {
          const element = root.querySelector(selector), rect = element.getBoundingClientRect();
          const hit = root.elementFromPoint(rect.left + rect.width / 2, (rect.top + Math.min(rect.bottom, innerHeight)) / 2);
          return rect.top >= header.bottom && rect.top < innerHeight && (hit === element || element.contains(hit));
        });
      }, null, {timeout: 3000});} catch (error) {
        const geometry = await page.locator("homeostatic-panel").evaluate(panel => Object.fromEntries([".shell > .header", "#sources-detail-title", "[data-action=back-sources]"].map(selector => {
          const element = panel.shadowRoot.querySelector(selector), rect = element.getBoundingClientRect();
          return [selector, {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
            headingMargin: getComputedStyle(panel.shadowRoot.querySelector(".source-heading")).scrollMarginTop,
            scrolling: document.scrollingElement.scrollTop,
            ancestors: [...panel.shadowRoot.querySelectorAll(".shell,main,.sources-workspace,.config-layout,.config-detail")].map(node => ({name: node.className || node.tagName, top: node.scrollTop, overflow: getComputedStyle(node).overflowY}))}];
        })));
        throw Error(`${width}px enlarged=${enlarged} keyboard=${keyboard}: ${error.message}; ${JSON.stringify(geometry)}`);
      }
      assert.equal(await page.locator(".config-detail").evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "Enlarged source details fit their pane");
      assert.equal(await page.locator("#sources-detail-title").evaluate(title => title.getRootNode().activeElement === title), true, `Title focus at ${width}px, enlarged=${enlarged}, keyboard=${keyboard}`);
      await page.screenshot({path: join(artifactDir, `inspector-navigation-${width}-${enlarged ? "enlarged" : "normal"}-${keyboard ? "keyboard" : "pointer"}.png`)});
      const back = page.locator("[data-action=back-sources]");
      if (keyboard) {await back.focus(); await page.keyboard.press("Enter");}
      else await back.click();
      assert.equal(await row.evaluate(element => element.getRootNode().activeElement === element), true, `Return focus at ${width}px, enlarged=${enlarged}, keyboard=${keyboard}`);
    }
  }
}

/** Run every inventory-backed fixture once, preserving its explicit coverage claims. */
export async function runFixtures({browser, baseURL, artifactDir, record, viewport = {width: 1200, height: 900}, colorScheme = "light", group = "all"}) {
  if (!["all", "issues", "policies", "notifications", "layout"].includes(group)) throw Error(`Unknown fixture group: ${group}`);
  await mkdir(artifactDir, {recursive: true});
  const fixtures = [...new Set(controlPaths.map(row => row.fixture).filter(Boolean))]
    .filter(fixture => group === "all" || fixtureGroup(fixture) === group);
  const results = [];
  for (const fixture of fixtures) {
    const result = {fixture, group: fixtureGroup(fixture), evidence_kind: evidenceKind, viewport, color_scheme: colorScheme, status: "untested", stages: [], diagnostics: [], console: [], page_errors: [], paths: []};
    const context = await browser.newContext({viewport, colorScheme});
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on("console", message => {if (["error", "warning"].includes(message.type())) result.console.push({type: message.type(), text: message.text()});});
    page.on("pageerror", error => result.page_errors.push(error.message));
    await page.addInitScript(() => {
      window.acceptanceMessages = [];
      window.addEventListener("message", event => {
        if (event.origin === location.origin && event.data?.type === "homeostatic-acceptance") window.acceptanceMessages.push(event.data.receipt);
      });
    });
    await page.route("**/*", route => {
      if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
      result.diagnostics.push(`Blocked non-fixture request: ${route.request().url()}`);
      return route.abort();
    });
    const saveStage = async name => result.stages.push({name, ...await collect(page)});
    try {
      await page.goto(new URL(`tests/frontend/${fixture}`, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).href, {waitUntil: "load"});
      await configure(page, viewport, colorScheme);
      if (fixture === "issue-evidence.html" || fixture === "mobile-layout.html") {
        const frame = page.frameLocator("iframe");
        await frame.locator("homeostatic-panel").waitFor();
        await page.waitForFunction(name => typeof document.querySelector("iframe").contentWindow[name] === "function",
          fixture === "issue-evidence.html" ? "runIssueEvidenceChecks" : "runMobileLayoutScenario", {timeout});
      }
      for (const selector of ["#run", "#run-layout"]) {
        if (!await page.locator(selector).count()) continue;
        await page.evaluate(() => {for (const node of document.querySelectorAll("#feedback,#result")) node.textContent = "";});
        await page.locator(selector).click();
        await finished(page);
        await saveStage(selector);
      }
      for (const selector of ["#keyboard", "#escape"]) {
        if (!await page.locator(selector).count()) continue;
        await page.locator(selector).click();
        await page.waitForFunction(() => document.querySelector("#feedback")?.textContent.startsWith("Press the real Escape"), null, {timeout});
        await page.keyboard.press("Escape");
        await finished(page);
        await saveStage(`${selector}: native Escape`);
      }
      if (fixture === "policy-picker.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        await page.locator('#show').click();
        for(const name of ['Z-Wave JS','Front door']) {
          const toggle=page.getByRole('button',{name:`Expand ${name}`,exact:true});
          await toggle.focus();await page.keyboard.press('Enter');
          assert.equal(await page.getByRole('button',{name:`Collapse ${name}`,exact:true}).evaluate(el=>el.getRootNode().activeElement===el),true);
        }
        assert.equal(await page.locator('[data-definition-action="save-scoped"]').count(),0);
        const selected=page.locator('[data-definition-field="entity-choice"]:not(:disabled)').first();
        await selected.focus();const before=await selected.isChecked();await page.keyboard.press("Space");
        await page.waitForFunction(before=>document.querySelector('homeostatic-card').shadowRoot.querySelector('[data-definition-field="entity-choice"]:not(:disabled)').checked!==before,before);
        assert.equal(await selected.evaluate(el=>el.getRootNode().activeElement===el),true);
        result.stages.push({name:'native entity tree and checkbox',messages:[],receipt:{results:[{id:"entity-keyboard",status:"pass",evidence:["Native Enter opens integration and device branches without changing membership; Space toggles an enabled entity. Each control retains focus after rendering."]}]},feedback:'PASS: Keyboard expands branches and changes entity membership with retained focus.'});
        await page.evaluate(()=>{
          const root=document.querySelector('homeostatic-card').shadowRoot;
          const sizes=[...root.querySelectorAll('.entity-selection,.entity-selection *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);
          for(const [el,size] of sizes)el.style.fontSize=`${size*2}px`;
        });
        assert.equal(await page.locator('.entity-selection').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
        result.enlarged_screenshot=join(artifactDir,`entity-tree-enlarged-${viewport.width}-${colorScheme}.png`);
        await page.screenshot({path:result.enlarged_screenshot,fullPage:true});
        result.stages.push({name:'enlarged entity tree',messages:[],receipt:{results:[{id:"entity-enlarged",status:"pass",evidence:["Collapsed and expanded branch names, search and entity rows fit with doubled text."]}]},feedback:'PASS: The entity tree fits with doubled text.'});
      }
      if (fixture === "mobile-layout.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        await page.locator("iframe").scrollIntoViewIfNeeded();
        await page.frameLocator("iframe").locator("#outside").click();
        await page.waitForFunction(() => window.acceptanceMessages.length > 0, null, {timeout});
        await saveStage("native outside click");
      }
      if (fixture === "source-actions.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        const native = {id:"sources.monitoring-policies",status:"pass",evidence:["Native Enter opens Monitoring policies; Escape and Close restore its trigger. Entity and policy dialog fit the viewport with doubled text."]};
        try {
          const trigger=page.locator('[data-source-policies="open"]');
          await trigger.focus();await page.keyboard.press("Enter");
          await page.locator('.source-policy-dialog[open]').waitFor({state:"visible"});
          result.details_screenshot=join(artifactDir,`source-policies-${viewport.width}-${colorScheme}.png`);
          await page.screenshot({path:result.details_screenshot,fullPage:true});
          await page.keyboard.press("Escape");
          await page.waitForFunction(()=>{
            const root=document.querySelector("homeostatic-panel").shadowRoot;
            return !root.querySelector('.source-policy-dialog')&&root.activeElement?.dataset.sourcePolicies==="open";
          });
          result.screenshot=join(artifactDir,`source-entity-${viewport.width}-${colorScheme}.png`);
          await page.locator('homeostatic-panel').evaluate(card=>{
            for(const element of card.shadowRoot.querySelectorAll('*'))if(element.scrollTop)element.scrollTop=0;
          });
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:result.screenshot,fullPage:true});
          await trigger.click();
          await page.locator('[data-source-policies="close"]').click();
          await trigger.click();
          await page.locator('homeostatic-panel').evaluate(card=>{
            const root=card.shadowRoot,targets=[...root.querySelectorAll('.config-detail *')].filter(element=>!element.closest('svg'));
            const sizes=targets.map(element=>[element,parseFloat(getComputedStyle(element).fontSize)]);
            for(const [element,size] of sizes)element.style.fontSize=`${size*2}px`;
          });
          for(const selector of ['.config-detail','.source-policy-dialog']) {
            const fits=await page.locator(selector).evaluate(element=>element.scrollWidth<=element.clientWidth+1);
            if(!fits)throw Error(`${selector} overflows with doubled text`);
          }
          result.enlarged_screenshot=join(artifactDir,`source-policies-enlarged-${viewport.width}-${colorScheme}.png`);
          await page.screenshot({path:result.enlarged_screenshot,fullPage:true});
          await page.keyboard.press("Escape");
        } catch(error) {native.status="fail";native.evidence=[error.message];}
        result.stages.push({name:"native policy dialog and enlarged text",receipt:{results:[native]},messages:[],feedback:`${native.status.toUpperCase()}: ${native.evidence.join(" ")}`});
      }
      if (fixture === "monitoring-inspector.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        const native = {id: "sources.monitoring-toolbar", status: "pass", evidence: ["Native Escape closes More filters and returns focus; a real outside click closes it and retains the search focus."]};
        try {
          await page.locator("[data-sources-filters]").click();
          await page.locator("#sources-more-filters").waitFor({state: "visible"});
          await page.locator("[data-sources-disabled]").focus();
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => {
            const root = document.querySelector("homeostatic-panel").shadowRoot;
            return !root.querySelector("#sources-more-filters").matches(":popover-open") && root.activeElement?.hasAttribute("data-sources-filters");
          }, null, {timeout});
          await page.locator("[data-sources-filters]").click();
          await page.locator("#sources-more-filters").waitFor({state: "visible"});
          await page.locator("[data-sources-search]").click();
          await page.waitForFunction(() => {
            const root = document.querySelector("homeostatic-panel").shadowRoot;
            return !root.querySelector("#sources-more-filters").matches(":popover-open") && root.activeElement?.hasAttribute("data-sources-search");
          }, null, {timeout});
        } catch (error) {native.status = "fail"; native.evidence = [error.message];}
        result.stages.push({name: "native filter dismissal", receipt: {results: [native]}, messages: [], feedback: `${native.status.toUpperCase()}: ${native.evidence.join(" ")}`});
        const navigation = {id: "sources.compact-inspector-details", status: "pass", evidence: ["Pointer and Enter open entity details at 320 and 390 pixels with normal and doubled text. The title and Back to Monitoring remain below the wrapped header, receive focus and support return to the selected row."]};
        try {await compactInspectorNavigation(page, artifactDir, colorScheme);}
        catch (error) {navigation.status = "fail"; navigation.evidence = [error.message];}
        result.stages.push({name: "native compact inspector navigation", receipt: {results: [navigation]}, messages: [], feedback: `${navigation.status.toUpperCase()}: ${navigation.evidence.join(" ")}`});
        await page.setViewportSize(viewport);
      }
      if (fixture === "individual-issue.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        const native={id:"issues.individual",status:"pass",evidence:["Native Enter opens the named notification and Back restores the device issues; device, policy, notification and response controls fit with doubled text."]};
        try {
          const notification=page.locator('dialog[open] [data-definition-action="open-notification"][data-definition-id="morning"]');
          await notification.focus();await page.keyboard.press("Enter");
          await page.locator('.notification-profile-editor').waitFor({state:"visible"});
          await page.locator('[data-workspace-return]').click();
          await page.locator('dialog[open] [data-device-response="pause"]').waitFor({state:"visible"});
          await page.locator('dialog[open]').evaluate(dialog=>{dialog.scrollTop=0;});
          result.screenshot=join(artifactDir,`individual-issue-${viewport.width}-${colorScheme}.png`);
          await page.screenshot({path:result.screenshot,fullPage:true});
          await page.locator('dialog[open]').evaluate(dialog=>{dialog.scrollTop=dialog.scrollHeight;});
          result.details_screenshot=join(artifactDir,`individual-issue-notifications-${viewport.width}-${colorScheme}.png`);
          await page.screenshot({path:result.details_screenshot,fullPage:true});
          await page.locator('dialog[open]').evaluate(dialog=>{dialog.scrollTop=0;});
          await page.locator('dialog[open]').evaluate(dialog=>{
            const sizes=[...dialog.querySelectorAll('*')].filter(element=>!element.closest('svg')).map(element=>[element,parseFloat(getComputedStyle(element).fontSize)]);
            for(const [element,size] of sizes)element.style.fontSize=`${size*2}px`;
          });
          if(!await page.locator('dialog[open] .dialog-body').evaluate(element=>element.scrollWidth<=element.clientWidth+1))throw Error("Issue dialog overflows with doubled text");
          result.enlarged_screenshot=join(artifactDir,`individual-issue-enlarged-${viewport.width}-${colorScheme}.png`);
          await page.screenshot({path:result.enlarged_screenshot,fullPage:true});
          await page.keyboard.press("Escape");
          await page.locator('dialog[open]').waitFor({state:"hidden"});
        } catch(error) {native.status="fail";native.evidence=[error.message];}
        result.stages.push({name:"native issue configuration navigation and enlarged text",receipt:{results:[native]},messages:[],feedback:`${native.status.toUpperCase()}: ${native.evidence.join(" ")}`});
      }
    } catch (error) {
      result.diagnostics.push(error.message);
      try {await saveStage("interrupted");} catch (captureError) {result.diagnostics.push(`Receipt capture: ${captureError.message}`);}
    }
    const rows = new Map();
    for (const stage of result.stages) {
      for (const receipt of [...stage.messages, stage.receipt].filter(Boolean)) {
        for (const row of receipt.results || []) {
          const previous = rows.get(row.id);
          if (!previous || row.status === "fail" || (previous.status !== "fail" && row.status !== "untested")) rows.set(row.id, {...row,evidence:Array.isArray(row.evidence)?row.evidence:row.evidence?[row.evidence]:[]});
        }
      }
    }
    for (const [id, required] of Object.entries(localCases[fixture] || {})) {
      const checked = required.map(caseId => rows.get(caseId));
      const status = checked.some(row => row?.status === "fail") ? "fail" : checked.every(row => row?.status === "pass") ? "pass" : "untested";
      rows.set(id, {id, status, evidence: required.map((caseId, index) => `${caseId}: ${checked[index]?.status || "untested"}; ${(checked[index]?.evidence || []).join(" ")}`)});
    }
    for (const row of rows.values()) {
      if (!knownIds.has(row.id) || row.status === "untested") continue;
      const evidence = `${fixture} (${viewport.width}px, ${colorScheme}): ${evidenceKind} ${(row.evidence || []).join(" ")}`;
      result.paths.push({id: row.id, status: row.status, evidence});
      await record(row.id, row.status, evidence);
    }
    const failed = result.diagnostics.length || result.page_errors.length || [...rows.values()].some(row => row.status === "fail") || result.stages.some(stage => /^(FAIL(?:ED)?\b|ERROR\b)/i.test(stage.feedback.trim()));
    result.status = failed ? "fail" : result.stages.length ? "pass" : "untested";
    if (!result.paths.length) result.diagnostics.push("No inventory path was proven by a declared receipt. Fixture feedback alone does not establish inventory coverage.");
    const stem = `${fixture.replace(/\.html$/, "")}-${viewport.width}-${colorScheme}`;
    if (!failed && fixture === "policy-picker.html") await page.locator("#show").click();
    if (!failed && fixture === "monitoring-inspector.html") {
      await page.locator("[data-sources-search]").fill("3rd Floor");
      await page.locator('[data-sources-select="source:device:third-floor"]').click();
      await page.locator(".source-device-members").waitFor({state:"visible"});
    }
    if (!failed && fixture === "issue-evidence.html") {
      const preview=await page.locator("iframe").getAttribute("src");
      await page.goto(new URL(preview,page.url()).href);
      await page.locator("dialog[open]").waitFor({state:"visible"});
    }
    if (!failed && fixture === "device-issue-selection.html") {
      await page.locator('dialog[open] [data-action="close"]').click();
      await page.locator("#gaps").click();
      await page.locator("dialog[open]").filter({hasText:"No current state from Home Assistant"}).waitFor();
    }
    if (failed || ["policy-picker.html", "device-issues.html", "device-issue-selection.html", "issue-evidence.html", "monitoring-inspector.html"].includes(fixture)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      try {result.screenshot = join(artifactDir, `${stem}.png`); await page.screenshot({path: result.screenshot, fullPage: true});}
      catch (error) {result.diagnostics.push(`Screenshot capture: ${error.message}`);}
    }
    if (!failed && fixture === "policy-picker.html") {
      for(const name of ['Z-Wave JS','Front door'])await page.getByRole('button',{name:`Expand ${name}`,exact:true}).click();
      result.expanded_screenshot=join(artifactDir,`${stem}-expanded.png`);
      await page.screenshot({path:result.expanded_screenshot,fullPage:true});
    }
    if (!failed && fixture === "issue-evidence.html") {
      try {
        const dialog=page.locator("dialog[open]");
        await dialog.evaluate(element => {element.scrollTop=element.scrollHeight;});
        result.details_screenshot=join(artifactDir,`${stem}-details.png`);
        await page.screenshot({path:result.details_screenshot,fullPage:true});
      } catch (error) {result.diagnostics.push(`Details screenshot capture: ${error.message}`);}
    }
    await writeFile(join(artifactDir, `${stem}.json`), `${JSON.stringify(result, null, 2)}\n`);
    await context.close();
    results.push(result);
  }
  return results;
}
