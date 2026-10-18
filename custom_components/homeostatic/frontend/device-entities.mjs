/** Count the complete inspected membership without treating absent evidence as available. */
export function deviceEntitySummary(evidence, {monitored=true}={}) {
  const members=evidence?.members||[],total=evidence?.total??members.length;
  const completeCounts=Number.isInteger(evidence?.unavailable_count)&&Number.isInteger(evidence?.unknown_count);
  const unavailable=evidence?.unavailable_count??members.filter(member=>member.state==="unavailable"&&!member.restored).length;
  const unknown=evidence?.unknown_count??members.filter(member=>member.state==="missing"||member.restored).length;
  const available=completeCounts||members.length===total?Math.max(0,total-unavailable-unknown):null;
  const label=available===null?"Availability readings incomplete":`${available} of ${total} ${monitored?"monitored ":""}${total===1?"entity":"entities"} available`;
  return {total,available,unavailable,unknown,label};
}

/** Shorten a repeated device prefix only when the entity keeps a useful name. */
export function deviceEntityName(name, deviceName) {
  const remaining=name.startsWith(`${deviceName} `)?name.slice(deviceName.length+1).trim():"";
  return remaining||name;
}

/** Refresh inspected entity readings without assigning a status to their device. */
export function entityReadingsStamp(members,states) {
  return JSON.stringify((members||[]).map(({entity_id:id})=>[id,states?.[id]?.state??null,Boolean(states?.[id]?.attributes?.restored)]));
}
