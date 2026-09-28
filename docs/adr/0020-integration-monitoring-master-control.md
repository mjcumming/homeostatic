# ADR 0020: Stop monitoring an integration as one scope

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming

**Supersedes:** ADR 0016 and ADR 0019 where their separate connection and device controls lack an integration-wide off choice.

## Context

The owner expects turning off monitoring for an integration to turn off monitoring for its devices too. A connection-only choice beside a separate device policy made it easy to leave device checks active unintentionally. The narrower choices still serve installations that watch a connection but not its transient devices, or watch selected devices.

## Decision

- Put an integration-wide monitoring control first in Source Settings. Its off choice excludes the family's current and future connection, device-summary, and separately monitored entity checks. The control applies to every connection in the selected integration family.
- Represent off as one ordinary catalog exclusion matched by integration domain and all three source kinds. It takes precedence over exact device watches and other attachments. For an integration without a domain, match its entry id instead.
- Keep narrower connection, device-default, and individual source choices saved while the integration is off. Resuming monitoring removes only the integration-wide exclusion and restores their effective choices. Hide the narrower controls while off, and explain that their settings are retained.
- Use the existing review-before-save preview to show affected current sources. No existing configuration is changed automatically.

## Consequences

One action reliably stops monitoring the whole integration family, including later discoveries. Existing policies are recoverable without reconstruction. A broad custom exclusion can still affect effective monitoring, which the preview reports.
