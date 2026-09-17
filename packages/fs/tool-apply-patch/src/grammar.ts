/**
 * The Lark grammar a grammar-constrained wire constrains `apply_patch`'s input
 * with. It is the reference implementation's own grammar verbatim
 * (`codex-rs/core/assets/tools/apply_patch.lark`), so a model that knows the
 * Codex tool sees the same envelope here: the block headers, the body-line
 * prefixes, `@@` and `@@ <text>` hunks, `*** Move to:`, and `*** End of File`.
 *
 * The grammar describes the model's input only; the tool parses that input
 * itself, and the same envelope arrives as the JSON `patch` argument on wires
 * that cannot present a custom tool.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/grammar
 */

/** The `apply_patch` envelope grammar, in the Lark syntax the provider expects. */
export const APPLY_PATCH_LARK = [
  'start: begin_patch hunk+ end_patch',
  'begin_patch: "*** Begin Patch" LF',
  'end_patch: "*** End Patch" LF?',
  '',
  'hunk: add_hunk | delete_hunk | update_hunk',
  'add_hunk: "*** Add File: " filename LF add_line+',
  'delete_hunk: "*** Delete File: " filename LF',
  'update_hunk: "*** Update File: " filename LF change_move? change?',
  '',
  'filename: /(.+)/',
  'add_line: "+" /(.*)/ LF -> line',
  '',
  'change_move: "*** Move to: " filename LF',
  'change: (change_context | change_line)+ eof_line?',
  'change_context: ("@@" | "@@ " /(.+)/) LF',
  'change_line: ("+" | "-" | " ") /(.*)/ LF',
  'eof_line: "*** End of File" LF',
  '',
  '%import common.LF',
].join('\n')
