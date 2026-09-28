# Homeostatic reporting prototype

Created 2026-09-28 for the five reporting preferences design. This is an interactive design artifact, not integration code. It uses synthetic devices and people, has no Home Assistant connection, makes no notification requests, and has no third-party dependencies or remote assets.

Open `index.html` in a browser, or run `node serve.cjs` and visit `http://127.0.0.1:8766`. The server binds only to the local loopback interface. All settings are held in browser memory; refreshing resets the sample. Saving updates only the in-memory sample.

## Try the workflow

1. In Notifications, edit the weekly weekday/time or the recipients of an immediate reporting choice.
2. Open Sources and select Outdoor speakers to see the resulting timing. Switching pages preserves the draft.
3. Select multiple devices in the tree, then use Set reporting preference. Explicit condition exceptions remain unchanged.
4. Review changes to see the affected scope, then save the sample settings.
5. Use Phone view and Dark theme to inspect the responsive layouts.
6. Use Try a scenario for missing destinations, an existing custom policy, or a configuration revision changing during review.

## Earlier design sample

This sample predates the approved weekly household default. The production component
review is now at `tests/frontend/reporting.html`; ADR 0027 and the specification
define shipped defaults and summary behavior. The historical sample below remains
useful for exploring the original interaction draft.

- Recipients are chosen per reporting choice; destinations are chosen per person. Administrator/household routing constraints are not simulated.
- The sample household default is Morning summary. Device preferences and condition exceptions illustrate proposed precedence.
- Morning 08:00, evening 18:00, weekly Sunday 09:00, and reminders every 30 minutes are examples.
- The leak detector example includes a separately configured water situation. The prototype does not infer or create that situation from availability evidence.
- Both immediate choices describe delivery including overnight. No old person-level filters or quiet-hours controls appear in the new workflow.

Dashboard only is an agreed regular choice in the same reporting list. It retains monitoring without outgoing notifications or reports and needs no schedule or recipients.

## Included

Notifications and source reporting editors; sample destination selection; simulated delivery tests; explicit request enablement; shared schedule impact counts; device/condition assignments; household inheritance; bulk edits preserving exceptions; draft retention between pages; before/after review; missing-destination validation; stale-review refresh; read-only custom-policy explanation; light/dark and narrow layouts.

## Not included

Health detection, actual delivery, acknowledgement actions on delivered messages, scheduled execution, incident history, migration execution, backend persistence, or production security/authorization. The Source and History views contain sample explanatory states. Report contents and several runtime contracts remain open in the reporting design.

## Verification

JavaScript syntax checks passed. Browser walkthroughs verified weekly weekday/time edits, source detail updates, draft retention, a two-device bulk change preserving the water exception, before/after review and sample save, missing destination blocking and correction, stale review refresh/save, and custom-policy preservation.

Phone-size layout checks found no horizontal page overflow. Desktop and narrow light/dark layouts were inspected; dark text inheritance and narrow profile labels were corrected. Keyboard-operated editing was exercised. These checks validate this prototype only, not the live Homeostatic integration.
