/** Owner-facing explanations; all health and attention decisions stay in HealthTree. */
const titles = {nuheat: "NuHeat", denonavr: "Denon AVR", music_assistant: "Music Assistant"};
const timeout = /\b(?:ConnectTimeoutError|ReadTimeoutError|ConnectTimeout|ReadTimeout|TimeoutException|TimeoutError)\b|\b(?:connection|request) timed out\b/i;

export function integrationProblem(source, findings, localize = () => null, evidence = null, openProblem = true) {
  if (source?.kind !== "integration") return null;
  const finding = findings.find((item) => item.node_id === source.node_id || !item.node_id);
  const current = evidence?.current ?? finding ?? {reason: "unknown"};
  const domain = source.attributes?.domain?.[0];
  const integration = (domain && localize(`component.${domain}.title`)) ||
    (Object.hasOwn(titles, domain) ? titles[domain] : domain) || "Home Assistant";
  const integrationUrl = domain ? `/config/integrations/integration/${encodeURIComponent(domain)}${source.entry_id ? `#config_entry=${encodeURIComponent(source.entry_id)}` : ""}` : "/config/integrations";
  const errorState = ["auth_required", "setup_error", "setup_retry", "migration_error", "failed_unload"].includes(current.reason);
  const report = errorState ? current : current.reason === "loaded" ? null : evidence?.last_failure;
  const message = (report?.message ?? "").trim();
  const prefix = `${source.name}: `;
  const detail = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const reported = report && detail !== report.reason.replaceAll("_", " ") ? detail : "";
  const missingDetail = Boolean(errorState && !reported && current.reason !== "auth_required");
  const retrying = current.reason === "setup_retry" || (current.reason === "setup_in_progress" && evidence?.last_failure);
  const activity = current.reason === "setup_retry" ? "Home Assistant will try again automatically."
    : retrying ? "Home Assistant is trying again." : "";
  const definitions = {
    auth_required: ["Sign-in required", `Home Assistant needs you to sign in to ${integration} again.`,
      "Open the connection below and complete Home Assistant's sign-in prompt.", "failure", "Waiting for sign-in"],
    setup_error: ["Connection couldn't start", `Home Assistant could not start this connection${missingDetail ? " and did not report a cause" : ""}.`,
      "Review the connection in Home Assistant for a setup or repair prompt. Technical details include its logs.", "failure", "Needs attention"],
    setup_retry: ["Connection is retrying", "Home Assistant could not start this connection. It will try again automatically.",
      "If the connection keeps failing, review it in Home Assistant for a setup or repair prompt.", "retrying", "Retrying automatically"],
    disabled: ["Disabled in Home Assistant", "Home Assistant is not using this connection.",
      "If this is intentional, no action is needed. Otherwise, open the connection and enable it.", "neutral", "Disabled"],
    migration_error: ["Connection needs an update", "Home Assistant could not update this connection's saved settings.",
      "Review the connection for an update or repair prompt. Technical details include the reported error.", "failure", "Needs attention"],
    failed_unload: ["Connection couldn't stop", "Home Assistant could not stop this connection cleanly.",
      "Review the connection and its reported error before attempting another reload.", "failure", "Needs attention"],
    source_missing: ["Connection no longer found", "Home Assistant no longer lists this connection.",
      "Check whether it was removed or replaced. If it was removed on purpose, update what Homeostatic watches.", "uncertain", "Not found"],
    not_loaded: ["Connection is not running", "Home Assistant has not started this connection.",
      "Review the connection in Home Assistant for a setup or repair prompt.", "uncertain", "Not running"],
    loaded: [openProblem ? "Checking recovery" : "Connection available", openProblem ? "Home Assistant reports this connection is running again. The problem will close once recovery is confirmed." : "Home Assistant reports this connection is running.",
      "No action is needed right now.", "recovering", openProblem ? "Confirming recovery" : "Connected"],
    setup_in_progress: [retrying ? "Connection is retrying" : "Connection is starting",
      retrying ? "Home Assistant is trying to start this connection again." : "Home Assistant is starting this connection.",
      "Allow it to finish. If it stays here, review the connection in Home Assistant.", "retrying", retrying ? "Retrying automatically" : "Starting"],
    unload_in_progress: ["Connection is stopping", "Home Assistant is stopping this connection.",
      "Allow it to finish. If it stays here, review the connection in Home Assistant.", "uncertain", "Stopping"],
  };
  let [headline, summary, nextStep, tone, progress] = Object.hasOwn(definitions, current.reason) ? definitions[current.reason]
    : ["Connection status isn't confirmed", "Home Assistant has not provided a current explanation for this connection.",
      "Review the connection in Home Assistant to check its current status.", "uncertain", "Status unknown"];
  const timedOut = ["setup_error", "setup_retry", "setup_in_progress"].includes(current.reason) &&
    ["setup_error", "setup_retry"].includes(report?.reason) && timeout.test(reported);
  if (timedOut) {
    headline = domain === "nuheat" ? "NuHeat connection timed out" : domain === "denonavr" ? "Receiver didn't respond" : "Connection timed out";
    summary = `Home Assistant's last connection attempt timed out.${activity ? ` ${activity}` : ""}`;
    nextStep = domain === "nuheat" ? "Try the NuHeat app. If it connects successfully but this problem continues, review the connection in Home Assistant."
      : domain === "denonavr" ? "Check that the receiver is powered on and connected to your network. If it responds normally, review its Home Assistant connection."
      : "Check whether you can use the device or service directly. If you can, review its Home Assistant connection.";
  }
  return {headline, summary, nextStep, tone, progress, timedOut, reported, missingDetail,
    historical: Boolean(report && !errorState), reportedAt: report?.observed_at ?? null,
    currentReason: current.reason, observedAt: evidence?.current?.observed_at ?? null,
    integration, integrationUrl,
    integrationLabel: current.reason === "auth_required" ? "Sign in again" : domain === "denonavr" ? "Review receiver connection" : domain ? `Review ${integration} connection` : "Review connections",
    needsAction: !["loaded", "unload_in_progress"].includes(current.reason),
    logsUrl: domain ? `/config/logs?filter=${encodeURIComponent(domain)}` : null,
  };
}
