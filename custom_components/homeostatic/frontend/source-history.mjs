import {escapeHtml as esc} from "./model.mjs?v=99";
import {observedRange, RESOLUTIONS} from "./history-controls.mjs?v=99";

const timestamp = value => value ? Date.parse(value) : NaN;
const time = value => Number.isFinite(timestamp(value))
  ? `<time datetime="${esc(value)}">${esc(new Date(value).toLocaleString())}</time>`
  : "Time not recorded";

/** Describe existing episodes without inferring history from current states. */
export function sourceHistory(data, sources, {associationLimited = false} = {}) {
  const byId = new Map(sources.map(source => [source.node_id, source]));
  const history = data.inventory.resolved_history;
  if (!history) return "<p>Ended-problem history is unavailable.</p>";
  const events = history.episodes.filter(item => byId.has(item.episode.anchor))
    .sort((a,b) => ((timestamp(b.resolved_at) || 0) - (timestamp(a.resolved_at) || 0)) || a.episode.episode_id.localeCompare(b.episode.episode_id));
  const rows = events.map(({episode, source, resolution, resolved_at}) => {
    const name = source?.name || episode.labels?.name || "Source name not recorded";
    const [outcome] = RESOLUTIONS[resolution] ?? ["Problem ended"];
    const finding = episode.reasons?.find(item => item.message?.trim())?.message.trim() || "No readable finding was recorded.";
    return `<li><button type="button" class="row source-history-entry" data-history="${esc(episode.episode_id)}" aria-label="${esc(`View history: ${name}`)}"><span class="row-main"><strong>${esc(name)}</strong><span class="source-history-condition">${esc(finding)}</span><small>${esc(outcome)} · <time datetime="${esc(resolved_at || "")}">${esc(observedRange(episode.opened_at,resolved_at))}</time></small></span></button></li>`;
  }).join("");
  const information=`<details class="history-information" data-ui-key="source-history-information:${esc(sources[0]?.node_id || "source")}"><summary>History information</summary><p>Retained for up to ${esc(history.retention.max_age_days)} days, at most ${esc(history.retention.max_episodes)} ended problems across Homeostatic.</p><p>Collection began ${time(history.started_at)}. Times record Homeostatic’s observations; earlier history is not reconstructed.</p>${associationLimited?'<p>Older child issues without recorded ownership are available in the full history.</p>':""}<button type="button" class="link" data-page="history">View full history</button></details>`;
  return `${rows ? `<ol class="source-timeline">${rows}</ol>` : '<p>No retained problems found.</p>'}${information}`;
}
