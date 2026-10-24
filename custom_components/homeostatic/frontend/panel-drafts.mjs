/** Keep unfinished edits in this tab while Home Assistant replaces its panel. */
const sessions = new WeakMap();
/** Independent cards start fresh when their connection or permissions change. */
export function resetCardDrafts(card) {
  card.editors = {};
}

function unfinished(session) {
  const state = session.editors;
  return state.settingsBusy || state.configBusy || state.deliveryBusy || state.deliveryMethodBusy ||
    state.settingsDraft && JSON.stringify(state.settingsDraft) !== JSON.stringify(state.configuration?.settings);
}

function forgetIfFinished(session) {
  if (!session.owner && !unfinished(session) && sessions.get(session.connection) === session) sessions.delete(session.connection);
}

/** Bind only the full panel; separate embedded cards keep their own drafts. */
export function connectPanelDrafts(card) {
  const connection = card._hass?.connection, user = card._hass?.user;
  const previous = card.panelDraftSession;
  if (previous?.connection === connection && previous.userId === user?.id && user?.is_admin) {
    const restored = previous.owner !== card;
    previous.owner = card;
    sessions.set(connection, previous);
    if (restored && card.editors.scopedConfiguration) card.editors.scopedConfiguration.needsRefresh = true;
    return restored;
  }
  if (previous) {
    previous.owner = null;
    if (sessions.get(previous.connection) === previous) sessions.delete(previous.connection);
  }
  let session = connection && sessions.get(connection);
  if (session && (session.userId !== user?.id || !user?.is_admin)) {
    sessions.delete(connection);
    session = null;
  }
  const restored = Boolean(session);
  session ??= {connection, userId:user?.id, editors:previous ? {} : card.editors || {}, owner:null};
  session.owner = card;
  card.panelDraftSession = session;
  card.editors = session.editors;
  if (connection && user?.id && user.is_admin) {
    sessions.set(connection, session);
    if (restored && card.editors.scopedConfiguration) card.editors.scopedConfiguration.needsRefresh = true;
  }
  return restored;
}

export function disconnectPanelDrafts(card) {
  const session = card.panelDraftSession;
  if (!session) return;
  if (session.owner === card) session.owner = null;
  forgetIfFinished(session);
}

/** Let an outstanding save update a replacement panel without replaying it. */
export function renderPanelDrafts(card) {
  const session = card.panelDraftSession;
  if (!session) return true;
  forgetIfFinished(session);
  if (session.owner === card) return true;
  session.owner?.render();
  return false;
}
