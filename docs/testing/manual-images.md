# Manual screenshot provenance

Captured October 15, 2026 at 21:30 CDT (October 16 at 02:30 UTC) from the working checkout of `main`, commit `e2e1f325fb51e7f7bd69e31fd24d81596f0a83d0`. The production frontend and fixtures had no changes relative to that commit. Documentation changes were uncommitted.

The images show the production frontend rendered with existing synthetic browser fixtures. Fixture controls, debug receipts and saved-settings dumps are outside the captured elements. The browser captured the Homeostatic panel shell, or the opened issue dialog, directly; there was no raster editing or generated interface artwork.

## Images and captions

| Image | Fixture under `tests/frontend/` | Reproduction after opening the fixture | Suggested caption |
| --- | --- | --- | --- |
| [Open issues](../images/manual-open-issues.png) | `issues-layout.html` | Expand MQTT. | Open issues groups unavailable equipment by integration. Expand a group to choose a finding. |
| [Issue detail](../images/manual-issue-detail.png) | `issues-layout.html` | Expand MQTT, then open the MQTT Kitchen finding. Capture the open dialog. | An opened issue shows the reported condition and actions for that issue. |
| [Monitoring](../images/manual-monitoring.png) | `monitoring-inspector.html` | Select the 3rd Floor Sensor device. | Monitoring shows equipment, its monitoring coverage and the selected device's availability. |
| [Named notification](../images/manual-notification.png) | `reusable-editors.html` | Edit Morning summary; select Owner phone under Send using; save through the fixture's mocked save; reopen the notification. | Morning summary combines a saved schedule and delivery method, with its affected policies shown below. |
| [Delivery method](../images/manual-delivery-method.png) | `reusable-editors.html` | After the previous steps, use Back to Notifications, Delivery methods, then edit Owner phone. Do not select Send test. | A saved delivery method lists its destinations and offers an explicit Send test action. |
| [Temperature policy](../images/manual-temperature-policy.png) | `temperature-policy-editor.html` | Capture the initial saved editor. | A temperature policy selects sensors, a lower limit and duration, then assigns a named notification. |
| [History](../images/manual-history.png) | `source-history.html` | Select Desktop width, open History and expand the cleared Garage relay row. | History distinguishes cleared issues, ended monitoring and problems that joined another issue. An expanded row retains its recorded finding. |

The examples retain their fixtures' synthetic equipment names, dates and configuration. They illustrate separate views, rather than the successive state of one installation. The temperature screenshot's 60°F limit and one-hour wait are configured example values, not supplied defaults. Owner phone is a synthetic destination. No household identity or live destination appears.

## Capture environment

- Chromium Headless Shell 143.0.7499.4, Playwright-driven under WSL, Node.js 24.22.0.
- Viewport 1240 × 1100, device scale factor 1, `en-US`, browser time zone `America/Chicago`.
- Light fixture themes except History, which uses its dark fixture theme. Panel widths are 1100 or 1200 pixels; the issue dialog is 660 pixels wide.
- Fixtures served over HTTP on an ephemeral `127.0.0.1` port. All non-loopback browser requests were blocked. No Home Assistant backend was started or contacted.
- Each PNG is an element screenshot. The pointer was moved outside the panel before capture to avoid incidental hover shading. Captures include all of the selected element, including content taller than the viewport.

The temporary capture script and JSON result are in ignored `build/manual-screenshots.mjs` and `build/manual-screenshots.json`. The first ordinary-Chromium attempt could not start because the WSL environment lacked `libasound.so.2`; the library was downloaded and extracted into the user's cache without changing system packages. Ordinary Chromium then hit a local Crashpad launch error. The successful capture used the already-installed headless-shell executable with the extracted library path.

## Verification and limits

All seven final PNGs were opened and visually inspected for readable labels, complete controls, sensible framing and absence of fixture controls. The successful run reported no browser page errors. The only saved configuration change was the fixture's mocked assignment of Owner phone to Morning summary; no Send test control was activated and no notifications were requested.

These images establish the rendered interface for the captured synthetic states. They do not establish live Home Assistant integration, provider receipt, phone-browser behavior, physical Safari compatibility or a full UI acceptance sweep. The fixture and capture restrictions should be preserved when refreshing them.
