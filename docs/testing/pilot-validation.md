# Pilot validation

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
