# Agent Note: The shipped preset roster: 飞猪模式, anchored standard, and the Codex pair

Status: implemented

English | [中文](2026-09-16-preset-roster-s1mple-mode.zh.md)

## Problem

The shipped roster was `standard`, `ptc`, `minimal`, and `cordis`. Two of those no longer matched what the deployment needed to offer: `minimal` caps the toolset at one persistent shell, and `standard` front-loads a persona paragraph plus harness identity and tool guidance that the operator wanted gone. The operator also maintained two Codex-instruction presets and their prompt pipeline outside the repository, and a community preset (`xiaobright/dsh-anchored-standard`, MIT) whose first-request anchoring they wanted shipped.

## Decision

The shipped roster is `s1mple-mode` (default), `anchored-standard`, `codex-v5`, `codex-v6`, `ptc`, and `cordis`; `standard` and `minimal` are deleted. The Web bundle's `agent-presets` default is `s1mple-mode`.

`s1mple-mode` (飞猪模式) is the `standard` composition with an empty persona: `prefix: ''` with `complete: true` and `includeRuntimeContext: false`, so the request carries no prompt text and no runtime-context snapshot while every tool row stays unchanged.

`anchored-standard` keeps the Minimal first-request condition and unlocks the rest on demand: six plugins ported from the community pack (MIT, attribution recorded in the preset's own comments) plus a composition assembled from this repository's `standard` rows. Its bootstrap pair is the platform's persistent shell (`bash` or `pwsh`) plus `str_replace_editor`; the first durable `tool/call` or `assistant/message` promotes the session to the bootstrap pair plus `dev_tool_search`, `skill_search`, and `skill_load`; a compaction returns it to the controlled phase. Two deliberate divergences from the upstream pack: the bootstrap shell is this repository's own persistent shell (the pack needed a Git-Bash `custom-bash` because its PTY backend was POSIX-only), and `str_replace_editor` consumes the host sandboxed `fs` instead of a bare `fs-local` realm, which would have put an unconfined write path behind a model-facing tool.

`codex-v5` and `codex-v6` are the `standard` rows plus the Codex instruction sets (GPT-5 and GPT-6/Astra) as the persona, checked in directly; the pack's `transform.mjs`/`build-preset.mjs`/`verify-preset.mjs` pipeline is not carried, its `dsh-codex-tools` dependency is replaced by the first-party `@deepseek-ai/dsh-tool-apply-patch` row that `standard` already mounts, and its pi-ai `codex-compat` runtime patch is dropped because this repository's own adapter sends the instructions. One sentence in each prompt was edited so it stops claiming PowerShell on every platform.

Recorded sessions that named `standard` were migrated to `s1mple-mode`, whose tool catalog is identical, and the CLI preset lane migrated with them.

## Alternatives considered

- **Keep `standard`/`minimal` and only add the new presets.** Rejected: the operator asked for replacement, and the roster would carry two presets whose behavior the new default covers.
- **Port the anchored pack's `custom-bash` and `fs-local` bootstrap.** Rejected: this repository's persistent `pwsh` already serves Windows, and the pack's bare-local-filesystem editor would let a model-facing tool write outside the sandbox policy.
- **Port the Codex prompt pipeline.** Rejected: the prompt belongs in the preset, and a checked-in text removes a build step, a fingerprint, and a verifier that all existed to protect a generated artifact.
- **Keep the recorded sessions on a compatibility preset id.** Rejected: a hidden preset would keep shipping the composition the operator deleted; migrating the fixtures to `s1mple-mode` preserves their recorded tool cards because the catalog is unchanged.

## Consequences

Three shipped presets were added and two deleted, and the Web default changed to `s1mple-mode`. The ported anchored plugins are `.mjs` files inside the preset directory: they are outside the repository's TypeScript programs, coverage gate, and lint scope, and their upstream unit suite was not carried, so their behavior is pinned by the `apps/cli/tests/web-agent-presets.e2e.ts` composition test (bootstrap pair, promotion, and the empty-prompt default) rather than by their own tests. Test expectations that named the deleted presets were migrated, including two that hardcoded `bash` and could never pass on Windows. The six shipped display names and descriptions resolve through locale keys, and the former `minimal-preset` Web snapshot now pins `anchored-standard` and its bootstrap pair. Web prompt coverage follows the default split: conversation and Goal lanes assert the empty `s1mple-mode` prompt, while the fresh round-trip and permission-policy lanes explicitly select `cordis` for prompt and runtime-context rendering. The WebWorker preview follows the migrated session headers, and its packer ignores relative plugin specifiers when computing the package closure so a local row cannot appear as an unresolved package named `.`. The anchored pack is MIT-licensed; its copyright notice travels in the preset directory.
