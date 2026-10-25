/** Present retained reports without making lifecycle or recovery decisions. */
export function checkWaiting(status) {
  return status?.current?.status === "unknown";
}

/** A loaded integration does not establish recovery of a recorded device. */
export function sharedDeviceCondition(data, episode, problem) {
  if (!episode.sharedDeviceCount || problem?.relatedFindings?.length) return null;
  const ids = [...new Set(episode.recorded || [])].filter(id=>id !== episode.anchor);
  const states = ids.map(id=>data.inventory.entity_status?.[id]?.current?.status);
  return states.length && states.every(state=>state === "pass")
    ? "Current checks available"
    : "Waiting for current device information";
}

export function waitingOnly(data, episode) {
  const findings = episode.reasons || [];
  const ids = [...new Set([episode.anchor,...(episode.recorded || []),...findings.map(item=>item.node_id)])];
  return ids.length > 0 && ids.every(id=>{
    const status = data.inventory.entity_status?.[id];
    return checkWaiting(status) && Object.hasOwn(status,"last_failure") && !status.last_failure &&
      !findings.some(item=>item.node_id === id && ["warn","fail"].includes(item.status));
  });
}

export function retainedProblem(problem, status, findings = []) {
  const failure = status?.last_failure || findings.find(item=>["warn","fail"].includes(item.status));
  if (!problem || !checkWaiting(status) || !failure) return problem;
  return {...problem,
    headline:problem.conditionName ? `${problem.conditionName} — waiting for current information` : failure.reason === "lock_jammed" ? "Lock jam reported — waiting for current state" : failure.reason === "vacuum_error" ? `Vacuum error — ${status.current.reason === "vacuum_unavailable" ? "current status unavailable" : "waiting for current status"}` : "Reported problem — waiting for current information",
    summary:failure.message || "A problem was reported earlier. Its recovery has not been confirmed.",
    nextStep:status.current.message || "Wait for current information to confirm whether the problem has cleared.",
    tone:"uncertain",reported:failure.message,reportedAt:failure.observed_at,historical:true};
}
