# ADR 0018: Use source-specific views beside one tree

**Status:** Accepted
**Date:** 2026-09-27
**Decider:** Michael Cumming

**Supersedes:** ADR 0017's decision to show evidence and monitoring together without detail views. Its one-tree navigation, source identity, grouping, and guarded monitoring changes remain in force.

## Context

The locally implemented Sources page repeats its title and places evidence and monitoring in one long panel. During the owner walkthrough, this made the selected source and its available actions hard to scan. The owner asked for one persistent tree with Source, Settings, and History views in the right panel.

## Decision

Keep one Sources tree. Give its selected item three right-panel views in this order: Source for identity and current evidence, Settings for current monitoring and its guarded editor, and History for open and retained ended problems associated with that source. Switching views or tree selection does not discard a monitoring draft. Group rows show their own summary and do not claim unrelated history. The main Settings page continues to own installation-wide options, and the main History page continues to show installation-wide ended problems.

Remove repeated Sources headings inside the workspace. Every tree item needs a readable label even when Home Assistant provides an empty name.

## Consequences

Source-specific navigation stays in one workspace. Saved monitoring choices and alert delivery are unchanged. The existing exact-preview and revision guard still apply to edits.
