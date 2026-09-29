/** Interleaved rules reproduce the owner's 19-rule Settings page. */
export function monitoringPolicyRules() {
  return [
    {id:"entities",action:"attach",enabled:true,match:{entity:["registry:porch-status","registry:porch-temperature"]},checks:["availability"]},
    {id:"connections",action:"attach",enabled:true,match:{kind:["integration"]},checks:["availability"]},
    ...Array.from({length:17},(_,index)=>({id:`device_${index}`,action:"attach",enabled:true,
      match:{kind:["device"],device:[index===0?"porch":`device-${index}`]},checks:["availability"]})),
  ];
}
