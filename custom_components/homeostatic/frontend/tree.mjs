/** Presentation helpers for the expandable location tree. */

import {escapeHtml as esc} from "./model.mjs?v=13";

export function setBranchExpanded(collapsed, locationId, expanded) {
  const next = new Set(collapsed);
  if (expanded) next.delete(locationId);
  else next.add(locationId);
  return next;
}

export function locationBranch(location, selectedId, collapsed, depth = 1) {
  const selected = location.id === selectedId;
  const hasChildren = location.children.length > 0;
  const expanded = hasChildren && !collapsed.has(location.id);
  const disclosure = hasChildren
    ? `<span class="location-toggle" data-location-toggle="${esc(location.id)}" aria-hidden="true"></span>`
    : '<span class="location-toggle" aria-hidden="true"></span>';
  const children = hasChildren
    ? `<div class="location-children" role="group"${expanded ? "" : " hidden"}>${location.children.map((child) => locationBranch(child, selectedId, collapsed, depth + 1)).join("")}</div>`
    : "";
  return `<div class="location-branch"><button type="button" class="location ${hasChildren ? "location-parent" : ""}" data-location="${esc(location.id)}" role="treeitem" aria-level="${depth}" aria-selected="${selected}"${hasChildren ? ` aria-expanded="${expanded}"` : ""}>${disclosure}<span class="location-name">${esc(location.name)}</span><span class="small">${esc(location.summary)}</span></button>${children}</div>`;
}
