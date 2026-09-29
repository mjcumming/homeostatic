export async function runPanelHeaderScenario() {
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const originalScroll = window.scrollY;
  const container = document.createElement("div");
  const panel = document.createElement("homeostatic-panel");
  const embedded = document.createElement("homeostatic-card");
  container.append(panel, embedded);
  document.body.append(container);
  panel.main.style.minHeight = "2400px";
  const header = panel.shadowRoot.querySelector(".header");
  const menu = panel.shadowRoot.querySelector(".ha-menu");
  let menuEvents = 0;
  const listener = () => { menuEvents += 1; };
  document.addEventListener("hass-toggle-menu", listener);
  try {
    expect(getComputedStyle(embedded.shadowRoot.querySelector(".header")).position === "static", "Embedded card header scrolls normally");
    embedded.remove();
    for (const mode of ["document", "panel viewport"]) {
      container.style.cssText = mode === "document" ? "" : "height:480px;overflow:auto";
      container.scrollIntoView({block:"start"});
      await frame();
      const top = header.getBoundingClientRect().top;
      const menuTop = menu.getBoundingClientRect().top;
      const contentTop = panel.main.getBoundingClientRect().top;
      for (const distance of [400, 1000]) {
        if (mode === "document") window.scrollBy(0, distance);
        else container.scrollTop += distance;
        await frame();
        expect(Math.abs(header.getBoundingClientRect().top - top) < 1, `${mode}: header stays at the viewport top`);
        expect(Math.abs(menu.getBoundingClientRect().top - menuTop) < 1, `${mode}: hamburger stays in place`);
        expect(panel.main.getBoundingClientRect().top < contentTop - 300, `${mode}: page content scrolls beneath the header`);
        const bounds = menu.getBoundingClientRect();
        expect(bounds.width >= 44 && bounds.height >= 44, "Hamburger keeps its touch target");
        expect(panel.shadowRoot.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest("button") === menu, `${mode}: content cannot cover the hamburger`);
        menu.click();
      }
    }
    expect(menuEvents === 4, "Scrolled hamburger opens the native HA menu once per click");
    return "PASS: pinned header and hamburger, scrolling content, native menu event, and ordinary embedded card header";
  } finally {
    document.removeEventListener("hass-toggle-menu", listener);
    container.remove();
    window.scrollTo(0, originalScroll);
  }
}
