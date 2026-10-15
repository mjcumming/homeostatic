import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {observe,mergeReports,reportExitCode,validateLab,waitForReady} from "../../script/ui_acceptance.mjs";
import {emptyReceipt} from "./control-path-inventory.mjs";
import {installTransport} from "../../script/ui_acceptance_transport.mjs";

test("browser acceptance retains a failure across retries and other shards",()=>{
  const receipt=emptyReceipt();
  observe(receipt,"navigation.pages","fail","First attempt failed");
  observe(receipt,"navigation.pages","pass","Retry passed");
  observe(receipt,"navigation.pages","untested","Other shard did not run it");
  assert.equal(receipt.results.find(row=>row.id==="navigation.pages").status,"fail");
  assert.equal(receipt.results.find(row=>row.id==="navigation.pages").evidence.length,3);
});

test("fixture results never count as isolated Home Assistant results",()=>{
  const report={candidate:{component_sha256:"candidate"},fixtures:emptyReceipt(),live:emptyReceipt(),environment:{}};
  observe(report.fixtures,"navigation.pages","pass","Synthetic fixture");
  const merged=mergeReports([report]);
  assert.equal(merged.fixtures.results.find(row=>row.id==="navigation.pages").status,"pass");
  assert.equal(merged.live.results.find(row=>row.id==="navigation.pages").status,"untested");
  observe(report.live,"sources.maintenance","pass","Reachable action and visible Until only");
  const audited=mergeReports([report]);
  assert.equal(audited.live.results.find(row=>row.id==="sources.maintenance").status,"untested");
  assert.equal(audited.live.results.find(row=>row.id==="live.sources.maintenance").status,"pass");
  assert.throws(()=>mergeReports([report,{...report,candidate:{component_sha256:"changed"}}]),/different component/);
  assert.throws(()=>mergeReports(["first","second"].map(fixture_sha256=>({...report,candidate:{...report.candidate,fixture_sha256}}))),/different frozen fixture/);
  assert.throws(()=>mergeReports([{...report,environment:{candidate_unchanged:false}}]),/changed during execution/);
  assert.equal(reportExitCode(merged),2);
  observe(merged.live,"navigation.pages","fail","Real HA failure");
  assert.equal(reportExitCode(merged),1);
});

test("browser mutations require the runner's loopback lab",()=>{
  assert.doesNotThrow(()=>validateLab({url:"http://127.0.0.1:8127",access_token:"disposable"}));
  for(const url of ["http://homeassistant:8123","https://127.0.0.1:8127","http://192.168.1.20:8123"])
    assert.throws(()=>validateLab({url,access_token:"token"}),/loopback/);
});

test("unhandled browser rejection remains a failure after report merging",()=>{
  const rejection={case:"updates.retention",code:"not_found",message:"Subscription not found."};
  const report={candidate:{component_sha256:"candidate"},fixtures:emptyReceipt(),live:emptyReceipt(),environment:{group:"layout"},diagnostics:[],unhandled_rejections:[rejection]};
  const merged=mergeReports([report]);
  assert.deepEqual(merged.unhandled_rejections[0].detail,rejection);
  assert.equal(merged.unhandled_rejections[0].run.group,"layout");
  assert.equal(reportExitCode(merged),1);
});

test("readiness retries a write event received during an incomplete read",async()=>{
  const child=new EventEmitter();let changed,release,reads=0,closed=false;
  const incomplete=new Promise(resolve=>{release=resolve;});
  const ready=waitForReady("unused/ready.json",child,{
    read:()=>++reads===1?incomplete:Promise.resolve('{"ready":true}'),
    subscribe:(_directory,listener)=>{changed=listener;return {close:()=>{closed=true;}};},
  });
  changed();release('{');
  assert.deepEqual(await ready,{ready:true});assert.equal(reads,2);assert.equal(closed,true);
  assert.equal(child.listenerCount("exit"),0);assert.equal(child.listenerCount("error"),0);
});

test("a held browser request cannot be overtaken by later Home Assistant message ids",async()=>{
  const sent=[];let receive;
  const server={send:message=>sent.push(JSON.parse(message)),onMessage:()=>{}};
  const route={connectToServer:()=>server,onMessage:handler=>{receive=handler;},send:()=>{}};
  const page={routeWebSocket:async(_pattern,handler)=>handler(route)};
  const transport=await installTransport(page);transport.mode="hold";
  receive(JSON.stringify({id:4,type:"homeostatic/save_settings"}));
  receive(JSON.stringify({id:5,type:"homeostatic/configuration"}));
  receive(JSON.stringify({id:6,type:"ping"}));
  assert.deepEqual(sent,[]);transport.release();
  assert.deepEqual(sent.map(item=>item.id),[4,5,6]);
  assert.equal(transport.saveRequests,1);assert.equal(transport.configurationRequests,1);
});
