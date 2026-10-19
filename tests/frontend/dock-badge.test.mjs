import assert from "node:assert/strict";
import {test} from "node:test";
import {sourcesBrowser,sourcesTree,sourcePaths} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {visibleEpisodes} from "../../custom_components/homeostatic/frontend/model.mjs";
import {dockBadgeFixture} from "./dock-badge-fixture.mjs";

const badge=(html,id)=>html.split(`data-sources-select="source:${id}"`)[1]?.split("</button>")[0].includes('class="source-issue-count"')||false;

for(const grouping of ["integration","location"])for(const condition of ["restored","unmonitored","unavailable","error"]) {
  test(`Dock ${condition} badges use current problem evidence in ${grouping} grouping`,()=>{
    const {data,entity,device,entities}=dockBadgeFixture(condition),before=structuredClone(data);
    const card={current:{data},sourcesGrouping:grouping,sourcesQuery:"",sourcesNeedsReview:false,sourcesSelection:null,
      sourcesExpanded:new Set(sourcePaths(sourcesTree(data,grouping)).keys())};
    const html=sourcesBrowser(card),currentProblem=["unavailable","error"].includes(condition);
    assert.equal(html.includes('class="source-issue-count"'),currentProblem);
    assert.equal(badge(html,device.node_id),condition==="unavailable");
    assert.equal(badge(html,entity.node_id),condition==="unavailable");
    for(const unmonitored of entities.filter(source=>source!==entity))assert.equal(badge(html,unmonitored.node_id),false);
    assert.equal(visibleEpisodes(data).length,currentProblem?1:0);
    if(condition==="restored") {
      assert.equal(data.inventory.episodes.length,2,"Presentation preserves both unresolved issues");
      assert.equal(data.inventory.entity_status[data.inventory.episodes[0].anchor].last_failure.reason,"all_unavailable");
      assert.match(html,/Not monitored/);
    }
    assert.deepEqual(data,before,"Browsing never changes monitoring, evidence or issue lifecycle");
  });
}
