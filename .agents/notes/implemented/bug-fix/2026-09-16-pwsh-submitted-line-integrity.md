# Agent Note: Persistent pwsh submitted-line integrity

Status: implemented

English | [中文](2026-09-16-pwsh-submitted-line-integrity.zh.md)

## Problem

`@deepseek-ai/dsh-tool-pwsh-persistent` submits one wrapped line per command and anchors extraction on the START marker the shell prints. On Windows with pwsh 7.6.6 and PSReadLine 2.4.5, the wrapper reached the shell with its first character missing (`rite-Output ...`), so the first statement raised `CommandNotFoundException`, no START marker was printed, extraction fell back to the echoed copy of the line, and roughly 1.3 KB of echoed wrapper plus the error text reached the model. Commands, output, and exit codes were otherwise unaffected, and the reporter observed the loss intermittently.

Reproduced on the reporting host's stack (node-pty 1.2.0-beta.15, pwsh 7.6.6, PSReadLine 2.4.5, Windows 11 26200): 40 of 40 calls in one session lost the first character, `$Error[0].Exception.CommandName` reported `rite-Output`, and the raw ConPTY stream carried PSReadLine's own crash report at the insert of that character.

## Decision

Two changes, one per defect.

`dsh-terminal-bash`'s pwsh bootstrap prepends `Set-PSReadLineOption -PredictionSource None -HistorySaveStyle SaveNothing` to the setup line it submits before the prompt function, so the shell never renders an inline prediction and never appends submitted lines to the console host's history file.

`dsh-tool-pwsh-persistent` anchors the output start in `outputStart`: after the START marker the shell printed, or — when no START marker was printed — after the echoed line's END marker. The previous `replaceAll(wrapper, '')` fallback is gone.

### Why the first character vanished

PSReadLine 2.4.5 defaults to `PredictionSource=HistoryAndPlugin` with `PredictionViewStyle=InlineView` when no settings file and no profile define it. It renders the predicted history entry into the input line as characters arrive. Rendering a long prediction crashed the renderer: `System.IndexOutOfRangeException` from `System.Text.StringBuilder.get_Chars(Int32)` through `Microsoft.PowerShell.PSConsoleReadLine.ConvertOffsetToPoint`, `ReallyRender`, `ForceRender`, `Render`, `Insert`, and `SelfInsert`. The crashed reader discarded its buffer, including the character being inserted, and the remaining queued input was read by a new reader — so the shell executed the submitted line minus its first character.

The predicted entry was a wrapper this tool had submitted earlier. PSReadLine's `HistorySaveStyle` recorded every submitted line in the console host's shared `ConsoleHost_history.txt`, where 1475 of 4693 lines were tool wrappers, including wrappers of multi-kilobyte pasted commands. That is why the loss looked intermittent: the newest matching entry decides what the prediction renders.

### Why the echo reached the model

`commandOutput` took the last START-marker occurrence before the END marker. With the first statement failed, the only copy was inside PSReadLine's echo, where the wrapper's closing quote follows the marker; the captured slice therefore began mid-echo at `'`, and `replaceAll(wrapper, '')` cannot match a partial copy. The echoed copy is not a faithful single render either: PSReadLine redraws the line as it arrives, so the retained text is a concatenation of partial renders separated by the carriage returns the sanitizer turns into line breaks. Anchoring on the printed START marker, or on the echoed END marker's line end, bounds the echo by construction instead of by string match.

## Alternatives considered

- **Start the wrapper with a character whose loss is harmless.** Rejected: PSReadLine recomputes the prediction on every inserted character, so a crash at a later insert drops an interior character and silently corrupts the command. Only disabling the crash source bounds the damage.
- **Match and strip the echoed wrapper as text.** Rejected: the echo is a sequence of partial redraws, so the wrapper rarely appears as one contiguous string; the archived [persistent pwsh note](../../archived/architecture/2026-08-11-pwsh-persistent-pty.md) chose this mechanism and recorded it as a residual leak. This note replaces that mechanism with a marker-derived boundary.
- **Keep prediction on and set `-AddToHistory:$false` instead.** Rejected as unusable: PSReadLine 2.4.5 has no such parameter, and prefix binding sends it to `-AddToHistoryHandler`, which fails the whole call and leaves `PredictionSource` unchanged.
- **Run pwsh non-interactively or replace the line editor.** Rejected: the shell exists to host interactive child REPLs, and `-NonInteractive` changes host behavior, readiness evidence, and rendering. Pinning two options on the setup line keeps the interactive host.
- **Treat the truncation as an upstream PSReadLine defect and document it.** Rejected: a truncated submission executes a different command than the model asked for, and this tool owns the line it submits. The pin also keeps synthetic wrapper lines out of the user's own shell history.
- **Apply the same extraction change to `dsh-tool-bash-persistent`.** Rejected: bash's readline renders no predictions, so the observed mechanism cannot occur, and the bash tool never had the wrapper-source strip. Its extraction stays as it is, unverified on this host for lack of a POSIX shell.

## Consequences

**The pwsh dialect no longer renders predictions or records history.** Submitted lines stay out of the console host's shared history file after the bootstrap line (the option takes effect once that line runs, so the bootstrap line itself is still recorded), and the shell loses inline prediction and history-based suggestions.

**Extraction no longer depends on the wrapper appearing verbatim.** The echoed wrapper cannot reach the model on the paths where extraction previously fell back to the echo; a fragment can still appear only when the retained scrollback window begins inside the echo, bounded by `maxOutputChars`.

**Verification.** With the pin reverted, the same product-stack harness reproduced 40 of 40 truncated calls, and the raw stream reproduced 12 of 12 crashes and 12 of 12 dropped characters; with `-PredictionSource None` the same state produced 0 of 12, and a fresh history file produced 0 of 12. After the change, 40 of 40 calls were clean, the tool's shell reported `PredictionSource=None` and `HistorySaveStyle=SaveNothing`, and the shared history file grew by one line across 20 calls instead of one line per call. `tool-pwsh-persistent` stub modes cover a submission whose START marker was never printed, both as one echo render and as PSReadLine's split render; both fail against the previous extraction. `terminal-bash`'s pwsh lane asserts the shell's line-editor settings and fails with `HistoryAndPlugin/SaveIncrementally` when the pin is removed.

**Coverage gaps.** No automated test reproduces the PSReadLine crash itself: it needs PSReadLine 2.4.x, a real ConPTY, and a host history file whose newest matching entry renders out of bounds. The pin assertion in `terminal-bash`'s pwsh lane also runs only on hosts that ship pwsh and are not Windows-excluded by the repository test inventory, so the Windows-native evidence for this change is the manual reproduction recorded above.
