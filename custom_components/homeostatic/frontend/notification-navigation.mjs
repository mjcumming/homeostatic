const PAGE_FOR_VIEW = {issues:"problems", settings:"configuration", functions:"overview"};

export function cardView(view = "overview") {
  return PAGE_FOR_VIEW[view] ?? view;
}

export function notificationRoute(path) {
  const pages = {"":"overview", "/":"overview", "/issues":"problems", "/history":"history", "/notifications":"notifications"};
  if (Object.hasOwn(pages, path)) return {page:pages[path], episodeId:null};
  const match = path?.match(/^\/episode\/([^/]+)$/);
  if (match) {
    try {
      const episodeId = decodeURIComponent(match[1]);
      if (episodeId) return {page:"problems", episodeId};
    } catch { /* Malformed external links must not prevent opening Issues. */ }
  }
  return {page:"problems", episodeId:null};
}

export function applyNotificationRoute(card, path) {
  if (card.notificationPath === path) return;
  card.notificationPath = path;
  const route = notificationRoute(path);
  card.tools.close();
  card.pendingEpisode = null;
  card.page = route.page;
  card.render();
  if (route.episodeId) {
    if (card.isConnected && card.current.status === "current") card.openDetail({episodeId:route.episodeId});
    else card.pendingEpisode = route.episodeId;
  } else {
    card.detail = null;
    card.dialog.close();
  }
}
