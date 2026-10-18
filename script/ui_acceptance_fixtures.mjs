import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {controlPaths} from "../tests/frontend/control-path-inventory.mjs";

const timeout = 30_000;
const evidenceKind = "Synthetic backend; existing fixture uses DOM-scripted interactions. This is not real Home Assistant acceptance.";
const knownIds = new Set(controlPaths.map(row => row.id));
const localCases = {
  "policy-picker.html": {
    "policies.entity-types": ["entity-types"],
    "policies.device-exclusions": ["device-exclusions"],
    "policies.picker-context": ["keyboard-escape", "source-context", "area-relevance", "label-relevance", "catalog-loading", "scoped-save", "save-rejection", "selection-layout"],
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
        await page.waitForFunction(()=>document.querySelector('#feedback')?.textContent.startsWith('Battery choices with'));
        const selected = page.locator('.policy-scope input:checked');
        await selected.focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForFunction(() => {
          const root = document.querySelector('homeostatic-card').shadowRoot;
          return root.activeElement?.dataset.watchMode === 'area' && root.activeElement.checked;
        }, null, {timeout});
        await page.keyboard.press('ArrowUp');
        await page.waitForFunction(() => {
          const root = document.querySelector('homeostatic-card').shadowRoot;
          return root.activeElement?.dataset.watchMode === 'selected' && root.activeElement.checked;
        }, null, {timeout});
        result.stages.push({name:'native scope arrow keys',messages:[],receipt:null,feedback:'PASS: Arrow keys change scope and retain focus after rendering.'});
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
      }
      if (fixture === "individual-issue.html" && !result.stages.some(stage => /^FAIL/i.test(stage.feedback))) {
        const native={id:"issues.individual",status:"pass",evidence:["Native Enter opens the named notification and Back restores the issue; entity, device, policy and notification controls fit with doubled text."]};
        try {
          const notification=page.locator('dialog[open] [data-definition-action="open-notification"][data-definition-id="morning"]');
          await notification.focus();await page.keyboard.press("Enter");
          await page.locator('.notification-profile-editor').waitFor({state:"visible"});
          await page.locator('[data-workspace-return]').click();
          await page.locator('dialog[open] [data-entity]').waitFor({state:"visible"});
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
          if (!previous || row.status === "fail" || (previous.status !== "fail" && row.status !== "untested")) rows.set(row.id, row);
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
    if (!failed && fixture === "policy-picker.html") await page.locator("#show-device").click();
    if (!failed && fixture === "monitoring-inspector.html") {
      await page.locator("[data-sources-search]").fill("3rd Floor");
      await page.locator('[data-sources-select="source:device:third-floor"]').click();
      await page.locator(".source-monitoring-explanation > summary").click();
    }
    if (!failed && fixture === "issue-evidence.html") {
      const preview=await page.locator("iframe").getAttribute("src");
      await page.goto(new URL(preview,page.url()).href);
      await page.locator("dialog[open]").waitFor({state:"visible"});
    }
    if (failed || ["policy-picker.html", "device-issues.html", "issue-evidence.html", "monitoring-inspector.html"].includes(fixture)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      try {result.screenshot = join(artifactDir, `${stem}.png`); await page.screenshot({path: result.screenshot, fullPage: true});}
      catch (error) {result.diagnostics.push(`Screenshot capture: ${error.message}`);}
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
