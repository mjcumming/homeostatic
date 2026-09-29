# ADR 0033: Open useful context when a notification is tapped

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Michael Cumming

## Context

The live leak test reached the phone, but tapping opened the Companion app without
Homeostatic context because the sender omitted a destination. The owner approved
individual issue details, an Issues page for summaries, and retained details for
resolved issues. Companion apps support relative URLs on the sending HA server.

## Decision

Derive destinations from the delivered issue identity at each Companion transport
boundary. Use episode paths for individuals, Issues for summaries/digests, and
Notifications for route tests. Supply iOS url and Android clickAction. Reuse the
existing authenticated panel, issue controls and retained history. Opening is a
read-only navigation; acknowledgment remains an explicit, separate action.

## Consequences

No storage or engine changes. Old notifications cannot be retroactively assigned
a destination without a new push. Summary links open the current Issues page,
not a frozen copy of the delivered summary. Individual links can outlive retained
history and must state that limit rather than invent recovery. Verify native
phone taps separately from browser routing and successful delivery requests.
