/** Summarize the public node query without treating HA availability as physical proof. */
export function diagnosticOverview(source, result, affectedFunctions = [], episodeOpen = false) {
  const monitoring = source.disabled
    ? "Disabled in Home Assistant. Homeostatic cannot assess its health."
    : source.kind === "function"
      ? "Evaluated from its configured requirements."
      : source.watched ? "Selected for monitoring." : "No direct check is selected for this capability.";
  const checks = {
    integration: "Home Assistant connection state; connected equipment is not physically verified.",
    entity: "Home Assistant entity availability; a usable state does not verify the device's physical operation.",
    function: "Configured requirements and their current evidence; no separate physical check of the function.",
    external: "No direct Home Assistant observation for this external capability.",
    situation: "The owner-defined condition supplied by its bound Home Assistant signal.",
  }[source.kind] ?? "Only the configured checks shown in the diagnostic record.";
  const answer = result.readiness?.answer;
  const assessment = episodeOpen && answer === "ready"
    ? "Configured checks currently look ready, but the open problem is still awaiting confirmed recovery."
    : answer === "ready" ? "Configured checks currently indicate ready."
      : answer === "degraded" ? "Configured checks currently indicate degraded readiness."
        : answer === "blocked" ? "Configured checks currently indicate blocked readiness."
          : answer === "unknown" ? "Current evidence cannot establish readiness."
            : episodeOpen ? "The reported condition remains open." : "No current readiness assessment is available.";
  const impact = source.kind === "function"
    ? "This is a configured home function. Its readiness reflects its declared requirements."
    : source.kind === "situation"
      ? "This situation is separate from equipment dependencies and home-function readiness."
      : affectedFunctions.length
        ? `Currently affected configured functions: ${affectedFunctions.map((item) => item.name).join(", ")}.`
        : "No configured home function is currently shown as affected. Uses outside configured functions are not assessed.";
  return {monitoring, checks, assessment, impact};
}
