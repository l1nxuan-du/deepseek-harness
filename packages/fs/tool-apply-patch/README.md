---
description: "The standalone apply_patch tool over ctx.fs for users and maintainers composing Codex-style multi-file patching for agents."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-apply-patch

English | [中文](README.zh.md)

## Summary

`dsh-tool-apply-patch` provides a model-facing `apply_patch` tool over `ctx.fs`: one Codex-style envelope adds, updates, moves, and deletes several files in a single call, and its result is the reference implementation's `Success. Updated the following files:` summary with one `A`, `M`, or `D` line per path. Every hunk is checked against its file before anything is written; matching follows the reference tool's leniency (exact, then ignoring surrounding whitespace, then ignoring ASCII-versus-typographic punctuation), line endings of untouched lines survive while inserted lines take the file's own ending, and an updated file ends with a newline. Choose it when a deployment wants Codex-style multi-file patching; the `dsh-tool-fs` package provides the alternative `read`/`write`/`edit` suite.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the tool alongside a `ctx.fs` backend, the policy plugin that guards mutations, and a shell service when the model should edit several files in one call: removing a path is one shell command, so `*** Delete File: ` and the source of a move need `ctx.shell`.

On a wire that supports grammar-constrained custom tools the envelope is offered as freeform input constrained by the reference implementation's own Lark grammar, so the model writes the patch without JSON escaping it; every other wire keeps the JSON `patch` argument. A deployment whose endpoint rejects custom tools sets `freeform: false` and gets the JSON form everywhere.

### Minimal composition

A backend, the policy plugin, a shell, then the tool.

```yaml
- name: '@deepseek-ai/dsh-fs-local'
- name: '@deepseek-ai/dsh-fs-observation-policy'
- name: '@deepseek-ai/dsh-tool-bash'
- name: '@deepseek-ai/dsh-tool-apply-patch'
```

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `description` | `Apply a Codex-style multi-file patch to the workspace.` (multi-line) | Model-facing tool description |
| `detailLimit` | `3` | Findings printed per detail list under a declined hunk |
| `freeform` | `true` | Offer the envelope as grammar-constrained freeform input where the wire supports custom tools |

### The envelope

The first and last lines are `*** Begin Patch` and `*** End Patch`, both compared after trimming and with only blank lines allowed after the closing line. `*** Add File: `, `*** Update File: `, and `*** Delete File: ` open a block from any state; `*** Move to: ` is read inside an update block before its first hunk; `*** End of File` closes the hunk it follows. Add body lines start with `+`; update body lines start with a space (context), `-` (removed), or `+` (added); `@@` opens a hunk and `@@ <text>` first moves the search past the line that text names. A blank line inside an update block is an empty context line, and any other line that carries no prefix is refused with the offending line as a JSON string.

### File operations

`*** Add File: ` writes the body lines plus a trailing newline, or an empty file when the block has no body line, and it overwrites a path that already exists — the reference implementation's own add semantics. `*** Update File: ` requires a regular file, applies its hunks in order over the file the patch started from, and writes the result; a block whose hunks change nothing reports `M <path>` without a write. `*** Move to: ` writes the updated content over the destination, existing or not, and then removes the source, reporting `M <source>`. `*** Delete File: ` accepts no body line and refuses a path that is not a regular file.

### Failures and recovery

Every deterministic failure happens before the first write: a delete of a missing path (`FS_NOT_FOUND`), an update, add, or delete naming a path that is not a regular file (`FS_NOT_REGULAR_FILE`), and a hunk whose anchor lines are not in the file (`FS_EDIT_NOT_FOUND`). A hunk failure starts with `Failed to find expected lines in <path>:` and the hunk's own lines, names the hunk, carries `(the patch was declined, nothing was written)`, and adds indented detail lines: the hunk lines the file does not have with their nearest line, the position the block came closest to, and a hint when the hunk's own output is already in the file. The commit pass re-checks the world as it goes, so a change another process makes mid-patch stops the call at that operation with the operations before it applied. Sandbox denials surface as the shared `[sandbox: file access denied under <mode> mode]` marker. A composition that mounts no shell service refuses a deletion loudly instead of reporting a removed file.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The tool parses the whole envelope into operations, then runs two passes over them. The preflight replays every operation against an in-memory overlay keyed by the backend's opaque target key, which is where a repeated path behaves like the sequential edit it describes and where every deterministic refusal is raised before a byte is written. The commit pass walks the same operations in the same order, resolving the session sandbox policy once and re-validating as it goes. Mutations never assume: each one takes its guard from the `fs/write-intent` or `fs/edit-intent` waterfall, records the version it observed through `fs/observed`, and passes the per-call sandbox policy to the provider. Hunks match by comparing whole line text through the reference tool's four passes, never a slice of the file, which is what keeps a match on whole lines, lets a CRLF file accept a patch written with LF, and gives inserted lines the file's own ending.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin surface: schema, configuration, the pending call card |
| [`src/patch.ts`](src/patch.ts) | Envelope grammar and the operations it declares |
| [`src/hunks.ts`](src/hunks.ts) | Line model, whole-line matching, the splice, and the miss diagnostics |
| [`src/run.ts`](src/run.ts) | Preflight overlay and the commit pass |
| [`src/delete.ts`](src/delete.ts) | The shell command that removes a path |
| [`src/sandbox.ts`](src/sandbox.ts) | Per-call policy resolution and the denial marker |
| [`src/session-cwd.ts`](src/session-cwd.ts) | The workspace relative paths resolve against |

### How a patch runs

Parsing normalizes CRLF and lone CR terminators, then reads blocks and hunks without touching the filesystem. The preflight resolves every header path against the calling session's workspace and replays the operations: it stats, reads, and applies hunks to decide each path's post-operation content, keeping those reads off the event stream. The commit pass performs them for real, and its reads are the observations a policy plugin authorizes the following write with. Nothing is rolled back.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool to the contract, policy, and backends it composes with.

- [Filesystem subsystem](../../../docs/subsystems/filesystem.md) — exhaustive provider contract, policy events, and error taxonomy.
- [dsh-fs](../fs/README.md) — the `ctx.fs` contract this tool consumes.
- [tool-fs](../tool-fs/README.md) — the alternative `read`/`write`/`edit` tool suite.
- [fs-observation-policy](../fs-observation-policy/README.md) — the policy plugin that guards mutations through the `fs/*` events.
- [fs-sandbox](../fs-sandbox/README.md) — the sandbox-enforcing backend that fences mutations.
- [dsh-shell](../../shell/shell/README.md) — the executor seam that removes a deleted path.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-apply-patch) — the exhaustive schema this package registers.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`apply_patch` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-apply-patch) with its one `patch` parameter, including the configured `description`. The plugin contributes no standalone system-prompt section.

#### Token effect

Fixed schema cost while `apply_patch` is visible.

#### KV Cache effect

Prefix-stable while the configured description and schema remain unchanged.

### Tool results

#### What the model sees

One line per operation — `A <path>`, `M <path>`, `R <source> -> <destination>`, `D <path>`, or `= <path>`, joined by newlines. A path-level refusal is one sentence naming the path. A declined hunk names the hunk and its file, states `(the patch was declined, nothing was written)`, and prints a bounded number of indented findings.

#### Token effect

Data-dependent, one line per operation, and bounded by `detailLimit` per declined-hunk detail list.

#### KV Cache effect

Append-only tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit or needs special operational care. They are current package constraints, not a general comparison with other editors or a task backlog.

- **A patch is not a transaction** — the preflight settles every deterministic refusal before the first write, but a commit-time failure (a version that went stale, a sandbox denial, a failed delete) stops the call with the operations before it applied.
- **An update records the presence its own read establishes** — the `fs/observed` event it emits before asking `fs/edit-intent` is what authorizes the write, so a read-before-edit policy is satisfied by the patch itself rather than by an earlier model read; the whole-line match is what proves the patch was written against the file's current content.
- **Deletions and moves need a shell service** — `ctx.fs` exposes no removal operation, so the tool runs the platform shell's own unconditional removal and reports the command's failure text.
- **Matching follows the reference tool's leniency** — exact, then ignoring surrounding whitespace, then ignoring surrounding whitespace and folding common typographic punctuation; a repeated run resolves to the first match at or after the cursor, and `@@ <text>` only moves where the search starts.
- **An update always ends the file with a terminator** — the reference implementation's long-standing behavior; untouched lines keep their own endings and inserted lines take the file's first ending.
- **Model-visible text is English only** — the tool description, refusals, and diagnostics are not localized.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The tool adapter owns no independent durable state; filesystem mutation relations stay with the provider and policy plugins.
