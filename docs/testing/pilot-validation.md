# Pilot validation

## 0.1.0b4 combined package validation

On 2026-09-25, build commit `e2eb9b4a9d249d538052540770a8e18bb595c3e7` passed all required checks: 328 Python tests, 17 frontend tests, lint, formatting and strict types. Two opt-in performance scenarios were skipped in the default suite; their measured qualification results are recorded in [runtime scaling](runtime-scaling.md). Combined coverage was 98.83%, with both independent floors above 95%. Official HA 2026.9.3 hassfest reported one valid integration and zero invalid integrations.

The exact ZIP passed a fresh HA-only installation smoke test. HA installed published HealthTree 0.3.0 automatically. Package checksums, native setup, all five frontend modules, failure/recovery, operator controls, notifications remaining off and retained history across reload passed. Optional FFmpeg/TurboJPEG warnings were confined to the isolated test host. [GitHub CI](https://github.com/mjcumming/homeostatic/actions/runs/36205274429) independently repeated the checks, built the archive, passed its clean-install test and published the pilot artifact. Its ZIP hash exactly matched the local package:

`3f8150a61a4224b5605b15e3ca341c8998733bded471d3ed0550dead7b7f127c`

The combined browser fixtures passed problem/retry explanations, embedded navigation, history pagination/search/outcomes, safe text, live focus/draft preservation, expiry/scope validation, duplicate prevention, ambiguous failures without automatic retry, and non-admin/situation boundaries. Native floor/area selection and floor summaries were inspected at desktop and phone widths. Form actions used synthetic data only.

### Live upgrade and verification

The same archive was installed through the owner's Vibe Coding MCP server on HA 2026.9.3 after a native HA configuration/storage backup (recorder database excluded), a separate exact component/storage copy, and a configuration checkpoint. All 29 uploaded component files matched the archive on read-back. HA configuration validation passed. One Core restart loaded 0.1.0b4, confirmed on the native integration page. NuHeat delayed general HA startup; Homeostatic resumed after startup finished without an adapter error.

Live verification at 2026-09-26 00:40 UTC (2026-09-25 local time) confirmed unchanged enrollment of 127 integration instances, notifications disabled, no notification requests and no active operator controls. All five existing episodes retained their ids and original opening times; the retained-history collection start also remained unchanged. The three sensors reported blocked readiness, five open problems and two evidence gaps, each with a null runtime error. These are existing integration conditions, not a claim that the house has recovered.

The dashboard displayed real setup/retry activity separately from retained, timestamped provider errors. A provider connection timeout remained visible while another setup attempt was in progress. Disabled entries used their distinct explanation. Recently resolved loaded the current empty history with collection/retention limits; the native floor/area hierarchy and separate floorless/unassigned groups loaded with explicit unwatched source rows. No household fault was induced and no live shelving or maintenance action was submitted. The MCP checkpoint was ended after verification.

The code and exact installed package are identified by the build commit and checksum above; this later documentation commit records the observed result. Backups and installation receipts remain local because they contain private household configuration. Continue passive observation. Whole-house enrollment remains unqualified after the runtime-burst measurements, and no phone-delivery or physical-device recovery test is implied.

## 0.1.0b4 problem-view development validation

Validated 2026-09-25 against HA 2026.9.3 and published HealthTree 0.3.0. The complete required check suite passed: 323 Python tests, 12 frontend tests, strict types, lint and formatting, with 98.83% combined coverage and both independent floors above 95%. The new integration-evidence module has full statement and branch coverage.

Real HA WebSocket scenarios cover setup error/retry, empty findings during setup-in-progress, retention across reload, unchanged episode identity/onset, loaded evidence during the recovery hold, confirmed clearing, disabled evidence after the library emits `stale`, explicit unenrollment, malformed persistence and detached read-only results. Notification requests remain off in these scenarios.

The actual browser component passed the synthetic preview regression for missing cause, reauthentication, retry continuity, disabled presentation, recovery hold, recovery, safe text, native links and expanded disclosures surviving live updates. Desktop and 390 × 844 phone layouts were inspected. Raw exceptions no longer lead the overview; reported errors remain inspectable inside problem details.

At this intermediate validation point the changes were local, and the live HA baseline remained 0.1.0b3. The combined 0.1.0b4 release validation is recorded above. A pre-existing failure that has already lost its cause cannot be reconstructed; retention starts with newly observed evidence after installation.

## 0.1.0b3 package and live upgrade

On 2026-09-25, commit `fec29f09b718d5a1870ae8e9d7dca05e81795b88` passed the required checks (316 Python tests, 10 frontend tests and 98.79% combined coverage), official hassfest, and the fresh HA-only package smoke test. HA installed published HealthTree 0.3.0 from the manifest. The smoke test also fetched the new problem-presentation module alongside the other frontend assets and verified failure/recovery, history and reload behavior.

The owner approved upgrading the existing HA 2026.9.3 pilot from 0.1.0b1. A native HA configuration/storage backup and separate prior component/storage copies were saved before changing files. All 27 installed component files were read back and matched the archive. Configuration validation passed before and after upload; the native UI confirmed version 0.1.0b3 after one Core restart. The 127 watched integration instances and notifications-off setting remained in place; diagnostic sensors resumed with no adapter error, and existing episodes retained their opening times. The configuration checkpoint was ended successfully.

An existing integration delayed HA startup, during which Homeostatic correctly showed monitoring unavailable. Once monitoring resumed, provider connection-timeout detail appeared in the updated problem summary. This validates carrying HA's reported error through the live adapter; it does not claim provider authentication succeeded or physical equipment recovered.

Archive SHA-256: `812bd50f24564ee5b011ea5e27153cdbe2a632ca7a815ad2cab8cdd20c169988`.

Further presentation work: retain the last reported cause while an open episode's integration temporarily returns to setup-in-progress; distinguish an original disabled condition when the engine exposes its held unknown finding as `stale`. The current fallback remains explicit about unknown evidence. Whole-house enrollment and bounded dashboard transfer remain separate qualification work.

## 0.1.0b2 package validation

On 2026-09-25, the scaling candidate passed the complete required suite against
published `health-tree==0.3.0`: 307 Python tests, eight frontend tests, lint,
formatting, strict types, and 98.79% combined coverage with both independent
coverage floors above 95%. The installed library had no editable/direct-URL
metadata. Official Home Assistant hassfest validated one integration with zero
invalid integrations.

A fresh HA 2026.9.3 environment without HealthTree installed then loaded the
committed 0.1.0b2 ZIP. HA automatically installed HealthTree 0.3.0 from the manifest.
Archive checksums, native setup, the three frontend assets, ready/blocked/recovered
behavior, one retained cleared episode, controls, no notification requests, and
history across reload all passed. The isolated host's optional FFmpeg/TurboJPEG
warnings remain outside the integration's tested scope.

See [scaling validation](scaling.md) for the 10,000-source scenarios and remaining
responsiveness qualification. This package was not deployed to the house: the
existing 0.1.0b1 installation still watches 127 integration instances with
notifications off. The earlier browser walkthrough and live findings below remain
evidence for that earlier build. Each archive's `BUILD_INFO.json` identifies its
exact committed sources and file checksums.

## 0.1.0b1 baseline

The combined 0.1.0b1 candidate targets Home Assistant 2026.9.3 and Python 3.14, using the published health-tree 0.2.0 distribution. It includes the dashboard, administrator controls and persisted resolved-history backend.

## Combined checks

On 2026-09-25 the required check command passed 303 Python tests and eight Node frontend tests, plus Ruff, formatting and strict typing. Combined branch-aware coverage was 98.79%, with statement and branch coverage individually above 95%. Official hassfest reported one valid integration and no invalid integrations.

Notification-order assertions use HA's `async_capture_events` helper so observation stays on the event loop; worker-thread scheduling cannot reorder the test's recorded events.

The separate [dashboard walkthrough](dashboard-walkthrough.md) records native setup, failure/recovery, future enrollment, area changes, reload, full restart and the embedded return-navigation regression. It used the same library behavior from its pre-release commit. The combined suite now uses the released wheel.

## Package acceptance

`script/build_pilot.py` builds from a clean committed revision, packages tracked frontend assets and the optional blueprint, and records the commit and file hashes. Building the same revision twice must produce the same ZIP hash.

`script/smoke_pilot.py` accepts that ZIP and requires a separate environment containing HA 2026.9.3 without HealthTree already installed. It verifies the package hashes, copies only the component into a temporary configuration, and lets HA install the manifest dependency. It exercises native config flow, function readiness, frontend asset serving, failure/recovery, resolved history and reload. Notifications stay off; synthetic timings are explicitly zero so the check never sleeps. The browser walkthrough independently used normal timing defaults.

The CI job builds the ZIP, runs this clean-install check and uploads the archive only after success. Local package installation **passed on 2026-09-25** from the combined candidate ZIP. The environment initially contained HA without HealthTree. HA installed `health-tree==0.2.0` into the isolated environment's site-packages, with no editable/direct-URL metadata. Setup, all three frontend assets, ready Ã¢â€ â€™ blocked Ã¢â€ â€™ ready behavior, one retained cleared episode, controls query, empty notification requests and history across reload passed.

The Linux test host lacks optional FFmpeg and TurboJPEG system libraries, so HA logged media-related errors/warnings while importing its frontend dependencies. Those media features are outside this check. No Homeostatic installation, runtime or assertion failure occurred. The normal custom-integration and optional zlib acceleration warnings also remain visible.

## First live installation

On 2026-09-25, the pilot from commit `8c614a8` was installed through the owner's Vibe Coding MCP setup on HA 2026.9.3. All 26 deployed component files matched the tested archive byte-for-byte, and HA configuration validation passed before and after copying them. A Vibe configuration checkpoint was created; this is not a full Home Assistant backup.

A whole-catalog setup preview exposed a scaling failure on an installation with more than 6,000 registered entities: HA stopped responding for several minutes and its browser disconnected. The preview had not saved a config entry. HA recovered without another restart. The synchronous graph construction path is a suspected bottleneck, not a profiled root-cause finding. Reproduce and fix this in isolation before repeating broad enrollment on the live house.

Setup then completed with a rule matching integration instances only: 127 watched sources, normal timing defaults, no declared functions and notification events off. All three sensors loaded with a null runtime error, and the sidebar dashboard displayed current overview and coverage data. Coverage explicitly distinguished unwatched entities from watched integrations. After startup grace, three actual HA integration setup problems appeared in the overview and problem-count sensor; no device failure was induced and notification events remained off. This begins passive observation; it does not complete the 24-48 hour trial, physical failure/recovery checks, phone delivery testing or a scale qualification.

The subsequent [scaling increment](scaling.md) has isolated 10,000-source coverage. It is a separate development candidate; these results do not describe changes installed in the house.

## Reproduce

```bash
uv sync --locked
uv run python script/check.py
uv run python script/build_pilot.py
uv venv --python 3.14 /tmp/homeostatic-pilot-venv
uv pip install --python /tmp/homeostatic-pilot-venv/bin/python homeassistant==2026.9.3
/tmp/homeostatic-pilot-venv/bin/python script/smoke_pilot.py dist/homeostatic-0.1.0b2-pilot.zip
```

Use a fresh environment for each smoke run. The check intentionally refuses an already-installed HealthTree so an editable checkout cannot mask a missing dependency. Home Assistant binds only to loopback and the temporary configuration is removed after shutdown.

This does not establish real-house behavior, physical freshness, command completion, phone receipt or external-watchdog independence. Follow the [pilot guide](../pilot.md) for the first passive installation and observation.
