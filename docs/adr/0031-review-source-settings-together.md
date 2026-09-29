# ADR 0031: Review integration monitoring and reporting together

**Status:** Accepted
**Date:** 2026-09-29

## Context

The owner approved a compact integration Settings design with current outcomes,
disclosed editors, explicit exceptions, and one review step. Separate monitoring
and reporting saves cannot provide that review safely: the first save changes
the revision and can leave only part of the intended change applied.

## Decision

Show monitoring activation, what is monitored, and when to notify as separate
decisions on one page. Existing catalog and reporting semantics remain intact.
Actual saved counts and unsaved choices are identified separately; only the
server preview determines the effect of interacting catalog rules.

Extend the existing settings proposal with optional monitoring rules. Bind the
complete proposal to one revision and preview token, validate both parts, and
apply them through one options update and reload under the existing save lock.
Reload failure restores the complete previous options. Keep the existing
monitoring-only and installation-only commands for their other editors.

## Consequences

The integration page has one review/save/discard footer. Pending drafts from
other pages are included and identified in that review. No new configuration
store, notification activation, catalog migration or library behavior is added.
Bulk reporting remains limited to current devices; monitoring defaults can
include future devices. The policy preview for existing open problems is not a
simulation of episode changes caused by the proposed monitoring rules.
