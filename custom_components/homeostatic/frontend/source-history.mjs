import {escapeHtml as esc} from "./model.mjs?v=46";
import {RESOLUTIONS} from "./history-controls.mjs?v=46";

const timestamp = value => value ? Date.parse(value) : NaN;
const time = value => Number.isFinite(timestamp(value))
  ? `<time datetime="${esc(value)}">${esc(new Date(value).toLocaleString())}</time>`
  : "Time not recorded";

function duration(start, end) {
  const seconds = (timestamp(end) - timestamp(start)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "Less than a minute";
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes % 60 ? `${minutes % 60}m` : ""].filter(Boolean).join(" ");
}

/** Describe existing episodes without inferring history from current states. */
export function sourceHistory(data, sources) {
  const byId = new Map(sources.map(source => [source.node_id, source]));
  const history = data.inventory.resolved_history;
  const events = [
    ...data.inventory.episodes.filter(episode => byId.has(episode.anchor)).map(episode => ({episode, source:byId.get(episode.anchor)})),
    ...(history?.episodes ?? []).filter(item => byId.has(item.episode.anchor)).map(item => ({...item, ended:true})),
  ].sort((a,b) => ((timestamp(b.ended ? b.resolved_at : b.episode.opened_at) || 0) - (timestamp(a.ended ? a.resolved_at : a.episode.opened_at) || 0)) || a.episode.episode_id.localeCompare(b.episode.episode_id));
  const note = history
    ? `Ended problems are retained for up to ${esc(history.retention.max_age_days)} days, at most ${esc(history.retention.max_episodes)} across Homeostatic. Collection began ${time(history.started_at)}. Earlier history is not reconstructed.`
    : "Ended-problem history is unavailable. Only currently open problems can be shown.";
  const rows = events.map(({episode, source, ended, resolution, resolved_at}) => {
    const name = source?.name || episode.labels?.name || "Source name not recorded";
    const [outcome, explanation] = ended
      ? RESOLUTIONS[resolution] ?? ["Problem ended", "No resolution detail was recorded."]
      : ["Still open", ""];
    const findings = [...new Set((episode.reasons ?? []).map(finding => finding.message?.trim()).filter(Boolean))];
    const elapsed = ended ? duration(episode.opened_at,resolved_at) : "";
    return `<li><div class="source-history-heading"><h3>${esc(name)}</h3><span class="source-history-outcome">${esc(outcome)}</span></div>${findings.length ? findings.map(finding => `<p>${esc(finding)}</p>`).join("") : '<p class="sub">No readable finding was recorded.</p>'}${explanation ? `<p class="sub">${esc(explanation)}</p>` : ""}<dl><div><dt>Opened</dt><dd>${time(episode.opened_at)}</dd></div>${ended ? `<div><dt>Resolution observed</dt><dd>${time(resolved_at)}</dd></div>${elapsed ? `<div><dt>Recorded duration</dt><dd>${esc(elapsed)}</dd></div>` : ""}` : ""}</dl><button type="button" class="link" data-${ended ? "history" : "episode"}="${esc(episode.episode_id)}" aria-label="${esc(`${ended ? "View history" : "View open problem"}: ${name}`)}">${ended ? "View history details" : "View open problem"} →</button></li>`;
  }).join("");
  return `<p class="sub">${events.length ? `${events.length} related ${events.length === 1 ? "problem" : "problems"} · Newest first. ` : ""}Open problems and retained outcomes for this source and its children.</p>${rows ? `<ol class="source-timeline">${rows}</ol>` : '<p>No problems in retained history for this source.</p>'}<p class="small">${note}</p>${history ? '<p class="small">Times show when Homeostatic observed the issue and recorded its outcome, not when a physical problem ended.</p>' : ""}`;
}
