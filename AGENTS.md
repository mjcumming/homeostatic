# Agent instructions

Homeostatic is the Home Assistant adapter and catalog for health-tree. The library is a separate repository. Read the relevant sections of `docs/spec.md` before changing behavior and add an executable scenario for each behavior change. Update `CHANGELOG.md` for user-visible changes.

- Keep dependency, episode, readiness, and attention decisions in health-tree. Use public APIs only. Snapshots are opaque persistence data, not a query interface.
- Home Assistant owns I/O, timers, configuration, entities, and storage. Read the clock at adapter boundaries and pass UTC times into the library.
- A reported HA state is evidence about HA's control path. It does not prove physical-device freshness or successful command completion.
- Read `docs/home-assistant-states.md` before changing how Homeostatic reads entity, device or integration state. Check Home Assistant behavior against its documentation and Core source, never against one integration's implementation.
- Use Python 3.14, type annotations, and Google-style docstrings. Records are frozen, slotted, keyword-only dataclasses. No future annotations import. No prints in integration code.
- Never sleep in tests. Use time fixtures and real Home Assistant test helpers.
- Follow [the two development workflows](docs/development-workflows.md). Run `uv run python script/check.py --quick` (also `make quick`) and focused tests for a local UI trial. The commit hook uses quick checks. CI runs `uv run python script/check.py` (also `make check`) for strict types, the full suite and both coverage floors, then packages and smoke-tests the release candidate. Use Linux or WSL for Home Assistant. Validate metadata with official hassfest after manifest, services, or translation changes.
- Notification events are requests, not proof of delivery. Built-in phone and notify-entity routes send requests directly; optional consumer automations may handle events. Test both paths with mocked services. Preserve queued observations during I/O and stable delivery ids during outbox replay.
- Keep `docs/spec.md`, `docs/events.md`, user guide examples, and executable scenarios together with behavior changes. Keep current behavior in `docs/spec.md` and unfinished product scope in `docs/roadmap.md`.
- Do not commit, push, tag, publish, deploy, or open issues or PRs unless the maintainer asks. Work on `main`. Do not create a branch or worktree unless the maintainer asks to set work aside. Take dates from the system.
- Never send notifications through a user's live installation during tests. Tests use an isolated Home Assistant instance.

## Writing docs

Docs are for people, not for the next agent.

- Start from the reader's questions: what does it do, what would I use it for, why does it exist, how does it work, how do I set it up, and what doesn't it do. Get the answers from the code. Other docs may be stale.
- One page, one job: a tutorial, a how-to, reference, or an explanation (Diátaxis). The README is the front door: what it is, why you'd want it, how to install it, and where to go next.
- Write in a plain, professional voice. Never use the first person (no "I" or "my house"), and never name the maintainer in the docs. The product is the subject ("Homeostatic watches..."), and guides talk to the reader as "you". Contractions are fine where they read naturally. No hype, no slogans, no jokes.
- Say each thing once. Caveats go in one limitations section, not in every paragraph.
- Keep these out of user docs: inline ADR, rule or scenario numbers; version history ("since 0.3.0"); test counts and coverage; hard-wrapped prose.
- Cut the AI tells: "X, not Y" contrasts, a bold label on every bullet, lists of three for rhythm, noun piles, passive voice that hides who does what, and stock words like robust, seamless, comprehensive, leverage and ensure.
- When behavior changes, edit the section that owns it rather than bolting a new section on wherever is handy.
- Don't invent facts. If something needs the maintainer's knowledge, ask before writing it.
- User docs use the words in the UI: issue, source, problem, Repair. Keep node, episode, observation and adapter out of them. Functions are set aside, so leave them out of user docs.
- Frame Homeostatic as a tool for running Home Assistant: it tracks what goes wrong (integrations, devices and entities, batteries, Repairs) plus the house situations the owner asks it to watch, and tells people on their schedule. Home Assistant usually already knows about the failure; it just doesn't tell anyone.
