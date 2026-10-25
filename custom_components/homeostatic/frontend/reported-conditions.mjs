/** Presentation for HA's standard reported conditions in the existing policy workflow. */
export const REPORTED_CONDITIONS={
  problem:{name:"Problem sensors",noun:"problem sensors",title:"Problem reported",report:"a problem",profile:"morning",all:true},
  lawn_mower:{name:"Lawn mower errors",noun:"lawn mowers",title:"Mower error",report:"the mower is in error",all:true},
  tamper:{name:"Tamper",noun:"tamper sensors",title:"Tampering reported",report:"tampering"},
  safety:{name:"Unsafe condition",noun:"safety sensors",title:"Unsafe condition reported",report:"an unsafe condition"},
  moisture:{name:"Water leak",noun:"moisture sensors",title:"Moisture detected",report:"moisture detected"},
  smoke:{name:"Smoke detected",noun:"smoke sensors",title:"Smoke detected",report:"smoke detected"},
  gas:{name:"Gas detected",noun:"gas sensors",title:"Gas detected",report:"gas detected"},
  carbon_monoxide:{name:"Carbon monoxide detected",noun:"carbon monoxide sensors",title:"Carbon monoxide detected",report:"carbon monoxide detected"},
  alarm_triggered:{name:"Triggered alarm",noun:"alarm panels",title:"Alarm triggered",report:"the alarm is triggered"},
};

export function reportedConditionProblem(source,status) {
  const definition=REPORTED_CONDITIONS[source?.kind];
  if(!definition)return null;
  const current=status?.current,disabled=source.disabled,failed=current?.status==="fail",clear=current?.status==="pass";
  return {
    headline:disabled?"Disabled in Home Assistant":failed?definition.title:clear?"Condition not reported":"Waiting for current information",
    summary:current?.message||`Waiting for a current report from ${source.name}.`,
    nextStep:`Inspect ${source.name} in Home Assistant and follow the equipment's instructions.`,
    tone:disabled?"neutral":failed?"failure":clear?"neutral":"uncertain",
    progress:disabled?"Disabled":failed?"Needs attention":clear?"Not reported":"Waiting",
    context:definition.name,conditionName:definition.name,
    entityLabel:"View entity",reported:failed?current.message:null,
  };
}
