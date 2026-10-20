/** Describe a missing live entity without treating its equipment as failed. */
export function notProvidedProblem(source,status,openProblem=true) {
  if(source?.kind!=="entity_not_provided")return null;
  const current=status?.current;
  const missing=current?.status==="warn"&&current.reason==="entity_not_provided";
  const provided=current?.status==="pass"&&current.reason==="entity_provided";
  return {
    headline:missing?"Entity missing":provided?"Entity provided":"Waiting for integration information",
    summary:current?.message||"Current information about the entity's provider is unavailable.",
    nextStep:missing?"Inspect the entity and its integration in Home Assistant.":provided?"The integration is providing this entity.":"Wait for Home Assistant and the owning integration to finish loading.",
    tone:missing?"warning":provided?"recovering":"uncertain",
    mode:missing?"Needs attention":provided?"Provided":"Waiting",
    resolved:provided&&openProblem,
  };
}

/** Unknown provider evidence must not turn a retained record into a current fault. */
export function notProvidedVisible(episode,evidence) {
  return ["warn","fail"].includes(episode.status)&&evidence?.current?.status==="warn"&&evidence.current.reason==="entity_not_provided";
}
