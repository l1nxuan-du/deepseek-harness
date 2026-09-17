/**
 * The sandbox fence a patch's mutations run under: the per-session policy
 * resolved before each write, move, and delete, and the marker every denied
 * mutation reports. The policy is built once per plugin from `ctx.fs.sandboxMode`
 * (the capability fact — does the mounted filesystem confine at all?), so a
 * patch is fenced exactly like the `write`/`edit` tools it can replace.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/sandbox
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** The sandbox facts for one patch call: the policy to stamp onto its mutations, and the denial mapping. */
export interface SandboxFence {
  /**
   * The policy this call's mutations run under: the calling session's standing
   * mode and workspace root.
   * @param exec - the tool-execution context; its agent supplies the session.
   * @returns the policy to pass to the filesystem and to a delete command, or undefined when the mounted filesystem never confines.
   */
  resolve(exec: ToolExecution): SandboxExecutionPolicy | undefined
  /**
   * Map a thrown mutation error for the model: a `FS_SANDBOX_DENIED` becomes an
   * `FsError` whose text is the shared `[sandbox: …]` marker the model already
   * recognizes from the shell tools, keeping the structured code so
   * retry/permission layers still branch on it. Any other error passes through.
   * @param error - the error thrown by the mutation.
   * @param policy - the policy stamped onto the call (names the mode in the marker).
   * @returns the error to throw — the marker `FsError` for a sandbox denial, else the original value.
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown
}

/**
 * Build the fence for one plugin instance.
 * @param ctx - plugin context carrying `fs`, and `sandboxPolicy` whenever `fs` confines.
 * @returns the fence whose policy resolution and denial mapping this plugin uses.
 * @throws Error when the mounted filesystem confines but `ctx.sandboxPolicy` is missing, because every mutation would then run unguarded.
 */
export function sandboxFence(ctx: Context): SandboxFence {
  const policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && policy === undefined) {
    throw new Error('tool-apply-patch: the mounted filesystem confines but ctx.sandboxPolicy is missing')
  }
  return {
    resolve: exec => policy?.resolve({ ...exec.agent !== undefined ? { session: exec.agent.session } : {} }),
    mapError: (error, active) => {
      if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
      return new FsError(sandboxDenialMarker((active as SandboxExecutionPolicy).mode), 'FS_SANDBOX_DENIED', { cause: error })
    },
  }
}
