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


export function entityProblem(source, status, owner = null, areas = [], localize = () => null, openProblem = true) {
  if (source?.kind !== "entity") return null;
  const domain = source.attributes?.domain?.[0] ?? source.entity_id?.split(".")[0];
  const deviceClass = source.attributes?.device_class?.[0];
  const detection = domain === "binary_sensor" && ["occupancy", "motion"].includes(deviceClass);
  const labels = {light:"Light", switch:"Switch", sensor:"Sensor", binary_sensor:"Sensor", climate:"Thermostat", fan:"Fan", cover:"Cover", lock:"Lock", media_player:"Media player"};
  const label = detection ? (deviceClass === "occupancy" ? "Occupancy sensor" : "Motion sensor")
    : Object.hasOwn(labels, domain) ? labels[domain] : "Entity";
  const noun = label.toLowerCase();
  const provider = owner ? integrationProblem(owner, [], localize)?.integration : null;
  const area = areas.find((item) => item.id === source.attributes?.area?.[0])?.name;
  const context = [label, area, provider ? `via ${provider}` : null].filter(Boolean).join(" · ");
  const finding = status?.explanation?.findings.find((item) => item.node_id === source.node_id);
  const dependency = status?.explanation?.nodes.find((item) => item.node_id === owner?.node_id);
  let reason = source.disabled ? "disabled" : status?.current?.reason ?? finding?.reason ??
    (status?.explanation && source.watched && status.readiness?.answer === "ready" ? "available"
      : status?.explanation && source.watched && dependency ? "connection_problem" : "unknown");
  if (reason === "available" && (!source.watched || dependency)) reason = dependency ? "connection_problem" : "unknown";
  const missingReading = domain === "light" ? "Home Assistant can't tell whether this light is on or off. Control from Home Assistant may not work."
    : detection ? "Home Assistant isn't receiving a current detection reading. Automations that rely on this sensor may not respond."
    : ["sensor", "binary_sensor"].includes(domain) ? "Home Assistant isn't receiving a current reading from this sensor. Automations that rely on it may not respond."
    : `Home Assistant reports this ${noun} as unavailable. Its current state and any control through Home Assistant cannot be relied on.`;
  const check = domain === "light" ? "Check that the light has power and that its wall switch, if it has one, is on. If it works locally, open its details below to check the connection."
    : detection ? "Check the sensor's power or battery. Then check whether its reading updates when someone enters the area."
    : "Open its details to check which integration provides it and whether it has been disabled or removed.";
  const definitions = {
    unavailable: [`${label} unavailable`, missingReading, check, "failure", "Still unavailable"],
    state_unknown: ["Waiting for a known state", `Home Assistant has this ${noun}, but cannot currently tell us its state. This does not confirm that it is offline.`,
      "Open its details to check whether a current state has arrived. If it stays unknown, review its connection.", "uncertain", "State unknown"],
    source_missing: ["No current state found", `Home Assistant has no current state for this ${noun}. It may be starting up, disabled or removed.`,
      "Open its device page or details to check whether it is still configured. If it was removed on purpose, update what Homeostatic watches.", "uncertain", "No current state"],
    restored_state: ["Waiting for a fresh reading", `Home Assistant has only a saved state for this ${noun}, not a fresh report since startup.`,
      "Allow its connection to finish starting. If no fresh reading arrives, check the device's connection.", "uncertain", "Saved state only"],
    stale: ["Reading is out of date", `Homeostatic has no recent evidence for this ${noun}. Its current condition is not confirmed.`,
      "Check its current reading and connection in Home Assistant.", "uncertain", "Waiting for recent evidence"],
    disabled: ["Disabled in Home Assistant", `Home Assistant is not using this ${noun}.`,
      "If this is intentional, no action is needed. Otherwise, open its device page or details and review why it is disabled.", "neutral", "Disabled"],
    connection_problem: ["Connection needs attention", `Home Assistant has a state for this ${noun}, but a watched connection is not ready.`,
      "Review the connection below before troubleshooting the device.", "uncertain", "Connection not ready"],
    available: [openProblem ? "Checking recovery" : `${label} available`, openProblem
      ? `Home Assistant is receiving a state for this ${noun} again. Homeostatic is waiting for it to stay available before closing this problem.`
      : `Home Assistant is receiving a state for this ${noun}.`, "No action is needed right now.", "recovering", openProblem ? "Confirming recovery" : "Reporting a state"],
  };
  const [headline, summary, nextStep, tone, progress] = Object.hasOwn(definitions, reason) ? definitions[reason]
    : ["Current condition isn't confirmed", `Homeostatic does not have enough current evidence to explain this ${noun}'s condition.`,
      "Open its details to check the current state and connection.", "uncertain", "Not confirmed"];
  const device = source.attributes?.device?.[0];
  return {context, headline, summary, nextStep, tone, progress, currentReason:reason,
    entityLabel:`Open ${noun} details`, deviceUrl:device ? `/config/devices/device/${encodeURIComponent(device)}` : null,
    connectionNote:dependency ? `Its ${provider || "Home Assistant"} connection also needs attention. Check that connection before troubleshooting this ${noun} on its own.` : null,
    connectionNode:dependency?.node_id ?? null, connectionLabel:provider ? `Review ${provider} connection` : "Review connection",
  };
}
