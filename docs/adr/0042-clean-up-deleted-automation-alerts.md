# ADR 0042: Clean up deleted automation alerts

**Status:** Accepted
**Date:** 2026-10-01

**Supersedes:** ADR 0034's rule that saved alert identities are never removed automatically.

## Context

Automation alert declarations have a 1000-record limit. Retired records have continued to use that capacity, and deleting an owning Home Assistant automation has left its alert declaration in storage. A retired record also blocks its automation from creating the alert again.

## Decision

Keep at most 1000 active automation alert declarations. Retired definitions do not use that capacity. Retirement continues to block reports until the owner explicitly resumes the alert or Home Assistant removes the owning automation from its entity registry. On the next reconciliation after removal, delete the declaration, whether active or retired. Keep ended issue History under its separate limit.

Do not expire a retired blocking record by age: if its automation is still running, the next report would otherwise register a new alert. Do not infer deletion from a missing source entity or an automation that is only disabled.

## Consequences

Retired definitions can remain in storage while their owner remains registered, but they cannot block new active alerts through the 1000-active limit. Removing an automation ends any open issue as removed from monitoring; it does not claim recovery. This cleanup follows Home Assistant's saved automation identity, not a scan of its condition references.
