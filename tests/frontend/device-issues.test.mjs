import test from "node:test";
import assert from "node:assert/strict";
import {issueDeviceGroups,issueGroups,issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";
import {issueEvidenceFixture} from "./issue-evidence-fixture.mjs";

globalThis.HTMLElement=class {};
const elements=new Map();
globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const cardPrototype=elements.get("homeostatic-card").prototype;

const episode=(id,anchor,fields={})=>({episode_id:id,anchor,recorded:[anchor],impact:[],reasons:[{node_id:anchor,status:"fail",reason:"unavailable",message:"Home Assistant reports unavailable."}],importance:"normal",opened_at:"2026-10-15T10:00:00Z",...fields});
const issueIds=groups=>groups.flatMap(group=>group.episodes.map(item=>item.episode_id));
const renderedIds=html=>[...html.matchAll(/data-episode="([^"]+)"/g)].map(match=>match[1]);
const deviceIds=html=>[...html.matchAll(/data-issue-device="([^"]+)"/g)].map(match=>match[1]);
const cardFor=data=>({current:{data},issueGroupsExpanded:new Set(["integration:esphome"]),issueGroupLimits:new Map(),issueRow:(_,item,_nodes,group)=>`<button data-episode="${item.episode_id}" data-row-device="${group?.deviceId||""}">${item.episode_id}</button>`});

test("a retained issue without source metadata still renders its exact action",()=>{
  const data=monitoringExample(),item=episode("retained","missing"),card={current:{data},displaySourceName:cardPrototype.displaySourceName,_hass:{}};
  const html=cardPrototype.issueRow.call(card,data,item,new Map());
  assert.match(html,/data-episode="retained"/);
  assert.match(html,/Monitored source/);
});

test("loaded integration findings and independent findings share their one recorded device",()=>{
  const {data,episode:shared}=issueEvidenceFixture({variant:"phone"});
  const member=data.inventory.nodes.find(source=>source.kind==="entity"&&source.attributes?.device?.[0]);
  const independent=episode("independent",member.node_id);
  const groups=issueDeviceGroups(data,[shared,independent]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].deviceId,member.attributes.device[0]);
  assert.deepEqual(issueIds(groups),[shared.episode_id,"independent"]);
});

test("device rows omit grouping labels while preserving the original issue and condition",()=>{
  const {data,episode:shared,nodes}=issueEvidenceFixture();
  const groups=issueDeviceGroups(data,[shared]);
  const card={current:{data},displaySourceName:cardPrototype.displaySourceName,_hass:{}};
  assert.equal(groups.length,3);
  for(const group of groups){
    const html=cardPrototype.issueRow.call(card,data,group.episodes[0],nodes,group);
    assert.deepEqual(renderedIds(html),[shared.episode_id]);
    assert.match(html,/<strong class="issue-title">Availability<\/strong>/);
    assert.match(html,/unavailable/);
    assert.match(html,/Since /);
    assert.doesNotMatch(html,/shared issue|3 devices/i);
  }
});

test("grouped production rows name the media-player capability",()=>{
  const data=fixture(),nodes=new Map(data.inventory.nodes.map(source=>[source.node_id,source]));
  data.inventory.nodes.filter(source=>source.kind==="entity").forEach(source=>{source.name="Xiaozhi Ball";});
  data.inventory.entity_status={"check:device:ball":{current:{reason:"all_unavailable"}},"check:entity:player":{current:{reason:"unavailable"}}};
  const card={current:{data},displaySourceName:cardPrototype.displaySourceName,_hass:{}};
  const subject=issueDeviceGroups(data,data.inventory.episodes)[0];
  data.inventory.episodes[0].importance="critical";
  const player=cardPrototype.issueRow.call(card,data,data.inventory.episodes[1],nodes,subject);
  assert.match(player,/<strong class="issue-title">Media player<\/strong>/);
  assert.match(player,/aria-label="Xiaozhi Ball: Media player\./);
  assert.doesNotMatch(player,/<strong class="issue-title">Xiaozhi Ball<\/strong>/);
});

for(const member of ["entity:standalone","missing"])test(`recorded ${member} cannot be presented as a member of the anchor device`,()=>{
  const data=fixture(),standalone=baseSource("entity:standalone","Weather","entity",{entity_id:"sensor.weather",attributes:{}});
  data.inventory.nodes.push(standalone);
  const item={...data.inventory.episodes[0],recorded:[data.inventory.episodes[0].anchor,member]};
  const groups=issueDeviceGroups(data,[item]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].deviceId,null);
  assert.equal(groups[0].episodes[0],item);
});

function fixture(domain="esphome") {
  const data=monitoringExample();
  const entry=baseSource(`entry:${domain}`,domain,"integration",{entry_id:domain,attributes:{domain:[domain]}});
  const device=baseSource("device:ball","Xiaozhi Ball","device",{owner_id:domain,attributes:{device:["ball"],integration:[domain]}});
  const entity=baseSource("entity:player","Player","entity",{owner_id:domain,entity_id:"media_player.ball",attributes:{device:["ball"],integration:[domain]}});
  const condition=baseSource("temperature:room","Room temperature","temperature_limit",{owner_id:domain,entity_id:"sensor.room_temperature",attributes:{device:["ball"],integration:[domain]}});
  const checks=[device,entity,condition].map(source=>({...source,node_id:`check:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:"example",watched:true}));
  data.devices=[{id:"ball",name:"Registry ball",config_entry_id:domain}];
  data.inventory.nodes=[entry,device,entity,condition,...checks];
  data.inventory.catalog.candidates=[entry,device,entity,condition];
  data.inventory.episodes=checks.map((source,index)=>episode(`issue-${index}`,source.node_id));
  return data;
}

for(const domain of ["esphome","mqtt","zwave_js"])test(`${domain} device, entity and derived findings share one device without changing issues`,()=>{
  const data=fixture(domain),before=structuredClone(data),groups=issueDeviceGroups(data,data.inventory.episodes);
  assert.equal(groups.length,1);
  assert.equal(groups[0].deviceId,"ball");
  assert.equal(groups[0].name,"Xiaozhi Ball");
  assert.deepEqual(issueIds(groups),["issue-0","issue-1","issue-2"]);
  assert.equal(groups[0].episodes[0],data.inventory.episodes[0]);
  assert.deepEqual(data,before);
});

test("device identity comes from registry associations rather than matching names",()=>{
  const data=fixture(),other=baseSource("device:other","Xiaozhi Ball","device",{owner_id:"esphome",attributes:{device:["other"],integration:["esphome"]}});
  const standalone=baseSource("entity:standalone","Xiaozhi Ball","entity",{owner_id:"esphome",entity_id:"sensor.standalone",attributes:{integration:["esphome"]}});
  data.inventory.nodes.push(other,standalone);
  data.inventory.episodes.push(episode("other",other.node_id),episode("standalone",standalone.node_id));
  const groups=issueDeviceGroups(data,data.inventory.episodes);
  assert.deepEqual(groups.map(group=>group.deviceId),["ball","other",null]);
  assert.deepEqual(groups.slice(0,2).map(group=>group.name),["Xiaozhi Ball","Xiaozhi Ball"]);
  assert.notEqual(groups[0].key,groups[1].key);
  assert.equal(groups[2].key,"issue:standalone");
  assert.deepEqual(issueIds(groups),["issue-0","issue-1","issue-2","other","standalone"]);
});

test("aliases without copied device metadata use their canonical source association",()=>{
  const data=fixture();
  data.inventory.nodes.filter(source=>source.monitoring_source).forEach(source=>{source.attributes={};});
  const groups=issueDeviceGroups(data,data.inventory.episodes);
  assert.deepEqual(groups.map(group=>group.deviceId),["ball"]);
  assert.deepEqual(issueIds(groups),["issue-0","issue-1","issue-2"]);
});

test("the registry owning connection keeps one device under one integration",()=>{
  const data=fixture(),entry=baseSource("entry:other","Other integration","integration",{entry_id:"other",attributes:{domain:["other"]}});
  data.inventory.nodes.push(entry);
  data.inventory.nodes.filter(source=>source.kind==="device").forEach(source=>{delete source.owner_id;source.attributes.integration=["other","esphome"];});
  const groups=issueGroups(data);
  assert.deepEqual(groups.map(group=>group.key),["integration:esphome"]);
  assert.deepEqual(groups[0].episodes.map(item=>item.episode_id),["issue-0","issue-1","issue-2"]);
});

test("runtime temperature checks with direct registry metadata need no fabricated canonical source",()=>{
  const data=fixture(),check=data.inventory.nodes.find(source=>source.node_id==="check:temperature:room");
  delete check.monitoring_source;
  data.inventory.nodes=data.inventory.nodes.filter(source=>source.node_id!=="temperature:room");
  data.inventory.catalog.candidates=data.inventory.catalog.candidates.filter(source=>source.node_id!=="temperature:room");
  const groups=issueDeviceGroups(data,data.inventory.episodes);
  assert.deepEqual(groups.map(group=>group.deviceId),["ball"]);
  assert.deepEqual(issueIds(groups),["issue-0","issue-1","issue-2"]);
});

test("a device without a canonical source uses registry display metadata and an explicit missing-name fallback",()=>{
  const data=fixture();
  data.inventory.nodes=data.inventory.nodes.filter(source=>source.node_id!=="device:ball");
  data.inventory.catalog.candidates=data.inventory.catalog.candidates.filter(source=>source.node_id!=="device:ball");
  const findings=data.inventory.episodes.slice(1);
  assert.equal(issueDeviceGroups(data,findings)[0].name,"Registry ball");
  data.devices=[];
  assert.equal(issueDeviceGroups(data,findings)[0].name,"Device details unavailable");
  assert.equal(issueDeviceGroups(data,findings)[0].deviceId,"ball");
});

test("same-device recorded members share one heading while dependent impact does not change placement",()=>{
  const data=fixture(),other=baseSource("device:other","Other device","device",{attributes:{device:["other"]}});
  data.inventory.nodes.push(other);
  const shared=episode("shared","check:device:ball",{recorded:["check:device:ball","check:entity:player","check:temperature:room"],impact:[other.node_id]});
  const groups=issueDeviceGroups(data,[shared]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].deviceId,"ball");
  assert.deepEqual(issueIds(groups),["shared"]);
});

test("one issue with recorded findings across devices stays independent and appears exactly once",()=>{
  const data=fixture(),other=baseSource("device:other","Other device","device",{owner_id:"esphome",attributes:{device:["other"],integration:["esphome"]}});
  data.inventory.nodes.push(other);
  const shared=episode("shared","check:device:ball",{recorded:["check:device:ball",other.node_id],reasons:[{node_id:"check:device:ball",status:"fail",message:"Unavailable"},{node_id:other.node_id,status:"fail",message:"Unavailable"}]});
  data.inventory.episodes=[shared];
  const groups=issueDeviceGroups(data,data.inventory.episodes);
  assert.deepEqual(groups.map(group=>group.deviceId),[null]);
  assert.deepEqual(issueIds(groups),["shared"]);
  const html=issuesWorkspace(cardFor(data));
  assert.deepEqual(renderedIds(html),["shared"]);
  assert.deepEqual(deviceIds(html),[]);
});

for(const kind of ["integration","repair","broken_automation","situation"])test(`${kind} issues remain independent even when metadata mentions a device`,()=>{
  const data=fixture(),source=baseSource(`special:${kind}`,"Independent source",kind,{attributes:{device:["ball"]}});
  data.inventory.nodes.push(source);
  const finding=episode("independent",source.node_id),groups=issueDeviceGroups(data,[finding]);
  assert.equal(groups[0].deviceId,null);
  assert.equal(groups[0].key,"issue:independent");
  assert.equal(groups[0].episodes[0],finding);
});

test("device headings appear once and findings retain their device context",()=>{
  const data=fixture(),html=issuesWorkspace(cardFor(data));
  assert.deepEqual(deviceIds(html),["ball"]);
  assert.equal((html.match(/class="issue-device-title"/g)||[]).length,1);
  assert.match(html,/Xiaozhi Ball/);
  assert.match(html,/1 affected device/);
  assert.match(html,/3 issues/);
  assert.deepEqual(renderedIds(html),["issue-0","issue-1","issue-2"]);
  assert.equal((html.match(/data-row-device="ball"/g)||[]).length,3);
});

test("search matches device names and keeps only matching findings with their heading",()=>{
  const data=fixture(),card=cardFor(data);
  card.issueGroupsExpanded.clear();card.issueQuery="Xiaozhi Ball";
  const deviceSearch=issuesWorkspace(card);
  assert.deepEqual(renderedIds(deviceSearch),["issue-0","issue-1","issue-2"]);
  assert.deepEqual(deviceIds(deviceSearch),["ball"]);
  card.issueQuery="media_player.ball";
  const entitySearch=issuesWorkspace(card);
  assert.deepEqual(renderedIds(entitySearch),["issue-1"]);
  assert.deepEqual(deviceIds(entitySearch),["ball"]);
  assert.match(entitySearch,/1 affected device/);
  assert.match(entitySearch,/1 issue/);
  assert.doesNotMatch(entitySearch,/class="issue-count">3 issues/);
});

test("sorting orders device headings by their leading matching issue and preserves every issue",()=>{
  const data=fixture(),other=baseSource("device:other","Alpha device","device",{owner_id:"esphome",attributes:{device:["other"],integration:["esphome"]}});
  data.inventory.nodes.push(other);
  data.inventory.episodes[0].opened_at="2026-10-15T12:00:00Z";
  data.inventory.episodes[1].opened_at="2026-10-15T09:00:00Z";
  data.inventory.episodes.push(episode("other",other.node_id,{opened_at:"2026-10-15T08:00:00Z"}));
  const card=cardFor(data);
  const newest=issuesWorkspace(card);
  assert.deepEqual(deviceIds(newest),["ball","other"]);
  assert.deepEqual(renderedIds(newest),["issue-0","issue-2","issue-1","other"]);
  card.issueSort="oldest";
  const oldest=issuesWorkspace(card);
  assert.deepEqual(deviceIds(oldest),["other","ball"]);
  assert.deepEqual(renderedIds(oldest),["other","issue-1","issue-2","issue-0"]);
  card.issueSort="name";
  const names=issuesWorkspace(card);
  assert.deepEqual(deviceIds(names),["other","ball"]);
  assert.deepEqual([...renderedIds(names)].sort(),["issue-0","issue-1","issue-2","other"]);
});

test("pagination retains a single device heading and exposes every exact issue once",()=>{
  const data=fixture();
  data.inventory.episodes=Array.from({length:45},(_,index)=>episode(`issue-${String(index).padStart(2,"0")}`,"check:entity:player"));
  const card=cardFor(data),initial=issuesWorkspace(card);
  assert.deepEqual(deviceIds(initial),["ball"]);
  assert.equal(renderedIds(initial).length,40);
  assert.match(initial,/Showing 40 of 45/);
  card.issueGroupLimits.set("integration:esphome",80);
  const expanded=issuesWorkspace(card);
  assert.deepEqual(deviceIds(expanded),["ball"]);
  assert.deepEqual(renderedIds(expanded),data.inventory.episodes.map(item=>item.episode_id));
  assert.doesNotMatch(expanded,/data-issue-more=/);
});

test("device headings escape names and device identities",()=>{
  const data=fixture(),device=data.inventory.nodes.find(source=>source.node_id==="device:ball");
  device.name='<img src=x onerror="bad()">';
  const html=issuesWorkspace(cardFor(data));
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|onerror="bad/);
});
