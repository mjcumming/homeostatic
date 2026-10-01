import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cardView,notificationRoute,applyNotificationRoute} from "../../custom_components/homeostatic/frontend/notification-navigation.mjs";

for (const [view,page] of [[undefined,"overview"], ["issues","problems"], ["settings","configuration"], ["problems","problems"], ["configuration","configuration"], ["sources","sources"], ["house","house"], ["functions","overview"]]) {
  test(`card view ${view} opens ${page}`,()=>assert.equal(cardView(view),page));
}

for (const [path,expected] of [["/issues",{page:"problems",episodeId:null}], ["/notifications",{page:"notifications",episodeId:null}], ["/history",{page:"history",episodeId:null}], ["/episode/a%2Fb%20%23%C3%A9",{page:"problems",episodeId:"a/b #é"}], ["/episode/%ZZ",{page:"problems",episodeId:null}], ["/episode/",{page:"problems",episodeId:null}]]) {
  test(`notification route ${path}`,()=>assert.deepEqual(notificationRoute(path),expected));
}
function card(status="current") {
  return {current:{status},isConnected:true,tools:{close(){}},dialog:{close(){}},render(){},opened:[],openDetail(value){this.opened.push(value);}};
}
test("cold start queues the issue and a later summary discards stale pending navigation",()=>{
  const c=card("loading");applyNotificationRoute(c,"/episode/first");
  assert.equal(c.pendingEpisode,"first");assert.deepEqual(c.opened,[]);
  applyNotificationRoute(c,"/issues");assert.equal(c.pendingEpisode,null);assert.equal(c.page,"problems");
});
test("taps open details once, with no action or acknowledgment call",()=>{
  const c=card();c._hass={callWS(){throw Error("Navigation must not mutate HA");}};
  applyNotificationRoute(c,"/episode/first");applyNotificationRoute(c,"/episode/first");
  assert.deepEqual(c.opened,[{episodeId:"first"}]);
  applyNotificationRoute(c,"/episode/second");assert.equal(c.opened[1].episodeId,"second");
});
const source=readFileSync(new URL("../../custom_components/homeostatic/frontend/homeostatic.js",import.meta.url),"utf8");
const detailBody=source.replace(/\r\n/g, "\n").split("  async loadDetail() {")[1].split("\n}\n\nclass HomeostaticPanel")[0];
const loadDetail=new Function(`return async function(){${detailBody.slice(0,detailBody.lastIndexOf("\n  }"))}}`)();
for(const resolution of ["cleared","removed","absorbed"]) {
  test(`an ended notification opens retained ${resolution} history without a current-source query`,async()=>{
    const c=card();c.detail={episodeId:"past"};c.detailSequence=0;
    c.current.data={inventory:{episodes:[],resolved_history:{episodes:[{episode:{episode_id:"past"},resolution}]}}};
    c.shadowRoot={querySelector(){return {};}};c.tools.showHistory=(id)=>{c.history=id;};
    await loadDetail.call(c);assert.equal(c.page,"history");assert.equal(c.history,"past");
  });
}
test("expired history explains the limit rather than claiming recovery",async()=>{
  const c=card();c.detail={episodeId:"expired"};c.detailSequence=0;
  c.current.data={inventory:{episodes:[],resolved_history:{episodes:[]}}};
  const body={};c.shadowRoot={querySelector(){return body;}};
  await loadDetail.call(c);assert.match(body.innerHTML,/outcome cannot be determined/);
  assert.match(body.innerHTML,/Open Issues/);assert.match(body.innerHTML,/Open History/);
});
test("a disconnected notification does not misidentify an issue as resolved",async()=>{
  const c=card("disconnected");c.detail={episodeId:"past"};c.detailSequence=0;
  const body={};c.shadowRoot={querySelector(){return body;}};
  await loadDetail.call(c);assert.match(body.innerHTML,/evidence is unavailable/);
});
