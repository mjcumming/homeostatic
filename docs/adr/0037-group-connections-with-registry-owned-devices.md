# ADR 0037: Group connections with their registry-owned devices

**Status:** Accepted
**Date:** 2026-09-30
**Decider:** Michael Cumming

**Supersedes:** ADR 0036's placement of every connection as a separate row beside devices. The distinct source identities, checks, and monitoring choices remain in force.

## Context

Sources groups devices and configuration entries under their integration type. When a Denon AVR entry and its sole Home Assistant device have the same name, the tree shows two apparently duplicate rows. Home Assistant's device registry supplies the owning `config_entry_id`; names do not establish ownership. A configuration entry can own several devices or none, and its entities may have no device association.

## Decision

Use registry identity to present one configuration entry and its sole device in a single tree row when that entry has no unattached entities. The row shows connection status separately from device entity inclusion. Both remain individually addressable for evidence, monitoring choices, history, and issue navigation. An entry with several devices or unattached entities remains a parent row. An entry with no devices remains visible with its own entities. A device without a reliable owner stays at the integration-family level. Search includes both names, and issue counts count each episode once.

The relationship is a presentation grouping. It adds no dependency edge and never treats successful setup as evidence of device availability or physical health.

## Consequences

Simple one-device integrations have a compact tree without duplicate-looking names. Hub, service, multi-device, and incomplete-registry cases retain explicit structure. The dashboard snapshot must include each device's configuration entry id, and frontend scenarios cover all grouping shapes and navigation to both underlying sources.
