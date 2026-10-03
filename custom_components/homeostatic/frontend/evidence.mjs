/** Summarize the public node query without treating HA availability as physical proof. */
export function diagnosticOverview(source, result, _affectedFunctions = [], episodeOpen = false) {
  const monitoring = source.disabled
    ? "Disabled in Home Assistant. Homeostatic cannot assess its health."
    : source.watched ? "Selected for monitoring." : "No direct check is selected for this capability.";
  const checks = {
    integration: "Home Assistant connection state; connected equipment is not physically verified.",
    device: "Availability of the entities selected by monitoring rules, after exclusions. Selecting them declares that they are expected to be available; it does not establish physical device health.",
    entity: "Home Assistant entity availability; a usable state does not verify the device's physical operation.",
    battery: "Current Home Assistant battery percentage, low warning, and charging reports; no physical freshness is verified.",
    vacuum: "The vacuum entity's current activity. An error activity opens an issue; other activities clear it.",
    external: "No direct Home Assistant observation for this external capability.",
    situation: "The owner-defined condition supplied by its bound Home Assistant signal.",
  }[source.kind] ?? "Only the configured checks shown in the diagnostic record.";
  const answer = result.readiness?.answer;
  const assessment = source.kind === "device" && answer === "ready"
    ? episodeOpen ? "HA availability evidence has returned; the open problem is awaiting confirmed recovery." : "HA availability evidence is present; individual capabilities are not all verified."
    : episodeOpen && answer === "ready"
    ? "Configured checks currently look ready, but the open problem is still awaiting confirmed recovery."
    : answer === "ready" ? "Configured checks currently indicate ready."
      : answer === "degraded" ? "Configured checks currently indicate degraded readiness."
        : answer === "blocked" ? "Configured checks currently indicate blocked readiness."
          : answer === "unknown" ? "Current evidence cannot establish readiness."
            : episodeOpen ? "The reported condition remains open." : "No current readiness assessment is available.";
  const impact = "Homeostatic reports the selected Home Assistant evidence for this source.";
  return {monitoring, checks, assessment, impact};
}
