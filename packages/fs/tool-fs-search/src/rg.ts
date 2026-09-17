/**
 * The model-facing `rg` tool: run the packaged ripgrep binary with the model's
 * own argument line and return ripgrep's raw stdout, which is the surface the
 * structured `grep` tool does not expose — counts, file lists, context lines,
 * type filters, inverted matches, multiline search.
 *
 * ## The argument line reaches ripgrep verbatim
 *
 * The line is tokenized here (whitespace separated; single or double quotes
 * group one token; no escape processing, no expansion, no shell) and those
 * tokens become ripgrep's argv unchanged, so the model reaches the same flag
 * surface it would by running `rg` itself. This spawn is deliberately
 * unconfined today: it does not route through the sandbox seam, so a flag that
 * runs another program (`--pre`) or reads another file (`-f`, `--ignore-file`)
 * executes outside that fence. `--no-config` is still prepended, so a host
 * configuration file cannot contribute flags the model did not write.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/rg
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { ItemRetainer } from '@deepseek-ai/dsh-output-retention'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { SpillRef } from '@deepseek-ai/dsh-spill'
import { previewLine, runRipgrep, trySaveFormattedResult } from './search-core.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

/**
 * Default cap on output lines retained inline by one `rg` call (the
 * `rgMaxLines` config); the remainder lives in the formatted spill file.
 */
export const RG_MAX_LINES = 200

/** Resolved `rg`-tool caps — plugin config after defaulting (see `Config` in index.ts). */
export interface RgToolCaps {
  /** Max output lines retained inline; later lines go to the formatted spill file. */
  maxLines: number
  /** Max bytes retained per output line (the shared `grepMaxLineBytes` budget). */
  maxLineBytes: number
  /** Cap on the complete raw `rg` stdout the tool will read. */
  rawOutputMaxBytes: number
  /** Terminate-escalation grace period (ms) for the search process. */
  graceMs: number
  /** Cap on the retained stderr diagnostic tail. */
  stderrMaxBytes: number
  /** Cooperative tool-call budget (ms) attached as `ToolDefinition.timeoutMs`. */
  timeoutMs: number
}

/** Validated `rg` arguments. */
export interface RgInput {
  /** The original argument line, for the pending-call title. */
  args: string
  /** The complete ripgrep argument vector (excluding the binary and `--no-config`). */
  argv: string[]
}

/**
 * Split the model's argument line into argv tokens: whitespace-separated, with
 * single or double quotes grouping a run of characters into one token. There is
 * no escape processing, no variable expansion, and no shell layer — the tokens
 * become argv elements verbatim.
 *
 * @param args - the model's ripgrep argument line.
 * @returns the tokens, in order; an empty token is kept only when quoted.
 */
function tokenizeArgs(args: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | undefined
  for (const char of args) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += char
    started = true
  }
  if (quote !== undefined) throw new Error(`rg arguments contain an unterminated ${quote} quote`)
  if (started) tokens.push(current)
  return tokens
}

/**
 * Validate one `rg` call and build its argv: the argument line is tokenized
 * here and the tokens become ripgrep's argv unchanged, so the model reaches
 * ripgrep's own flag vocabulary and ripgrep's own argument errors. Two shapes
 * are refused up front because this tool can never satisfy them: a blank
 * argument line, and the positional `-`, which asks ripgrep to read patterns
 * from a stdin the spawn does not provide. Constraints the schema DSL cannot
 * express throw a plain `Error` (an ordinary tool argument error).
 *
 * @param args - the schema-validated `rg` arguments.
 * @returns the accepted input with its complete argv.
 */
export function parseRgArgs(args: { args: string }): RgInput {
  if (args.args.trim().length === 0) throw new Error('args must carry ripgrep arguments')
  const argv = tokenizeArgs(args.args)
  if (argv.includes('-')) {
    throw new Error('rg: reading patterns from stdin is not supported; pass a pattern and paths')
  }
  return { args: args.args, argv }
}

/**
 * Build the ripgrep argv for one validated `rg` call.
 *
 * @param input - the validated arguments.
 * @returns the complete ripgrep argument vector (excluding the binary itself).
 */
export function buildRgCommand(input: RgInput): string[] {
  return [...input.argv]
}

/**
 * Apply the shared inline cap to a canonical `rg` output line list: preview each
 * retained line to `maxLineBytes` and keep the first `maxLines`. The single
 * retention pass serves both the model-facing render and the complete spill.
 *
 * @param lines - every output line the search returned.
 * @param maxLines - the inline line cap (the `rgMaxLines` config).
 * @param maxLineBytes - the per-line preview budget in bytes.
 * @returns the retention outcome over the previewed lines.
 */
export function retainRgLines(lines: string[], maxLines: number, maxLineBytes: number): RetainedItems<string> {
  const retainer = new ItemRetainer<string>({ kind: 'head', maxItems: maxLines })
  for (const line of lines) retainer.push(previewLine(line, maxLineBytes))
  return retainer.finish()
}

/**
 * Format the model-facing `rg` result: ripgrep's own output lines, then — when
 * the result was capped — a footer carrying either the formatted-spill recovery
 * locator or the could-not-save explanation. No header is added: the value of
 * this tool is the unmodified output, and the omitted-line count is a budget
 * fact, not a search result.
 *
 * @param retained - the retention outcome over every output line.
 * @param spillRef - the saved complete-result reference, or `undefined` when unsaved.
 * @returns the model-facing text.
 */
export function formatRgOutput(retained: RetainedItems<string>, spillRef: SpillRef | undefined): string {
  if (retained.seen === 0) return 'No matches found'
  const body = retained.items.join('\n')
  if (!retained.truncated) return body
  const recovery = spillRef !== undefined
    ? `Full rg output stored at: ${spillRef.locator}. ${spillRef.retrievalHint}`
    : 'The complete output could not be saved; narrow the pattern, paths, or flags to see more.'
  return `${body}\n\n(Showing ${retained.kept} of ${retained.seen} output lines. ${recovery})`
}

/**
 * Pending-call presentation: a search card titled by the argument line.
 *
 * @param args - the raw tool arguments; the argument line feeds the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentRgCall(args: { args: string }): GenericCallView {
  return { card: 'generic', title: `rg ${args.args}`, kind: 'search', rawInput: args.args }
}

/**
 * Register the `rg` tool. Its flag allowlists are the whole safety story, so the
 * registration adds no prompt section: the model learns the accepted surface
 * from the tool description, and the `grep` tool's guidance still owns the
 * "prefer the structured tool" half of the choice.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved `rg` caps (plugin config after defaulting).
 */
export function applyRgTool(ctx: Context, caps: RgToolCaps): void {
  const tool = defineTool({
    name: 'rg',
    description: 'Run the packaged ripgrep with your own flags and return its raw output. Use it for ripgrep features the grep tool does not expose: counts, file lists, context lines, type filters, inverted matches, multiline search. '
      + 'The argument line reaches ripgrep verbatim — quotes group a token, and no shell expansion applies — so ripgrep reports its own argument errors. '
      + 'Use `--files` to list paths instead of matching content. '
      + `Keeps the first ${caps.maxLines} output lines inline; a capped result reports where the complete output was saved.`,
    parameters: {
      args: { type: 'string', required: true, description: 'The ripgrep arguments: flags then the pattern and paths, e.g. "-n -g *.ts pattern src". Quotes group a token; no shell expansion applies.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatRgOutput(retainRgLines(value.lines, caps.maxLines, caps.maxLineBytes), undefined),
      }],
    },
    async execute(args, exec) {
      const input = parseRgArgs(args)
      const run = await runRipgrep(ctx, exec, 'rg', buildRgCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      if (run.noMatches) return { lines: [] }
      const text = run.stdout.replace(/\r?\n$/, '')
      if (text.length === 0) return { lines: [] }
      return { lines: text.split('\n').map(line => line.replace(/\r$/, '')) }
    },
    presentCall: presentRgCall,
  })
  ctx.tools.register(tool)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as { lines: string[] } | undefined
    if (value === undefined) return decision
    const lines = value.lines
    if (lines.length <= caps.maxLines) return decision
    // The spill artifact holds the COMPLETE output: preview each line, but keep
    // every line (no inline cap), so the recovery file is the full search.
    const spillRef = await trySaveFormattedResult(
      ctx,
      exec,
      'rg-results.txt',
      lines.map(line => previewLine(line, caps.maxLineBytes)).join('\n'),
    )
    return {
      kind: 'accept',
      content: [{
        type: 'text',
        text: formatRgOutput(retainRgLines(lines, caps.maxLines, caps.maxLineBytes), spillRef),
      }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
