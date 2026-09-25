/** Owner-facing integration explanations; health decisions remain in HealthTree. */
export function integrationProblem(source, findings, localize = () => null) {
  if (source?.kind !== "integration") return null;
  const finding = findings.find((item) => item.node_id === source.node_id || !item.node_id);
  if (!finding) return null;
  const domain = source.attributes?.domain?.[0];
  const integration = (domain && localize(`component.${domain}.title`)) || domain || "This integration";
  const definitions = {
    auth_required: ["Sign-in required", `${integration} needs you to sign in again for ${source.name}.`,
      `Open ${source.name} in Home Assistant and complete its sign-in prompt.`],
    setup_error: ["Integration couldn't start", `${integration} could not start ${source.name} in Home Assistant.`,
      "Check the integration's error details and logs before retrying setup."],
    setup_retry: ["Retrying setup", `${integration} could not finish starting ${source.name}. Home Assistant will retry automatically.`,
      "If this continues, check the reported error and the integration logs."],
    disabled: ["Integration disabled", `${source.name} is disabled in Home Assistant. Its availability is unknown.`,
      "If this is intentional, leave it disabled. Otherwise, open the integration and enable this entry."],
    migration_error: ["Integration needs attention", `Home Assistant could not update the saved configuration for ${source.name}.`,
      "Check the integration logs for the configuration update error."],
    failed_unload: ["Integration could not stop", `Home Assistant could not unload ${source.name}.`,
      "Check the integration logs before attempting another reload."],
    source_missing: ["Integration no longer found", `Home Assistant no longer has the monitored entry for ${source.name}. Its availability is unknown.`,
      "Check whether the entry was removed or replaced, then review Homeostatic's enrollment rules."],
    not_loaded: ["Integration not running", `${source.name} is not loaded in Home Assistant. Its availability is unknown.`,
      "Open the integration to check its current setup state."],
    setup_in_progress: ["Integration starting", `Home Assistant is still starting ${source.name}.`,
      "Allow setup to finish. If it remains here, check the integration logs."],
    unload_in_progress: ["Integration stopping", `Home Assistant is still unloading ${source.name}.`,
      "Allow the operation to finish. If it remains here, check the integration logs."],
  };
  const definition = Object.hasOwn(definitions, finding.reason) ? definitions[finding.reason] : null;
  if (!definition) return null;
  const [headline, summary, nextStep] = definition;
  const errorState = ["auth_required", "setup_error", "setup_retry", "migration_error", "failed_unload"].includes(finding.reason);
  const generic = finding.reason.replaceAll("_", " ");
  const message = (finding.message ?? "").trim();
  const prefix = `${source.name}: `;
  const detail = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const reported = errorState && detail !== generic ? detail : "";
  const missingDetail = errorState && !reported && finding.reason !== "auth_required";
  const integrationUrl = domain ? `/config/integrations/integration/${encodeURIComponent(domain)}${source.entry_id ? `#config_entry=${encodeURIComponent(source.entry_id)}` : ""}` : "/config/integrations";
  return {headline, summary, reported, missingDetail, nextStep,
    integration, integrationUrl,
    integrationLabel: domain ? `Open ${integration}` : "Open integrations",
    logsUrl: domain && errorState ? `/config/logs?filter=${encodeURIComponent(domain)}` : null,
    logsPrimary: missingDetail,
  };
}
