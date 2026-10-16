#!/usr/bin/env node
/** Run the existing fixtures and rendered workflows against disposable Home Assistant. */
import {createHash} from "node:crypto";
import {spawn, execFileSync} from "node:child_process";
import {createServer} from "node:http";
import {createReadStream, watch} from "node:fs";
import {mkdir, mkdtemp, readFile, readdir, rmdir, writeFile, stat, unlink, cp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, extname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {controlPaths, emptyReceipt, receiptSummary} from "../tests/frontend/control-path-inventory.mjs";
import {liveCaseId} from "./ui_acceptance_cases.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const inventoryIds=new Set(controlPaths.map(row=>row.id));

/** Preserve any observed failure; never let an unrelated pass erase it. */
export function observe(receipt,id,status,evidence) {
  if(!["pass","fail","untested"].includes(status))throw Error(`Invalid result: ${status}`);
  let row=receipt.results.find(item=>item.id===id);
  if(!row){row={id,page:"Additional browser case",controls:id,expected:"See evidence",status:"untested",evidence:[]};receipt.results.push(row);}
  if(status==="fail"||row.status!=="fail"&&(status==="pass"||row.status!=="pass"))row.status=status;
  if(!row.evidence.includes(evidence))row.evidence.push(evidence);
}

export function mergeReports(reports) {
  if(!reports.length)throw Error("No reports to merge");
  if(reports.some(report=>report.environment.candidate_unchanged===false))throw Error("Cannot merge a run whose component changed during execution");
  const fingerprints=new Set(reports.map(report=>report.candidate.component_sha256));
  if(fingerprints.size!==1)throw Error("Cannot merge reports from different component contents");
  const fixtureFingerprints=new Set(reports.map(report=>report.candidate.fixture_sha256).filter(Boolean));
  if(fixtureFingerprints.size>1)throw Error("Cannot merge reports from different frozen fixture contents");
  for(const field of ["ha","python","library"]){
    const versions=new Set(reports.flatMap(report=>report.environment.runs??[report.environment]).map(environment=>environment[field]).filter(Boolean));
    if(versions.size>1)throw Error(`Cannot merge incompatible ${field} versions`);
  }
  const candidate={...reports[0].candidate,revisions:[...new Set(reports.flatMap(report=>report.candidate.revisions??[report.candidate.revision]))]};
  const merged={schema_version:1,started_at:reports[0].started_at,finished_at:new Date().toISOString(),candidate,environment:{runs:reports.map(r=>r.environment)},fixtures:emptyReceipt(),live:emptyReceipt(),diagnostics:reports.flatMap(r=>r.diagnostics??[]),artifacts:reports.flatMap(r=>r.artifacts??[])};
  for(const key of ["browser_errors","unhandled_rejections","console_errors","websocket_errors"])
    merged[key]=reports.flatMap(report=>(report[key]??[]).map(detail=>({run:{group:report.environment.group,viewport:report.environment.viewport,theme:report.environment.theme},detail})));
  merged.coverage_revision=2;
  for(const report of reports)for(const layer of ["fixtures","live"])for(const row of report[layer].results)for(const evidence of row.evidence.length?row.evidence:["No executed assertion recorded"])observe(merged[layer],report.coverage_revision!==2&&layer==="live"&&row.status!=="untested"?liveCaseId(row.id):row.id,row.status,evidence);
  return merged;
}

export function reportExitCode(report) {
  if(report.diagnostics.length||report.unhandled_rejections?.length||[report.live,report.fixtures].some(layer=>layer.results.some(row=>row.status==="fail")))return 1;
  const layers=report.environment.mode==="fixtures"?[report.fixtures]:report.environment.mode==="live"?[report.live]:[report.fixtures,report.live];
  return layers.some(layer=>layer.results.some(row=>row.status==="untested"))?2:0;
}

async function fingerprint(directory) {
  const hash=createHash("sha256");
  async function walk(folder){
    for(const item of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(item.name==="__pycache__"||item.name.endsWith(".pyc"))continue;
      const path=join(folder,item.name);
      if(item.isDirectory())await walk(path);
      else if(item.isFile()){hash.update(relative(directory,path).split(sep).join("/"));hash.update(await readFile(path));}
    }
  }
  await walk(directory);return hash.digest("hex");
}

function candidateInfo(componentHash) {
  const git=(...args)=>execFileSync("git",["-c",`safe.directory=${root.split(sep).join("/")}`,...args],{cwd:root,encoding:"utf8"}).trim();
  return {branch:git("branch","--show-current"),revision:git("rev-parse","HEAD"),dirty:Boolean(git("status","--porcelain")),component_sha256:componentHash};
}

function safeText(value){return String(value??"").replaceAll("|","\\|").replaceAll("\n"," ");}

export function markdownReport(report) {
  const lines=["# Homeostatic automated UI sweep","",`Source revisions: ${(report.candidate.revisions??[report.candidate.revision]).join(", ")} (${report.candidate.branch}; ${report.candidate.dirty?"uncommitted changes included":"clean"}). Component SHA-256: ${report.candidate.component_sha256}.`,"", "Synthetic fixture checks and real Home Assistant browser checks are reported separately. A fixture pass does not establish real-backend acceptance. Physical Safari and real notification receipt are outside this isolated run.","", "| Layer | Passed | Failed | Untested |","| --- | ---: | ---: | ---: |"];
  for(const layer of ["fixtures","live"]){
    const counts=receiptSummary({results:report[layer].results.filter(row=>inventoryIds.has(row.id))});
    lines.push(`| ${layer}: inventory | ${counts.pass} | ${counts.fail} | ${counts.untested} |`);
    const extra=receiptSummary({results:report[layer].results.filter(row=>!inventoryIds.has(row.id))});
    if(extra.pass+extra.fail+extra.untested)lines.push(`| ${layer}: additional bounded cases | ${extra.pass} | ${extra.fail} | ${extra.untested} |`);
  }
  for(const layer of ["live","fixtures"]){
    lines.push("",`## ${layer==="live"?"Real Home Assistant":"Synthetic fixtures"}`,"","| Path | Result | Evidence |","| --- | --- | --- |");
    for(const row of report[layer].results)lines.push(`| ${safeText(row.id)} | ${row.status} | ${row.evidence.map(safeText).join("; ")||"No executed assertion recorded"} |`);
  }
  if(report.diagnostics.length)lines.push("","## Run diagnostics","",...report.diagnostics.map(item=>`- ${safeText(item)}`));
  lines.push("","## Artifacts","",...report.artifacts.map(path=>`- [${path}](${path})`),"");
  return lines.join("\n");
}

async function saveReport(report,output) {
  report.finished_at=new Date().toISOString();
  await writeFile(join(output,"report.json"),JSON.stringify(report,null,2)+"\n");
  await writeFile(join(output,"report.md"),markdownReport(report));
}

async function boundedPhase(label,operation,timeout=45000) {
  let timer;
  try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} did not finish within ${timeout/1000} seconds`)),timeout);})]);}
  finally{clearTimeout(timer);}
}

async function staticServer(sourceRoot=root) {
  const types={".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml"};
  const server=createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
      if(!pathname.startsWith("/tests/frontend/")&&!pathname.startsWith("/custom_components/homeostatic/frontend/"))throw Error("Not a fixture asset");
      const path=resolve(sourceRoot,"."+pathname);
      if(![join(sourceRoot,"tests/frontend"),join(sourceRoot,"custom_components/homeostatic/frontend")].some(folder=>path.startsWith(folder+sep))||!(await stat(path)).isFile())throw Error("Not found");
      response.writeHead(200,{"Content-Type":types[extname(path)]??"application/octet-stream","Cache-Control":"no-store"});
      createReadStream(path).pipe(response);
    }catch{response.writeHead(404);response.end("Not found");}
  });
  await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}

export async function waitForReady(path,child,{read=readFile,subscribe=watch}={}) {
  return new Promise((done,reject)=>{
    let checking=false,pending=false,finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);watcher.close();child.off("exit",exited);child.off("error",failed);error?reject(error):done(result);};
    const check=async()=>{
      if(finished)return;
      if(checking){pending=true;return;}
      checking=true;
      do{
        pending=false;
        try{finish(null,JSON.parse(await read(path,"utf8")));}
        catch(error){if(error.code!=="ENOENT"&&!(error instanceof SyntaxError))finish(error);}
      }while(pending&&!finished);
      checking=false;
    };
    const exited=code=>finish(Error(`Isolated HA exited before readiness (${code}); see lab.log`));
    const failed=error=>finish(error);
    const watcher=subscribe(dirname(path),()=>void check());
    const timer=setTimeout(()=>finish(Error("Isolated HA did not become ready within 120 seconds; see lab.log")),120000);
    child.once("exit",exited);child.once("error",failed);void check();
  });
}

export function validateLab(lab) {
  const url=new URL(lab.url);
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!lab.access_token)throw Error("Only a disposable loopback lab with its own access token is supported");
}

function wsCall(lab,type,fields={}) {
  return new Promise((done,reject)=>{
    const socket=new WebSocket(lab.url.replace("http:","ws:")+"/api/websocket");
    const timer=setTimeout(()=>finish(Error(`Timed out: ${type}`)),30000);
    let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();error?reject(error):done(result);};
    socket.addEventListener("error",()=>finish(Error(`WebSocket connection failed: ${type}`)));
    socket.addEventListener("close",()=>{if(!finished)finish(Error(`WebSocket closed: ${type}`));});
    socket.addEventListener("message",event=>{
      const packet=JSON.parse(event.data);
      if(packet.type==="auth_required")socket.send(JSON.stringify({type:"auth",access_token:lab.access_token}));
      else if(packet.type==="auth_ok")socket.send(JSON.stringify({id:1,type,...fields}));
      else if(packet.type==="auth_invalid")finish(Error("Lab authentication failed"));
      else if(packet.id===1&&packet.type==="result")packet.success?finish(null,packet.result):finish(Object.assign(Error(packet.error?.message??"Request failed"),{code:packet.error?.code}));
    });
  });
}

async function waitForExit(child) {
  if(!child?.pid)return;
  if(child.exitCode===null&&child.signalCode===null)await new Promise(done=>{
      const graceful=setTimeout(()=>child.kill("SIGTERM"),10000);
      const force=setTimeout(()=>child.kill("SIGKILL"),20000);
      child.once("exit",()=>{clearTimeout(graceful);clearTimeout(force);done();});
    });
  if(child.signalCode==="SIGKILL")throw Error("Isolated Home Assistant required forced termination; inspect temporary configuration cleanup");
}

async function main() {
  const {values:args}=parseArgs({options:{group:{type:"string",default:"all"},output:{type:"string",default:"build/ui-acceptance"},port:{type:"string",default:"8127"},width:{type:"string",default:"1440"},height:{type:"string",default:"1000"},theme:{type:"string",default:"light"},browser:{type:"string",default:"chromium"},mode:{type:"string",default:"all"},python:{type:"string",default:process.env.VIRTUAL_ENV?join(process.env.VIRTUAL_ENV,"bin/python"):"python"},"playwright-module":{type:"string"},snapshot:{type:"string"},freeze:{type:"string"},merge:{type:"string",multiple:true},help:{type:"boolean",default:false}}});
  if(args.help){console.log("Usage: node script/ui_acceptance.mjs [--group all|issues|policies|notifications|layout] [--snapshot frozen-directory] [--freeze new-directory] [--mode all|fixtures|live] [--port 8127] [--output build/ui-acceptance] [--width 1440 --height 1000 --theme light|dark] [--browser chromium|firefox|webkit] [--python /path/to/python] [--playwright-module /path/to/playwright/index.mjs]\nMerge: --merge path/to/report.json --merge another/report.json --output build/ui-acceptance/combined");return;}
  for(const [key,allowed] of Object.entries({group:["all","issues","policies","notifications","layout"],mode:["all","fixtures","live"],theme:["light","dark"],browser:["chromium","firefox","webkit"]}))if(!allowed.includes(args[key]))throw Error(`Invalid ${key}: ${args[key]}`);
  const viewport={width:Number(args.width),height:Number(args.height)},port=Number(args.port);
  if(!Number.isInteger(port)||port<1024||port>65535||Object.values(viewport).some(n=>!Number.isInteger(n)||n<240||n>4000))throw Error("Invalid port or viewport");
  const output=resolve(root,args.output);await mkdir(output,{recursive:true});
  if(args.merge){
    const reports=await Promise.all(args.merge.map(async path=>{
      const absolute=resolve(root,path),report=JSON.parse(await readFile(absolute,"utf8"));
      report.artifacts=(report.artifacts??[]).map(artifact=>relative(output,resolve(dirname(absolute),artifact)).split(sep).join("/"));
      return report;
    }));
    const merged=mergeReports(reports);await saveReport(merged,output);process.exitCode=reportExitCode(merged);console.log(`Merged report: ${join(output,"report.md")}`);return;
  }
  if(args.freeze){
    const frozen=resolve(root,args.freeze),manifest=join(frozen,"candidate.json");
    try{await stat(frozen);throw Error("Snapshot directory already exists; choose a new path");}catch(error){if(error.code!=="ENOENT")throw error;}
    const before=await fingerprint(join(root,"custom_components/homeostatic"));
    await mkdir(frozen,{recursive:true});
    for(const folder of ["custom_components/homeostatic","tests/frontend"])await cp(join(root,folder),join(frozen,folder),{recursive:true,filter:path=>!path.includes("__pycache__")&&!path.endsWith(".pyc")});
    const copied=await fingerprint(join(frozen,"custom_components/homeostatic"));
    if(before!==copied||before!==await fingerprint(join(root,"custom_components/homeostatic")))throw Error("Source changed while freezing; choose a fresh snapshot");
    const candidate={...candidateInfo(copied),fixture_sha256:await fingerprint(join(frozen,"tests/frontend")),frozen_at:new Date().toISOString()};
    await writeFile(manifest,JSON.stringify(candidate,null,2)+"\n");console.log(`Frozen candidate: ${manifest}`);return;
  }
  const sourceRoot=args.snapshot?resolve(root,args.snapshot):root;
  const component=join(sourceRoot,"custom_components/homeostatic");
  const candidate=args.snapshot?JSON.parse(await readFile(join(sourceRoot,"candidate.json"),"utf8")):candidateInfo(await fingerprint(component));
  if(await fingerprint(component)!==candidate.component_sha256)throw Error("Frozen component no longer matches its manifest");
  if(args.snapshot&&await fingerprint(join(sourceRoot,"tests/frontend"))!==candidate.fixture_sha256)throw Error("Frozen fixtures no longer match their manifest");
  const report={schema_version:1,coverage_revision:2,started_at:new Date().toISOString(),candidate,environment:{group:args.group,viewport,theme:args.theme,browser:args.browser,mode:args.mode,notifications:"captured by synthetic services only"},fixtures:emptyReceipt(),live:emptyReceipt(),diagnostics:[],artifacts:[]};
  const record=(layer)=>(id,status,evidence)=>{observe(report[layer],id,status,`${args.group}/${args.width}px/${args.theme}: ${typeof evidence==="string"?evidence:JSON.stringify(evidence)}`);console.log(`${layer} ${status} ${id}`);};
  let browser,server,child,lab,context,logStream;
  const credentialsDir=await mkdtemp(join(tmpdir(),"homeostatic-ui-acceptance-"));
  const readyFile=join(credentialsDir,"ready.json");
  const interrupt=()=>{
    report.diagnostics.push("Run interrupted; remaining paths are untested.");
    if(context)void context.close().catch(error=>report.diagnostics.push(`Interrupted browser context: ${error.message}`));
    else if(browser)void browser.close().catch(error=>report.diagnostics.push(`Interrupted browser: ${error.message}`));
    if(child)child.kill("SIGTERM");
  };
  process.once("SIGINT",interrupt);process.once("SIGTERM",interrupt);
  try{
    const modulePath=args["playwright-module"]??process.env.PLAYWRIGHT_MODULE??join(root,".tools/ui-acceptance/node_modules/playwright/index.mjs");
    const playwright=await import(pathToFileURL(resolve(modulePath)).href);
    browser=await playwright[args.browser].launch({headless:true});
    report.environment.browser_version=browser.version();
    if(args.mode!=="live"){
      const fixtureServer=await staticServer(sourceRoot);server=fixtureServer.server;
      const {runFixtures}=await import("./ui_acceptance_fixtures.mjs");
      report.fixture_runs=await runFixtures({browser,baseURL:fixtureServer.url,artifactDir:output,record:record("fixtures"),viewport,colorScheme:args.theme,group:args.group});
      for(const fixture of report.fixture_runs){
        report.artifacts.push(`${fixture.fixture.replace(/\.html$/,"")}-${viewport.width}-${args.theme}.json`);
        if(fixture.screenshot)report.artifacts.push(relative(output,fixture.screenshot));
        if(fixture.details_screenshot)report.artifacts.push(relative(output,fixture.details_screenshot));
        if(fixture.status==="fail")report.diagnostics.push(`Fixture ${fixture.fixture} failed: ${[...fixture.diagnostics,...fixture.page_errors,...fixture.stages.filter(stage=>/^FAIL/i.test(stage.feedback)).map(stage=>stage.feedback)].join("; ")}`);
      }
    }
    if(args.mode!=="fixtures"){
      await unlink(readyFile).catch(error=>{if(error.code!=="ENOENT")throw error;});
      const {createWriteStream}=await import("node:fs");logStream=createWriteStream(join(output,"lab.log"));
      child=spawn(args.python,["-u",join(root,"script/ui_lab.py"),"--component",component,"--port",String(port),"--ready-file",readyFile,"--capture-file",join(output,"mock-requests.json")],{cwd:root,stdio:["ignore","pipe","pipe"]});
      child.stdout.pipe(logStream);child.stderr.pipe(logStream);child.on("error",error=>report.diagnostics.push(error.message));
      lab=await waitForReady(readyFile,child);validateLab(lab);
      report.environment.ha=lab.ha_version;report.environment.python=lab.python_version;report.environment.library=lab.health_tree_version;
      console.log("live startup browser context");
      context=await boundedPhase("Browser context",()=>browser.newContext({viewport,colorScheme:args.theme}));
      report.unhandled_rejections=[];
      console.log("live startup diagnostic binding");
      await boundedPhase("Diagnostic binding",()=>context.exposeBinding("__homeostaticLabRejection",(source,reason)=>{
        report.unhandled_rejections.push({...reason,case:source.page?.acceptanceCase,at:new Date().toISOString()});
        report.diagnostics.push(`Unhandled rejection (${source.page?.acceptanceCase??"startup"}): ${reason.code??""} ${reason.message}`);
      }));
      console.log("live startup disposable authentication");
      await boundedPhase("Authentication initialization",()=>context.addInitScript(({url,access_token,refresh_token,expires_in})=>{
        if(location.origin!==new URL(url).origin)return;
        localStorage.setItem("hassTokens",JSON.stringify({hassUrl:url,access_token,refresh_token,expires_in,expires:Date.now()+(expires_in??1800)*1000,token_type:"Bearer",client_id:url+"/"}));
        addEventListener("unhandledrejection",event=>window.__homeostaticLabRejection({code:event.reason?.code,message:event.reason?.message??String(event.reason),stack:event.reason?.stack}));
      },lab));
      console.log("live startup trace");
      await boundedPhase("Trace initialization",()=>context.tracing.start({screenshots:true,snapshots:true,sources:true}));
      console.log("live startup page");
      const page=await boundedPhase("Browser page",()=>context.newPage());page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(30000);
      report.browser_errors=[];
      page.on("pageerror",error=>{
        report.browser_errors.push({name:error.name,message:error.message,stack:error.stack,case:page.acceptanceCase,at:new Date().toISOString()});
        report.diagnostics.push(`Browser: ${error.stack||error.message}`);
      });
      const consoleErrors=[];page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
      report.websocket_errors=[];
      let socketSequence=0;
      page.on("websocket",socket=>{
        const requests=new Map(),connection=++socketSequence;
        const packets=payload=>{try{const parsed=JSON.parse(payload);return Array.isArray(parsed)?parsed:[parsed];}catch{return [];}};
        socket.on("framesent",frame=>{for(const packet of packets(frame.payload))if(packet.id)requests.set(packet.id,{type:packet.type,subscription:packet.subscription});});
        socket.on("framereceived",frame=>{for(const packet of packets(frame.payload))if(packet.success===false){const request=requests.get(packet.id);report.websocket_errors.push({connection,request_id:packet.id,command:request?.type,subscription:request?.subscription,subscription_command:requests.get(request?.subscription)?.type,code:packet.error?.code,message:packet.error?.message});}});
      });
      console.log("live startup Home Assistant panel");
      await page.goto(lab.panel_url??lab.url+"/homeostatic");
      await page.locator('home-assistant').waitFor();
      await page.locator('#ha-launch-screen').waitFor({state:"detached",timeout:15000});
      const {runLiveCases}=await import("./ui_acceptance_cases.mjs");
      report.live_cases=await runLiveCases({page,lab,call:(type,fields)=>wsCall(lab,type,fields),record:record("live"),artifactDir:output,group:args.group});
      report.console_errors=consoleErrors;
      report.lab_status=await wsCall(lab,"homeostatic_ui_lab/control",{action:"status"});
      await page.locator('#ha-launch-screen').waitFor({state:"detached",timeout:15000});
      await page.screenshot({path:join(output,"final-viewport.png")});
      await page.screenshot({path:join(output,"final.png"),fullPage:true});report.artifacts.push("final.png","final-viewport.png","lab.log","trace.zip");
    }
  }catch(error){report.diagnostics.push(error.stack??String(error));console.error(error.message);}
  finally{
    const cleanup=async(label,operation)=>{try{await boundedPhase(label,operation,30000);}catch(error){report.diagnostics.push(`${label}: ${error.message}`);}};
    if(context){await cleanup("Trace",()=>context.tracing.stop({path:join(output,"trace.zip")}));await cleanup("Browser context",()=>context.close());}
    if(lab)await wsCall(lab,"homeostatic_ui_lab/control",{action:"shutdown"}).catch(()=>{});
    await cleanup("Home Assistant shutdown",()=>waitForExit(child));
    if(lab?.config_dir)await cleanup("Temporary Home Assistant configuration",async()=>{
      try{await stat(lab.config_dir);}catch(error){if(error.code==="ENOENT")return;throw error;}
      throw Error(`Disposable configuration remains at ${lab.config_dir}`);
    });
    logStream?.end();if(browser)await cleanup("Browser",()=>browser.close());if(server)await cleanup("Fixture server",()=>new Promise(done=>server.close(done)));
    await unlink(readyFile).catch(()=>{});
    await rmdir(credentialsDir).catch(error=>report.diagnostics.push(`Temporary credential directory cleanup: ${error.message}`));
    await cleanup("Candidate verification",async()=>{
      const finalHash=await fingerprint(component);if(finalHash!==candidate.component_sha256)report.diagnostics.push("Component changed during the run; results do not describe a single candidate.");
      report.environment.candidate_unchanged=finalHash===candidate.component_sha256;
      if(args.snapshot&&await fingerprint(join(sourceRoot,"tests/frontend"))!==candidate.fixture_sha256){report.environment.candidate_unchanged=false;report.diagnostics.push("Frozen fixtures changed during execution");}
      if(args.snapshot)report.environment.checkout_matches_snapshot=await fingerprint(join(root,"custom_components/homeostatic"))===candidate.component_sha256;
    });
    report.artifacts=[...new Set([...report.artifacts,...(await readdir(output)).filter(name=>!name.startsWith("report.")&&/\.(json|png|txt|zip|log)$/.test(name))])];
    for(const layer of ["fixtures","live"])for(const row of report[layer].results)if(row.status==="untested"&&!row.evidence.length)row.evidence.push(row.id==="layout.safari"?"Requires a physical iOS device; emulation is not physical Safari coverage.":"No complete assertion for this path was executed in this shard/layer.");
    await saveReport(report,output);
    process.off("SIGINT",interrupt);process.off("SIGTERM",interrupt);
  }
  console.log(`Report: ${join(output,"report.md")}`);
  process.exitCode=reportExitCode(report);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
