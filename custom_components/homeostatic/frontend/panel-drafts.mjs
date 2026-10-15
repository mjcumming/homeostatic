/** Keep unfinished edits in this tab while Home Assistant replaces its panel. */
const sessions = new WeakMap();
const fields = ["configuration", "settingsDraft", "scopedConfiguration", "configBusy", "configError",
  "settingsBusy", "settingsError", "scopedBusy", "scopedStatusScope", "scopedError", "scopedNotice",
  "deliveryBusy", "deliveryError", "policyValidation", "policyDurationUnits", "policyTemperatureUnits"];

/** Independent cards start fresh when their connection or permissions change. */
export function resetCardDrafts(card) {
  for (const key of fields) card[key] = undefined;
}

function unfinished(session) {
  const state = session.values;
  return state.settingsBusy || state.configBusy || state.deliveryBusy ||
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
    if (restored && card.scopedConfiguration) card.scopedConfiguration.needsRefresh = true;
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
  const values = Object.fromEntries(fields.map(key => [key, previous ? undefined : card[key]]));
  session ??= {connection, userId:user?.id, values, owner:null};
  session.owner = card;
  card.panelDraftSession = session;
  for (const key of fields) Object.defineProperty(card, key, {
    configurable:true, get:() => card.panelDraftSession.values[key], set:value => {card.panelDraftSession.values[key] = value;},
  });
  if (connection && user?.id && user.is_admin) {
    sessions.set(connection, session);
    if (restored && card.scopedConfiguration) card.scopedConfiguration.needsRefresh = true;
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
