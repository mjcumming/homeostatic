import assert from "node:assert/strict";
import test from "node:test";
import {monitoringExample} from "./monitoring-fixture.mjs";

const elements=new Map();
const inertElement=()=>({innerHTML:"",addEventListener(){},setAttribute(){},append(){},querySelector(){return inertElement();}});
globalThis.HTMLElement=class {attachShadow(){this.shadowRoot=inertElement();}};
globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
globalThis.window={};
globalThis.document={createElement:()=>inertElement()};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const Card=elements.get("homeostatic-card");

test("primary labels describe the work while retaining the existing page routes",()=>{
  const card=new Card();
  const navigation=card.shadowRoot.innerHTML.match(/<nav class="nav"[^>]*>(.*?)<\/nav>/s)[1];
  assert.deepEqual([...navigation.matchAll(/data-page="([^"]+)">([^<]+)<\/button>/g)].map(([,page,label])=>[page,label]),
    [["problems","Open issues"],["sources","Monitoring"],["policies","Policies"],["notifications","Notifications"],["history","History"]]);
  card.current={status:"current",data:monitoringExample()};
  assert.match(card.sourcesPage(),/<h1>Monitoring<\/h1><p class="page-description">Devices, entities and integrations\.<\/p>/);
  assert.match(card.policiesPage(),/<h1>Monitoring policies<\/h1>/);
});

test("History has its own heading and is the only selected primary destination",()=>{
  const buttons=["problems","sources","policies","notifications","history"].map(page=>({dataset:{page},attributes:{},closest:()=>true,setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}}));
  const main={innerHTML:"",querySelector:()=>null},nodes={".nav":{},'[data-action="back"]':{},".workspace-status":{}};
  const card=Object.create(Card.prototype);
  Object.assign(card,{page:"history",config:{view:"history"},current:{status:"current",data:{inventory:{}}},main,
    shadowRoot:{querySelector:selector=>nodes[selector]||null,querySelectorAll:()=>buttons},
    tools:{historyPanel:()=>'<section><h2>Ended problems</h2></section>'},navigation:{updateReturn(){}},renderNotificationControl(){},observeSourceBranches(){}});
  card.renderPage();
  assert.deepEqual(buttons.filter(button=>button.attributes["aria-current"]==="page").map(button=>button.dataset.page),["history"]);
  assert.deepEqual([...main.innerHTML.matchAll(/<h1>([^<]+)<\/h1>/g)].map(([,text])=>text),["History"]);
  assert.match(main.innerHTML,/<h2>Ended problems<\/h2>/);
  assert.doesNotMatch(main.innerHTML,/Issue views|Current issues|workspace-tabs/);
});

test("the generated dashboard includes a separate History page",async()=>{
  const dashboard=await elements.get("ll-strategy-dashboard-homeostatic").generate();
  assert.deepEqual(dashboard.views.map(({title,path})=>({title,path})),[
    {title:"Open issues",path:"issues"},{title:"Monitoring",path:"sources"},{title:"Policies",path:"policies"},
    {title:"Notifications",path:"notifications"},{title:"History",path:"history"},
  ]);
  const history=dashboard.views.find(view=>view.path==="history");
  assert.equal(history.cards[0].view,"history");
  assert.equal(history.cards[0].navigation,false);
});

const {DashboardTools}=await import("../../custom_components/homeostatic/frontend/history-controls.mjs");

function historyTools(count=1) {
  const item={episode:{episode_id:"ended-0",anchor:"entity:one",opened_at:"2026-10-14T12:00:00Z",reasons:[{message:"First condition"},{message:"Second condition"}]},source:{name:"Hallway sensor",kind:"entity"},resolution:"cleared",resolved_at:"2026-10-14T13:00:00Z"};
  const data={inventory:{episodes:[],resolved_history:{episodes:Array.from({length:count},(_,i)=>({...item,episode:{...item.episode,episode_id:`ended-${i}`}})),retention:{max_episodes:100,max_age_days:30},started_at:"2026-10-01T00:00:00Z"}}};
  const dialog={open:false,close(){},showModal(){assert.fail("History must expand inline");}};
  const card={page:"history",detailSequence:0,dialog,current:{status:"current",data},main:{querySelectorAll:()=>[]},render(){this.html=this.tools.historyPanel(data);}};
  card.tools=Object.assign(Object.create(DashboardTools.prototype),{card,dialog,query:"",resolution:"",page:0,revision:0,operation:0});
  return {tools:card.tools,card,data};
}

test("History expands and collapses a row without a dialog or repeated findings",()=>{
  const {tools,card}=historyTools();
  assert.doesNotMatch(tools.historyPanel(card.current.data),/data-tool="previous"|data-tool="next"/);
  tools.showHistory("ended-0");
  assert.match(card.html,/data-history-toggle="ended-0"[^>]*aria-expanded="true"/);
  assert.equal((card.html.match(/First condition/g)||[]).length,1);
  assert.equal((card.html.match(/Second condition/g)||[]).length,1);
  assert.match(card.html,/Observed[\s\S]*1 hr/);
  assert.doesNotMatch(card.html,/Recorded details|clearance rule|does not establish|history-findings/);
  tools.clicked({target:{closest:()=>({dataset:{historyToggle:"ended-0"}})}});
  assert.match(card.html,/data-history-toggle="ended-0"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(card.html,/First condition|Second condition/);
});

test("History reveals linked entries across pages and incompatible filters",()=>{
  const {tools,card}=historyTools(45);
  tools.query="does not match";tools.resolution="removed";card.page="sources";
  tools.showHistory("ended-42");
  assert.equal(card.page,"history");
  assert.equal(tools.page,2);
  assert.equal(tools.query,"");
  assert.equal(tools.resolution,"");
  assert.match(card.html,/data-history-toggle="ended-42"[^>]*aria-expanded="true"/);
  assert.match(card.html,/data-tool="previous"/);
  tools.update(card.current);
  assert.equal(tools.historyId,"ended-42");
  assert.equal(tools.page,2);
  tools.showHistory("expired");
  assert.match(card.html,/no longer in retained history/);
});

test("entity availability History says the condition once without claiming physical recovery",()=>{
  const {tools,card,data}=historyTools();
  data.inventory.resolved_history.episodes[0].episode.reasons=[{check_id:"availability",reason:"unavailable",message:"Hallway sensor: unavailable"},{check_id:"another-policy",reason:"unavailable",message:"Hallway sensor: unavailable"}];
  tools.showHistory("ended-0");
  assert.equal((card.html.match(/Home Assistant reported this entity as unavailable/g)||[]).length,1);
  assert.doesNotMatch(card.html,/Hallway sensor: unavailable|Later,|physical|valid reading|Recorded details/);
});

test("live additions keep the expanded History item visible across page boundaries",()=>{
  const {tools,card,data}=historyTools(21);
  tools.showHistory("ended-19");
  const item=data.inventory.resolved_history.episodes[0];
  data.inventory.resolved_history.episodes.unshift({...item,episode:{...item.episode,episode_id:"newest"}});
  tools.update(card.current);card.render();
  assert.equal(tools.page,1);
  assert.match(card.html,/data-history-toggle="ended-19"[^>]*aria-expanded="true"/);
  tools.clicked({target:{closest:()=>({dataset:{tool:"previous"}})}});
  assert.equal(tools.page,0);
  assert.equal(tools.historyId,null);
});

test("grouped History preserves distinct recorded member evidence",()=>{
  const {tools,card,data}=historyTools();
  Object.assign(data.inventory.resolved_history.episodes[0].episode,{form:"group",reasons:[
    {node_id:"entity:one",reason:"unavailable",message:"Hallway sensor unavailable"},
    {node_id:"entity:two",reason:"unavailable",message:"Bedroom sensor unavailable"},
  ]});
  tools.showHistory("ended-0");
  assert.match(card.html,/Hallway sensor unavailable/);
  assert.match(card.html,/Bedroom sensor unavailable/);
  assert.match(card.html,/Individual issues may still be open/);
});

test("restoring a History entry can preserve the caller's focus and scroll position",()=>{
  const {tools,card}=historyTools();
  card.main.querySelectorAll=()=>[{dataset:{historyToggle:"ended-0"},focus(){assert.fail("Must retain restored focus");},scrollIntoView(){assert.fail("Must retain restored scroll");}}];
  tools.showHistory("ended-0",{focus:false});
  assert.match(card.html,/data-history-toggle="ended-0"[^>]*aria-expanded="true"/);
});

const {WorkspaceNavigation,hasWorkspaceDrafts,workspacePath,workspaceRoute}=await import("../../custom_components/homeostatic/frontend/workspace-navigation.mjs");
const {notificationSettings}=await import("./notification-profiles-fixture.mjs");

for(const [name,attribute,query,resolution] of [
  ["search","data-history-search","Hallway",""],
  ["outcome filter","data-history-filter","","cleared"],
])test(`History ${name} clears the selected route once while retaining the expanded Back destination`,context=>{
  const originalWindow=globalThis.window;
  context.after(()=>{globalThis.window=originalWindow;});
  const location={pathname:"/homeostatic/history/ended-0",href:"/homeostatic/history/ended-0"},pushed=[];
  const history={state:null,replaceState(state,_title,url){this.state=state;location.pathname=url;location.href=url;},pushState(state,_title,url){this.state=state;location.pathname=url;location.href=url;pushed.push(url);}};
  globalThis.window={location,history};
  const {tools,card}=historyTools();
  Object.assign(card,{configuration:{},renderedCurrent:false,shadowRoot:{querySelector:()=>null}});
  card.navigation=new WorkspaceNavigation(card);
  card.navigation.enabled=true;
  tools.showHistory("ended-0");
  const expanded=card.navigation.capture();
  const fields={"[data-history-search]":{value:query},"[data-history-filter]":{value:resolution}};
  card.main.querySelector=selector=>fields[selector];
  const event={target:{hasAttribute:value=>value===attribute}};
  tools.input(event);
  assert.equal(tools.historyId,null);
  assert.equal(location.pathname,"/homeostatic/history");
  assert.equal(history.state.homeostatic.route.historyId,null);
  assert.deepEqual({query:tools.query,resolution:tools.resolution},{query,resolution});
  assert.equal(card.navigation.entries.get(expanded.id).route.historyId,"ended-0");
  tools.input(event);
  assert.deepEqual(pushed,["/homeostatic/history"]);
});

test("Back restores related-history focus and scroll after its expanded content is present",()=>{
  const {tools,card,data}=historyTools();
  Object.assign(data.inventory.resolved_history.episodes[0],{resolution:"absorbed",absorbed_into:"open"});
  data.inventory.episodes=[{episode_id:"open"}];
  let restored=null;
  Object.assign(card,{configuration:{},renderedCurrent:true,shadowRoot:{querySelector:()=>null},
    capturePageState:()=>({focusedEpisode:"open",scroll:320}),
    restorePageState(state){
      assert.match(this.html,/data-history-toggle="ended-0"[^>]*aria-expanded="true"/);
      assert.match(this.html,new RegExp(`data-open-episode="${state.focusedEpisode}"`));
      restored=state;
    },
    openDetail(selection){this.detail=selection;},
  });
  card.navigation=new WorkspaceNavigation(card);
  tools.showHistory("ended-0");
  const expanded=card.navigation.capture();
  tools.clicked({target:{closest:()=>({dataset:{openEpisode:"open"}})}});
  card.navigation.finish(expanded);
  assert.equal(workspacePath(workspaceRoute(card)),"/episode/open");
  assert.equal(card.navigation.back(),true);
  assert.equal(workspacePath(workspaceRoute(card)),"/history/ended-0");
  assert.deepEqual(restored,{focusedEpisode:"open",scroll:320});
});
function navigationCard() {
  const settings=notificationSettings(),draft=structuredClone(settings);
  draft.monitoring_policies[0].name="Unsaved policy";
  draft.notification_definitions.methods.phone.name="Unsaved phone";
  draft.notification_definitions.profiles.morning.name="Unsaved summary";
  const card=Object.assign(Object.create(Card.prototype),{
    page:"policies",configuration:{settings},settingsDraft:draft,current:{status:"current"},renderedCurrent:false,
    dialog:{close(){}},shadowRoot:{querySelector:()=>null},
    render(){this.navigation.updateReturn();},revealSourcesSelection(){},
    loadConfiguration(){assert.fail("Navigation must preserve the loaded configuration and drafts");},
  });
  card.navigation=new WorkspaceNavigation(card);
  return card;
}

function buttonClick(dataset,inPrimaryNavigation=false) {
  const navigation={tagName:"NAV",className:"nav",role:"navigation"};
  const button={dataset,closest(selector){return selector==="button"?this:selector===".nav"&&inPrimaryNavigation?navigation:null;}};
  return {type:"click",target:{matches:()=>false,closest:selector=>button.closest(selector)}};
}

for(const [page,kind,id,path] of [
  ["policies","policies","policy-1","/policies"],
  ["notifications","profiles","morning","/notifications"],
  ["notifications","methods","phone","/notifications/methods"],
])test(`primary ${page} navigation returns from ${kind} editor to its list and preserves all drafts`,()=>{
  const card=navigationCard(),draft=card.settingsDraft,before=structuredClone(draft);
  Object.assign(card,{page,definitionSelection:{kind,id},notificationSection:kind,policyCreating:true,policyPicker:{kind:"source"}});
  card.clicked(buttonClick({page},true));
  assert.equal(card.definitionSelection,null);
  assert.equal(card.policyCreating,false);
  assert.equal(card.policyPicker,null);
  assert.equal(workspacePath(workspaceRoute(card)),path);
  assert.equal(card.workspaceReturn,null);
  assert.equal(card.settingsDraft,draft);
  assert.deepEqual(card.settingsDraft,before);
  assert.equal(hasWorkspaceDrafts(card),true);
});

test("primary Monitoring navigation returns to the tree while retaining selection and drafts",()=>{
  const card=navigationCard(),draft=card.settingsDraft;
  Object.assign(card,{page:"sources",sourcesSelection:"source:entity:light.deck",sourcesMobileDetail:true});
  card.clicked(buttonClick({page:"sources"},true));
  assert.equal(card.page,"sources");
  assert.equal(card.sourcesMobileDetail,false);
  assert.equal(card.sourcesSelection,"source:entity:light.deck");
  assert.equal(card.workspaceReturn,null);
  assert.equal(card.settingsDraft,draft);
  assert.equal(hasWorkspaceDrafts(card),true);
});

test("a contextual page button preserves its selected editor",()=>{
  const card=navigationCard(),selection={kind:"policies",id:card.settingsDraft.monitoring_policies[0].id};
  Object.assign(card,{page:"sources",definitionSelection:selection,sourcesSelection:"source:entity:light.deck"});
  card.clicked(buttonClick({page:"policies"}));
  assert.equal(card.page,"policies");
  assert.equal(card.definitionSelection,selection);
  assert.equal(card.workspaceReturn.label,"Back to source");
});

test("an issue opened from Monitoring still offers Back to issue after following a source link",()=>{
  const card=navigationCard();
  Object.assign(card,{page:"sources",sourcesSelection:"source:entity:old",sourcesMobileDetail:true,detail:{episodeId:"issue-from-source"}});
  card.clicked(buttonClick({sourceLink:"entity:new"}));
  assert.equal(card.detail,null);
  assert.equal(card.sourcesSelection,"source:entity:new");
  assert.equal(card.workspaceReturn.label,"Back to issue");
  const origin=card.navigation.entries.get(card.workspaceReturn.id);
  assert.equal(origin.route.detail.episodeId,"issue-from-source");
});
