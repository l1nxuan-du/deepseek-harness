# Development guide

## Setup tutorial

### Prerequisites

- List the required runtime, package manager, external tools, accounts, and operating-system assumptions.
- Record the supported version range and how to verify it.

### First-time setup

- Describe installation, environment setup, initial checks, and the command that proves the project is ready.
- Link to the authoritative commands instead of copying generated configuration.

## Contributor reference

### Project layout

- Describe top-level directories, ownership, generated paths, and where new code belongs.
- Link package-specific details to their owning README or reference.

### Environment variables

- Document each variable's purpose, required or default value, scope, and whether it contains a secret.
- Never commit credentials, tokens, private keys, or environment-specific secrets. Read secrets from environment variables or a secret manager; commit only non-secret examples.

### Git workflow

- Split independent changes.
- Fix the introducing change before propagating it.
- Rewrites use `--force-with-lease`, abort when the remote moves, and never use raw `--force`.

### CI checks

- List the required checks, where they run, and the owning test or validation command.
- Do not duplicate check semantics here; link to the testing policy and command reference.

### Daily commands

- List the smallest useful install, build, test, lint, type-check, and run commands.
- Mark commands that require credentials or network access.

### Runtime profiles

- List supported run modes and the differences in services, storage, permissions, and startup behavior.
- Link each profile to its configuration owner.

### Environment failures

- If a required command fails because the environment blocks credentials, network, IPC, or process isolation, retry unchanged with the narrowest escalation.
- Preserve the failure evidence. Never bypass failing tests or the security sandbox.

### Dependency policy

- Prefer a maintained dependency over hand-rolled infrastructure when it removes owned code and tests without unacceptable operational or security risk.
- Record the reason for a dependency that crosses a security, licensing, or deployment boundary.

### TODO markers

Use one of three comment tags to flag known issues in the code, ordered by urgency:

- `FIXME` — an issue that should block a new release. A release should not ship with an open `FIXME` unless reviewers explicitly agree the change can be merged anyway.
- `TODO` — an issue that should be fixed soon, once the resources are available.
- `XXX` — an issue that may be fixed someday; lowest priority, no commitment.

Pick the tag that matches the urgency so anyone scanning the code can distinguish a release blocker from a someday-maybe.

### Documenting types

- Document public contracts, invariants, ownership, and non-obvious behavior.
- Keep type documentation at its declaring source unless a reference file explicitly owns a generated or verbatim copy.
