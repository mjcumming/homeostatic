const spec="../../docs/product-specification.md#review-scenarios-and-completion-criteria";
const editors="../../docs/policy-editors.md#points-for-ui-review";
const standards="../../docs/ui-standards.md#component-review-checklist";
const path=(id,page,controls,expected,fixture,requirement=spec)=>({id,page,controls,expected,fixture,requirement});

// A path starts untested on every run; a fixture may report only its checked ids.
export const controlPaths=[
  path("navigation.pages","Navigation","Issues, Sources, Policies, Notifications, Settings","Each destination opens and retains independent drafts.","reusable-editors.html"),
  path("navigation.history","Navigation","Back, Forward, direct link, refresh","Restore the meaningful destination or explain a missing target.","workspace.html"),
  path("issues.evidence","Issues","Group, issue, related-source disclosure","Canonical members and all contributing checks remain reachable.","issue-evidence.html"),
  path("issues.recovery","Issues","Partial and full recovery","Outstanding members remain; full recovery removes the active problem.","issue-evidence.html"),
  path("issues.filter","Issues","Search, sort, group expansion, pagination","Complete reachable results and correct ordering without changing monitoring.","reusable-editors.html"),
  path("issues.empty","Issues","Quiet, filtered, unmonitored, loading, unavailable","Distinct truthful states and a useful next action.","reusable-editors.html"),
  path("issues.controls","Issues","Acknowledge, pause, cancel control","Exact issue scope, visible expiry, no automatic retry on uncertain result.","history-controls.html"),
  path("issues.history","Issues","History search, filter, page, detail","Recorded identity and retention limits remain visible.","history-controls.html"),
  path("sources.tree","Sources","Expand, select, search, filter","Expansion and selection stay independent; identity and context persist.","source-history.html"),
  path("sources.details","Sources","Members, readings, monitoring, issue links","Current evidence and contributing policies are distinguishable.","source-history.html"),
  path("sources.availability","Sources","Stop availability, cancel, confirm, resume, undo","Only reviewed saved policy exclusions change; unrelated drafts and HA state remain intact.","source-actions.html"),
  path("sources.availability-batch","Sources","Select members, stop selected, resume selected, exclusions filter","One save affects only selected entities; excluded members remain reachable.","source-actions.html"),
  path("sources.availability-conflicts","Sources","Dirty affected policy, stale review, save failure, deliberate retry","Block unsafe scope changes and preserve saved settings and drafts.","source-actions.html"),
  path("sources.contextual-issue-controls","Sources","Issue scope disclosure, acknowledge and pause dialogs, cancel","Controls identify the whole correlated issue and preserve its exact identity.","source-actions.html"),
  path("sources.compact-layout","Sources","Collapsed details, retained focus, phone/desktop and themes","Condition and actions remain visible; secondary details are reachable without horizontal scroll.","source-actions.html"),
  path("sources.history","Sources","History, prior problem, return","Recorded membership survives unavailable current source metadata.","source-history.html"),
  path("sources.maintenance","Sources","Equipment maintenance entry, explicit expiry, cancel","A source has a reachable maintenance action with exact saved scope and visible expiry.","source-history.html"),
  path("policies.lifecycle","Policies","Add, edit, duplicate, enabled, save, discard, delete","Only the named policy changes; supplied and custom policies share controls.","reusable-editors.html",editors),
  path("policies.scope","Policies","All, selected, exclusions, picker search, selected only","Catalog loading/error is distinct from no matches; selection survives search.","reusable-editors.html",editors),
  path("policies.detection","Policies","Each supported policy type and its detection fields","Units, ranges and validation preserve the intended saved detection.","reusable-editors.html",editors),
  path("policies.restore","Policies","Restore defaults, select, cancel, confirm, save","Only selected missing defaults are staged; missing profiles are not referenced.","reusable-editors.html",editors),
  path("policies.notification","Policies","Notification choice, Dashboard only, additional row, remove","Named selection changes only this policy and retains stable row identity.","reusable-editors.html",editors),
  path("policies.legacy","Policies","Custom notification, named replacement","Legacy data stays unchanged until explicit replacement.","reusable-editors.html",editors),
  path("policies.ups","Policies","Mains/backup condition, notification choice","Independent reserve conditions and stable assignment identity survive edits.","reusable-editors.html",editors),
  path("profiles.list","Notifications","Tabs, Edit, More actions","Six defaults have equal lifecycle controls and compact reachable menus.","reusable-editors.html",editors),
  path("profiles.create","Notifications","Add notification, discard new","A new draft remains unsaved and discard leaves no empty saved object.","reusable-editors.html",editors),
  path("profiles.invalid","Notifications","Required name and Save notification","Invalid input prevents a request, retains the draft and identifies the input.","reusable-editors.html",editors),
  path("profiles.save","Notifications","Timing, method choice, Save notification","The actual Save button persists only this notification and removes dirty controls.","reusable-editors.html",editors),
  path("profiles.discard","Notifications","Edit then Discard changes","Restore this saved notification in place without affecting other drafts.","reusable-editors.html",editors),
  path("profiles.duplicate","Notifications","More actions, Duplicate, Save notification","Create an independent saved copy with preserved timing and methods.","reusable-editors.html",editors),
  path("profiles.delete-cancel","Notifications","More actions, Delete, Cancel","Cancel leaves definitions and assignments unchanged.","reusable-editors.html",editors),
  path("profiles.delete-replace","Notifications","Delete, replacement, confirm","One save removes the definition and redirects uses without changing row ids.","reusable-editors.html",editors),
  path("profiles.delete-remove","Notifications","Delete, remove assignments, confirm","Explicit removal preserves unrelated definitions and leaves Dashboard only.","reusable-editors.html",editors),
  path("profiles.delete-draft","Notifications","Delete while a using policy has a draft","Block deletion and retain the affected draft and saved references.","reusable-editors.html",editors),
  path("profiles.timing","Notifications","Immediate, acknowledgment, window, report days/time","Every timing editor validates and saves its own fields and timezone.","reusable-editors.html",editors),
  path("methods.lifecycle","Delivery methods","Add, edit, duplicate, save, discard, delete","Saved shared uses and independent drafts remain correct.","reusable-editors.html",editors),
  path("methods.destinations","Delivery methods","Add destination, type, search, select, remove, close","Each supported type is usable; missing saved targets remain repairable.","reusable-editors.html",editors),
  path("methods.presence","Delivery methods","Presence disclosure, people, home/away, fallback/skip","Saved behavior resolves current presence without unsolicited sending.","reusable-editors.html",editors),
  path("methods.test","Delivery methods","Send test on saved/dirty/new method","Only explicit saved tests request mocked destinations; requested/failed/skipped stay distinct.","reusable-editors.html",editors),
  path("settings.edit","Settings","Timing, Problem grouping, Save, Discard","Valid values save only installation settings; invalid values retain inputs.","reusable-editors.html"),
  path("sending.switch","Global sending","On/Off during another draft","Only confirmed global state changes; monitoring and unrelated drafts persist.","reusable-editors.html"),
  path("save.failure","Saving","Rejected Save and retry","Keep the exact draft and expose the named error; deliberate retry succeeds once.","reusable-editors.html",standards),
  path("save.conflict","Saving","Save after concurrent saved edit","Do not overwrite the newer saved object; retain the conflicting draft.","reusable-editors.html",standards),
  path("save.refresh-failure","Saving","Confirmed Save followed by failed reread","Say saved but refresh failed; preserve unrelated drafts.","reusable-editors.html",standards),
  path("save.pending","Saving","Delayed Save, external outage or settings reload, repeated click and reattachment","Keep the exact saving editor; guard repeat submissions; distinguish confirmed result, failed/uncertain save and unavailable monitoring while preserving unrelated drafts.","reusable-editors.html",standards),
  path("save.uncertain","Saving","Lost save response, inspect, retry","Read current saved state before retry; do not duplicate an applied change.","reusable-editors.html",standards),
  path("updates.retention","Live updates","Unchanged update, disconnect, reconnect","Retain DOM, focus, selection and draft; stale view is visibly read-only.","reusable-editors.html",standards),
  path("layout.menus","Responsive","More actions at viewport edge, Escape, outside click","Both actions stay visible; dismissal restores appropriate focus.","mobile-layout.html",standards),
  path("layout.keyboard","Accessibility","Tab, Shift+Tab, Enter, Space, Escape","Complete navigation, editors and dialogs with visible focus and correct return.","reusable-editors.html",standards),
  path("layout.themes","Accessibility","Light, dark, enlarged text, 320px and desktop","No clipping, required horizontal scroll or unreadable control state.","mobile-layout.html",standards),
  path("layout.safari","Physical Safari","Actual iOS device workflow","Record device/browser and exercise touch, keyboard, menus and safe areas.",null,standards),
];

export function emptyReceipt(environment={}) {
  return {schema_version:1,started_at:new Date().toISOString(),environment,results:controlPaths.map(item=>({...item,status:"untested",evidence:[]}))};
}

export function recordResult(receipt,id,status,evidence) {
  const row=receipt.results.find(item=>item.id===id);
  if(!row)throw Error(`Unknown acceptance path: ${id}`);
  if(!["pass","fail","untested"].includes(status))throw Error(`Invalid acceptance status: ${status}`);
  row.status=status;if(!row.evidence.includes(evidence))row.evidence.push(evidence);
  return receipt;
}

export function receiptSummary(receipt) {
  return Object.fromEntries(["pass","fail","untested"].map(status=>[status,receipt.results.filter(row=>row.status===status).length]));
}
