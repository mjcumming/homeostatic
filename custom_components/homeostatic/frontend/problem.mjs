/** Owner-facing integration explanations; health decisions remain in HealthTree. */
export function integrationProblem(source, findings, localize = () => null, evidence = null) {
  if (source?.kind !== "integration") return null;
  const finding = findings.find((item) => item.node_id === source.node_id || !item.node_id);
  const current = evidence?.current ?? finding;
  if (!current) return null;
  const domain = source.attributes?.domain?.[0];
  const integration = (domain && localize(`component.${domain}.title`)) || domain || "This integration";
  const retrying = current.reason === "setup_in_progress" && evidence?.last_failure;
  const definitions = {
    auth_required: ["Sign-in required", `${integration} needs you to sign in again for ${source.name}.`,
      `Open ${source.name} in Home Assistant and complete its sign-in prompt.`, "failure"],
    setup_error: ["Integration couldn't start", `${integration} could not start ${source.name} in Home Assistant.`,
      "Open the reported error for details, then review the integration or its logs.", "failure"],
    setup_retry: ["Retrying setup", `Home Assistant could not finish starting ${source.name} and will retry automatically. Recovery is not yet confirmed.`,
      "Open the reported error for details. If retries continue, check the integration logs.", "retrying"],
    disabled: ["Integration disabled", `${source.name} is disabled in Home Assistant. Its availability is unknown.`,
      "If this is intentional, leave it disabled. Otherwise, open the integration and enable this entry.", "neutral"],
    migration_error: ["Configuration update failed", `Home Assistant could not update the saved configuration for ${source.name}.`,
      "Check the integration logs for the configuration update error.", "failure"],
    failed_unload: ["Integration could not stop", `Home Assistant could not unload ${source.name}.`,
      "Check the integration logs before attempting another reload.", "failure"],
    source_missing: ["Integration no longer found", `Home Assistant no longer has the monitored entry for ${source.name}. Its availability is unknown.`,
      "Check whether the entry was removed or replaced, then review Homeostatic's enrollment rules.", "uncertain"],
    not_loaded: ["Integration not running", `${source.name} is not loaded in Home Assistant. Its availability is unknown.`,
      "Open the integration to check its current setup state.", "uncertain"],
    loaded: ["Integration running", `Home Assistant reports that ${source.name} is loaded.`,
      "No setup action is needed while Homeostatic checks for confirmed recovery.", "recovering"],
    setup_in_progress: [retrying ? "Trying setup again" : "Integration starting",
      retrying ? `Home Assistant is attempting to start ${source.name} again. Recovery is not yet confirmed.` : `Home Assistant is still starting ${source.name}. Its availability is not yet known.`,
      "Allow setup to finish. If it remains here, check the integration logs.", "retrying"],
    unload_in_progress: ["Integration stopping", `Home Assistant is still unloading ${source.name}. Its availability is unknown.`,
      "Allow the operation to finish. If it remains here, check the integration logs.", "uncertain"],
  };
  const definition = Object.hasOwn(definitions, current.reason) ? definitions[current.reason] : null;
  if (!definition) return null;
  const [headline, summary, nextStep, tone] = definition;
  const errorState = ["auth_required", "setup_error", "setup_retry", "migration_error", "failed_unload"].includes(current.reason);
  const report = errorState ? current : evidence?.last_failure;
  const message = (report?.message ?? "").trim();
  const prefix = `${source.name}: `;
  const detail = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const reported = report && detail !== report.reason.replaceAll("_", " ") ? detail : "";
  const missingDetail = Boolean(errorState && !reported && current.reason !== "auth_required");
  const integrationUrl = domain ? `/config/integrations/integration/${encodeURIComponent(domain)}${source.entry_id ? `#config_entry=${encodeURIComponent(source.entry_id)}` : ""}` : "/config/integrations";
  return {headline, summary, reported, missingDetail, nextStep: missingDetail ? "Open the integration logs to find the setup error before retrying." : nextStep, tone,
    historical: Boolean(report && !errorState), reportedAt: report?.observed_at ?? null,
    currentReason: current.reason, observedAt: evidence?.current?.observed_at ?? null,
    integration, integrationUrl,
    integrationLabel: domain ? `Open ${integration}` : "Open integrations",
    logsUrl: domain && (errorState || report || current.reason === "setup_in_progress") ? `/config/logs?filter=${encodeURIComponent(domain)}` : null,
    logsPrimary: missingDetail,
  };
}
