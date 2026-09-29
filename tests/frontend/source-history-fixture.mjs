import {baseSource} from "./monitoring-fixture.mjs";

/** Synthetic MQTT episodes with retained evidence and distinct terminal outcomes. */
export function sourceHistoryExample() {
  const sources = [
    baseSource("entry:mqtt","MQTT","integration",{entry_id:"mqtt",attributes:{domain:["mqtt"]},watched:true}),
    baseSource("device:porch","Porch sensor","device",{attributes:{device:["porch"],integration:["mqtt"]},watched:true}),
    baseSource("device:garage","Garage relay","device",{attributes:{device:["garage"],integration:["mqtt"]},watched:true}),
  ];
  const episode = (id,anchor,message,opened_at) => ({episode_id:id,anchor,reasons:[{message}],opened_at,labels:{name:"Retained source"},importance:"normal",impact:[],status:"warn"});
  const open = episode("open","device:porch","Home Assistant reports the porch temperature entity as unavailable.","2026-09-26T21:56:54Z");
  const ended = (id,resolution,name,resolved_at) => ({episode:episode(id,"device:garage","Home Assistant reported the garage relay entity as unavailable.","2026-09-28T21:00:00Z"),source:{node_id:"device:garage",name,kind:"device"},resolution,resolved_at,absorbed_into:resolution==="absorbed"?"open":null});
  return {schema_version:1,available:true,entry_id:"demo",updated_at:"2026-09-29T12:00:00Z",functions:[],areas:[],floors:[],devices:[{id:"porch",name:"Porch sensor"},{id:"garage",name:"Garage relay"}],
    coverage:{no_checks:[],never_observed:[],stale:[]},policy:{notifications_enabled:false,routes:{},episodes:[]},
    inventory:{nodes:sources,catalog:{candidates:sources},episodes:[open],operator_controls:[],enrollment_changes:[],notification_requests:[],entity_status:{},integration_evidence:{},resolved_history:{started_at:"2026-09-26T12:00:00Z",retention:{max_age_days:30,max_episodes:100},episodes:[
      ended("removed","removed","Garage relay before rename","2026-09-28T23:00:00Z"),
      ended("cleared","cleared","Garage relay","2026-09-29T04:17:12Z"),
      ended("absorbed","absorbed","Garage relay","2026-09-28T22:00:00Z"),
    ]}}};
}
