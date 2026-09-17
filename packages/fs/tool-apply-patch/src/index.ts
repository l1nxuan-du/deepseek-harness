/**
 * Model-facing `apply_patch`: one Codex-style envelope that adds, updates,
 * moves, and deletes several files in a single call over the Harness
 * filesystem seam (`ctx.fs`), applied only after every operation was checked.
 * @module @deepseek-ai/dsh-tool-apply-patch
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { APPLY_PATCH_LARK } from './grammar.ts'
import { applyPatch } from './run.ts'
import { sandboxFence } from './sandbox.ts'

export { APPLY_PATCH_LARK } from './grammar.ts'

const DEFAULT_DESCRIPTION = [
  'Apply a Codex-style multi-file patch to the workspace.',
  '',
  'The patch must use the Codex envelope:',
  '',
  '~~~text',
  '*** Begin Patch',
  '*** Add File: path',
  '+content',
  '*** Update File: path',
  '@@',
  ' context',
  '-old',
  '+new',
  '*** Move to: new-path',
  '*** Delete File: path',
  '*** End Patch',
  '~~~',
  '',
  'Paths may be absolute or relative to the session working directory. Every hunk is checked against its file before anything is written, so a patch whose anchor lines are missing is declined whole; a failure that only the write itself can report — a file that changed since it was read, a sandbox denial — leaves the operations before it applied.',
  '',
  'Updates match whole lines and apply at the first run that matches: exactly, then ignoring surrounding whitespace, then ignoring the difference between plain ASCII and typographic punctuation. A hunk that removes and keeps nothing is inserted at the end of the file, and a `*** End of File` line anchors its hunk there. Line endings of untouched lines are kept, inserted lines take the file\'s own ending, and an updated file ends with a newline.',
  '',
  '`*** Add File: ` writes over an existing path, `*** Move to: ` writes over an existing destination, and removing a path that is not a regular file is refused.',
].join('\n')

/** Every block header a patch may carry, capturing the path it names. */
const HEADER_LINE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm

/** Findings printed per detail list under a declined hunk when no configuration overrides it. */
const DEFAULT_DETAIL_LIMIT = 3

/** Configuration with every field resolved. */
interface ResolvedConfig {
  description: string
  detailLimit: number
  freeform: boolean
}

/**
 * The pending presentation of one patch call. The call carries patch text and
 * nothing else, so the hunks it will apply are unknown until execution reads
 * the files: this stays a generic edit card naming the header paths, and never
 * a diff card with changes the call cannot compute.
 * @param args - the validated call arguments.
 * @returns the pending call view.
 */
function presentCall(args: { patch: string }): GenericCallView {
  return {
    card: 'generic',
    title: 'apply_patch',
    kind: 'edit',
    locations: [...args.patch.matchAll(HEADER_LINE)].map(match => ({ path: (match[1] as string).trim() })),
  }
}

/**
 * Register the model-facing `apply_patch` tool.
 * @param ctx - plugin context carrying `fs` and the `tools` registry.
 * @param config - the resolved plugin configuration.
 */
function registerApplyPatchTool(ctx: Context, config: ResolvedConfig): void {
  const fence = sandboxFence(ctx)
  ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: config.description,
    // A grammar-constrained wire presents the envelope as freeform input, so the
    // model writes it without JSON escaping; the tool layer delivers that text
    // as `patch`, exactly as the JSON form does elsewhere.
    ...config.freeform ? { freeform: { syntax: 'lark' as const, definition: APPLY_PATCH_LARK, parameter: 'patch' } } : {},
    parameters: {
      patch: {
        type: 'string',
        required: true,
        description: 'The complete Codex-style patch envelope.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      return await applyPatch(ctx, args.patch, exec, config.detailLimit, fence)
    },
    presentCall,
  }))
}

export const name = 'tool-apply-patch'
export const inject = ['tools', 'fs']

/** Configuration for the `apply_patch` tool. */
export interface Config {
  /** Model-facing tool description; replace it with the deployment's own editing guidance. */
  description?: string
  /** Findings printed per detail list under a declined hunk; raise it for a richer, more expensive diagnosis. */
  detailLimit?: number
  /**
   * Offer the envelope as grammar-constrained freeform input where the wire
   * supports custom tools (default `true`). Set `false` when the configured
   * endpoint rejects custom tools, which leaves the JSON `patch` argument form
   * on every wire.
   */
  freeform?: boolean
}

/** Runtime configuration schema for the `apply_patch` tool. */
export const Config: z<Config> = z.object({
  description: z.string().default(DEFAULT_DESCRIPTION),
  detailLimit: z.number().default(DEFAULT_DETAIL_LIMIT),
  freeform: z.boolean().default(true),
})

/**
 * Register one `apply_patch` tool over `ctx.fs`.
 * @param ctx - plugin context carrying `tools`, `fs`, and — when the mounted
 *   filesystem confines — `sandboxPolicy`.
 * @param config - the plugin configuration; every field is validated here
 *   before the tool is registered.
 * @throws Error when the description is blank, `detailLimit` is not a positive
 *   safe integer, or a confining filesystem is mounted without a policy service.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    description: config.description ?? DEFAULT_DESCRIPTION,
    detailLimit: config.detailLimit ?? DEFAULT_DETAIL_LIMIT,
    freeform: config.freeform ?? true,
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-apply-patch: description must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.detailLimit) || resolved.detailLimit <= 0) {
    throw new Error('tool-apply-patch: detailLimit must be a positive safe integer')
  }
  registerApplyPatchTool(ctx, resolved)
}
