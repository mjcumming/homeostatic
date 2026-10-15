const PAGE_FOR_VIEW = {issues:"problems", settings:"configuration", functions:"problems", overview:"problems",house:"sources",coverage:"sources"};

export function cardView(view = "problems") {
  return PAGE_FOR_VIEW[view] ?? view;
}
