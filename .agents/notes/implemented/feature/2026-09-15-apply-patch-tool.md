# Agent Note: The apply_patch tool ships in the default fs tool set

Status: implemented

English | [中文](2026-09-15-apply-patch-tool.zh.md)

## Problem

The harness's editing surface was `read`/`write`/`edit` (plus the opt-in `str_replace_editor`). Models trained on Codex reach for `apply_patch`: one envelope that adds, updates, moves, and deletes several files, with every path and hunk checked before anything is written. Without it those models either translate a multi-file change into a sequence of single-file edits — losing the all-or-nothing preflight they rely on — or fall back to shell heredocs, which skip the filesystem seam's policy entirely.

The reference implementation lives in a third-party plugin bundle, so the grammar, the whole-line matching, and the diagnostic vocabulary were available to port; the port decisions are what this note records.

## Decision

`packages/fs/tool-apply-patch` (`@deepseek-ai/dsh-tool-apply-patch`) registers the model-facing `apply_patch` tool, and `packages/bundle/base/cordis.patch.yml` plus the `standard`, `ptc`, and `cordis` presets mount it next to `tool-fs`, so it is part of the default roster rather than an opt-in bundle.

The tool takes one string argument, the patch envelope, and applies it over `ctx.fs`: `*** Begin Patch` … `*** Add File:` / `*** Update File:` (`*** Move to:` before the first hunk, `*** End of File` after one) / `*** Delete File:` … `*** End Patch`. Hunks match whole lines with the reference tool's own leniency — exact, then ignoring surrounding whitespace, then folding common typographic punctuation — a repeated run resolves to the first match at or after the previous hunk, `@@ <text>` only moves where the search starts, a body of only added lines inserts at the end of the file, and untouched lines keep their terminators while inserted lines take the file's first one. `*** Add File: ` overwrites an existing path and `*** Move to: ` overwrites an existing destination, exactly as the reference does; deleting a path that is not a regular file is refused. Preflight replays every operation against an in-memory overlay, so a deterministic failure (missing path, unmatchable hunk, non-regular file) writes nothing; the commit pass then re-validates and prints the reference's summary — `Success. Updated the following files:` and one `A`, `M`, or `D` line per path. Mutations go through the same `fs/write-intent` / `fs/edit-intent` waterfalls and `fs/observed` records as the rest of the fs family, so the mounted policy and sandbox fence still apply.

Two deliberate divergences from the reference. Deletion runs through `ctx.get('shell')` because `ctx.fs` exposes no removal operation, and the request carries the **session's** sandbox policy — the reference passed none, which would let a read-only session delete through a shell that defaults to the deployment mode. And the presenter is the generic edit card: a call-time presenter sees only the patch text, so it cannot compute the per-file diffs a diff card requires, and fabricating them would misreport the change. The model-facing description also states the real atomicity boundary — a failure only the write can report (a file changed since it was read, a sandbox denial) leaves the earlier operations in place — instead of promising a rollback the commit pass does not implement.

The tool declares two presentations of the same single input. A wire that supports grammar-constrained custom tools offers the envelope as freeform text constrained by the reference implementation's own Lark grammar ([`src/grammar.ts`](../../../../packages/fs/tool-apply-patch/src/grammar.ts), copied verbatim), so the model writes the patch without JSON escaping it and the tool layer delivers the raw text as the declared `patch` parameter; every other wire keeps the JSON function form. Declaring the grammar is the default, and `freeform: false` drops it for an endpoint that rejects custom tools.

## Alternatives considered

**Ship it as an opt-in bundle like `tool-str-replace-editor`.** Rejected: the point is Codex-parity editing out of the box, and every surface that mounts the fs suite already mounts `tool-fs` in the same layer.

**Delete through `ctx.fs`.** Rejected: the service has no removal operation, and adding one widens the filesystem contract for a single tool; the shell service already owns process-backed removal under the sandbox.

**A diff-card presenter.** Rejected as above: `DiffCallView` needs `diffs` the presenter cannot know before execution.

**Fuzzy (whitespace-normalized) hunk matching.** Rejected: exact whole-line matching is what makes an applied patch provably the one the model wrote, and silent approximate application is the failure mode a patch tool exists to prevent.

## Consequences

The default roster now offers the Codex-style envelope, and deterministic patch failures cost nothing: nothing is written when any path or hunk is refused.

The costs are explicit. Two editing surfaces coexist (the `read`/`write`/`edit` suite and `apply_patch`), so the model chooses; the shipped tool roster, the generated tool catalog, and the CLI/Web roster assertions all move with this change. Deletion requires the shell service: a composition that mounts `tool-apply-patch` without `ctx.shell` fails loudly on the first delete instead of silently degrading. `= <path>` still emits the commit pass's own read observation, because the mounted read-before-edit policy keys on the actor's observed state and would otherwise refuse the write the patch is about to make.

Coverage: the package's focused specs (57 tests, per-file 100% coverage of `src/**`) pin the grammar, the matching and every refusal, CRLF preservation, the whole-patch preflight, the delete/move paths, and the presenter.
