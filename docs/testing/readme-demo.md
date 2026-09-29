# README screenshot demo

The README images use a fictional Willow House snapshot and the real Homeostatic frontend. The fixture is [readme-demo-data.mjs](../../tests/frontend/readme-demo-data.mjs); the browser harness is [readme-demo.html](../../tests/frontend/readme-demo.html). It does not connect to Home Assistant, change stored settings, or send notification requests. Unsupported websocket calls fail in the browser.

## Story

At 9:08 a.m. Chicago time on September 29, 2026, Home Assistant reports that the Willow House Zigbee connection cannot start. Three selected Zigbee entities are unavailable: hall motion, hall ceiling lights, and the kitchen leak sensor. The Hall motion lighting and Kitchen leak alert functions are therefore blocked. One high-importance issue is anchored to the integration. A fictional notification request to Alex's phone awaits acknowledgment; it is a request, not evidence of receipt.

History contains three independent availability episodes from September 14, 22, and 27. Each resolved only after Home Assistant reported the entity available again. The old hall motion episode ended before the new integration issue opened. No history row claims a physical repair.

## Refresh the images

1. From the repository root, serve the files locally: `python -m http.server 8765 --bind 127.0.0.1`.
2. Open `http://127.0.0.1:8765/tests/frontend/readme-demo.html` in a desktop browser. The panel uses local production modules; there is no build step.
3. Capture Overview, then select the open issue's **View details** button. For Sources, expand **Zigbee Home Automation** and select that group. Capture History and Notifications through the panel navigation.
4. Save tightly cropped, pixel-exact screenshots as `docs/images/overview.png`, `issue.png`, `sources.png`, `history.png`, and `notifications.png`. Keep the fictional-data label visible. Verify the issue count, affected functions, source device count, dates, recipient, and history agree before replacing existing images.

The fixture's dates are fixed for reproducibility. If the V1 interface or policy shapes change, update the fixture and check all five views before capturing again. Keep names, entity IDs, and notification destinations fictional; do not substitute live household data.
