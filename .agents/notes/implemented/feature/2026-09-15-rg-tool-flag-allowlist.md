# Agent Note: The rg tool passes the model's ripgrep argument line through

Status: implemented

English | [中文](2026-09-15-rg-tool-flag-allowlist.zh.md)

## Problem

The filesystem search suite exposes two typed tools: `grep` (pattern, path, include) and `glob` (pattern, root). Models trained on Codex reach for ripgrep's own flag vocabulary instead — count matches, list only the files that match, print three lines of context, restrict by type, invert the match — and every one of those is either a translation into the typed schema or a dead end. `rg` is not on the agent's shell PATH either: the binary this package runs lives inside the `@vscode/ripgrep` dependency, so a model that types `rg` in `bash` or `pwsh` finds a different program or nothing at all.

The first revision of this tool answered that gap with an allowlist: hand the packaged binary a validated argv and refuse every flag outside a fixed read-only set, because ripgrep executes other programs through `--pre` and reads arbitrary files through `-f`/`--ignore-file`, and the spawn is unconfined.

## Decision

`@deepseek-ai/dsh-tool-fs-search` registers a third model-facing tool, `rg`. It takes one string argument, the ripgrep argument line, tokenizes it (whitespace separated; single or double quotes group a token; no escape processing, no expansion, no shell), and hands those tokens to the packaged binary through the same `runRipgrep` seam as `grep`/`glob`, with `--no-config` prepended so a host configuration file cannot contribute flags the model did not write. Two shapes are refused up front because the tool can never satisfy them: a blank argument line, and the positional `-`, which asks ripgrep to read patterns from a stdin this spawn does not provide. Everything else reaches ripgrep exactly as written, so the model gets ripgrep's own vocabulary and ripgrep's own argument errors.

The allowlist is deferred, not rejected. This spawn does not yet route through the sandbox seam, so a flag that runs another program (`--pre`) or reads another file (`-f`, `--ignore-file`) currently executes outside that fence; the deployment that wires the sandbox owns re-introducing a boundary at the argument surface or leaving it to the fence.

The result is ripgrep's own stdout, not a structured payload: the model asked for ripgrep's output shape, and a search card would have to re-derive matches this tool deliberately does not parse. Inline output is capped by the new `rgMaxLines` config (default 200) with each line previewed at `grepMaxLineBytes`; a capped result saves the complete output to the spill store and names the locator, or reports that it could not be saved. No system-prompt section is registered: the tool description states the accepted surface, and the `grep` section still owns "prefer the structured tool for ordinary content search".

## Alternatives considered

**Keep the read-only allowlist.** It is the safer default while the spawn is unconfined, but it also makes the tool a second, smaller dialect of ripgrep: harmless flags (`--sortr`, `--type-add`) are refused, the model cannot predict the surface from its ripgrep knowledge, and the validity of the boundary rests on the allowlist's completeness rather than on an enforcement point. Deferred until the sandbox lands.

**A structured `rg` with typed parameters.** Rejected because it duplicates `grep`'s surface without adding the flag vocabulary that motivated the tool, and it would trip the cross-file duplication gate.

**Installing `rg` on the shell PATH (the modpack's approach, which is also what Codex itself does).** Rejected for this repository: it needs a deployment-side binary install and a user PATH mutation outside the tree, and it would move search out of the tool layer entirely, losing the inline cap, the spill handoff, and the result metadata. Reintroduction condition: a shipped deployment that gains a binary-install step could expose a PATH `rg` as well, without removing this tool.

## Consequences

The model gets ripgrep's whole flag surface without a shell and without an install step, and the tool's argument handling is one tokenizer instead of a flag parser plus three tables. The cost is explicit: until the sandbox fence reaches this spawn, `rg` can run a preprocessor and read files the model names, so a deployment that mounts this tool is trusting the model with its own process's reach.

`tests/tools.spec.ts` pins the tokenizer (quotes, whitespace, no expansion), the verbatim argv for representative flag shapes, the two refusals, the cap-and-spill path, and the registration roster.
