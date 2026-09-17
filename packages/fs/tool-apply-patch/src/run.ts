/**
 * Execution of one parsed patch over `ctx.fs`: the preflight pass that replays
 * every operation against an in-memory overlay, and the commit pass that walks
 * the same operations in the same order to perform them.
 *
 * Operation semantics follow Codex's `apply-patch` crate: `*** Add File: `
 * writes its content whether or not the path existed, `*** Move to: ` writes
 * over an existing destination, and removing a path that is not a regular file
 * is refused. The preflight makes every deterministic failure — an unmatchable
 * hunk, a path that is not a regular file — surface before the first byte is
 * written; the commit pass re-validates as it goes, so a patch that failed
 * preflight never reaches it.
 *
 * This is NOT a transaction. A failure only the provider or the shell can
 * report while committing — a version that went stale between the read and the
 * write, a sandbox denial, a failed delete — stops the call with the operations
 * before it already applied; nothing is rolled back.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/run
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsVersion, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { deleteTarget } from './delete.ts'
import { applyHunks } from './hunks.ts'
import { parsePatch } from './patch.ts'
import type { PatchOperation } from './patch.ts'
import type { SandboxFence } from './sandbox.ts'
import { sessionCwd } from './session-cwd.ts'

/**
 * Content by target key, or `undefined` for a key a previous operation of this
 * patch removed. Keyed by the opaque target key so two spellings of one file
 * share an entry.
 */
type Overlay = Map<string, string | undefined>

/**
 * The complete content an add block writes: its body lines joined by LF plus a
 * trailing newline, or the empty string when the block has no body line.
 * @param lines - body lines without their `+`, in patch order.
 * @returns the file content to write.
 */
function addedContent(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * Resolve one header path against the calling session's workspace.
 * @param ctx - plugin context carrying `fs`.
 * @param path - the trimmed header remainder.
 * @param exec - the tool-execution context (session cwd, signal).
 * @returns the backend-resolved target.
 * @throws Error when the header carried no path.
 */
async function resolveTarget(ctx: Context, path: string, exec: ToolRunContext): Promise<FsTarget> {
  if (path.trim().length === 0) throw new Error('patch path must be non-empty')
  const cwd = sessionCwd(exec)
  return await ctx.fs.resolve(path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
}

/**
 * Replay every operation against an in-memory overlay, so no deterministic
 * failure can reach the commit pass. The overlay holds the post-operation
 * content of each path this patch has already decided on, which is what makes
 * two operations on one path behave like the sequential edit they describe.
 *
 * These reads stay off the `fs/observed` event: observing a file is the commit
 * pass's job, and a preflight that emitted would report every read twice.
 * @param ctx - plugin context carrying `fs`.
 * @param operations - the parsed operations, in patch order.
 * @param exec - the tool-execution context (signal).
 * @param detailLimit - how many findings of each miss-detail list are printed.
 * @throws FsError `FS_NOT_FOUND` for a delete of a missing path,
 *   `FS_NOT_REGULAR_FILE` for an operation that names a directory or a special file,
 *   and the hunk failures of {@link applyHunks}.
 */
async function preflight(ctx: Context, operations: readonly PatchOperation[], exec: ToolRunContext, detailLimit: number): Promise<void> {
  const overlay: Overlay = new Map()
  /** The content this patch currently sees for a target: overlay first, then the provider. */
  const contents = async (target: FsTarget): Promise<string | undefined> => {
    if (overlay.has(target.targetKey)) return overlay.get(target.targetKey)
    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined) return undefined
    if (info.type !== 'file') {
      throw new FsError(`cannot update ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    return await ctx.fs.readText(target, exec.signal)
  }

  for (const operation of operations) {
    const target = await resolveTarget(ctx, operation.path, exec)
    if (operation.kind === 'add') {
      // An add writes over whatever is there, but a directory or device is still refused.
      const existing = await ctx.fs.stat(target, exec.signal)
      if (existing !== undefined && existing.type !== 'file') {
        throw new FsError(`cannot add ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      overlay.set(target.targetKey, addedContent(operation.lines))
      continue
    }
    if (operation.kind === 'delete') {
      const info = await ctx.fs.stat(target, exec.signal)
      if (info !== undefined && info.type !== 'file') {
        throw new FsError(`Failed to remove ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (await contents(target) === undefined) {
        throw new FsError(`Failed to remove ${target.displayPath}: no such file`, 'FS_NOT_FOUND')
      }
      overlay.set(target.targetKey, undefined)
      continue
    }

    const current = await contents(target)
    if (current === undefined) {
      throw new FsError(`Failed to update ${target.displayPath}: no such file`, 'FS_NOT_REGULAR_FILE')
    }
    const next = applyHunks(current, operation.hunks, target.displayPath, detailLimit)
    if (operation.moveTo === undefined) {
      overlay.set(target.targetKey, next)
      continue
    }
    const destination = await resolveTarget(ctx, operation.moveTo, exec)
    const occupied = await ctx.fs.stat(destination, exec.signal)
    if (occupied !== undefined && occupied.type !== 'file') {
      throw new FsError(`cannot move onto ${destination.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    overlay.set(destination.targetKey, next)
    overlay.set(target.targetKey, undefined)
  }
}

/**
 * Record the presence of an existing target so a policy plugin can authorize
 * the write that replaces it.
 * @param ctx - plugin context carrying `fs`.
 * @param target - the resolved target to record.
 * @param exec - the tool-execution context (signal).
 * @returns the version the write must be based on, or undefined when the path is absent.
 * @throws FsError `FS_NOT_REGULAR_FILE` when the path exists and is not a regular file.
 */
async function observeExisting(ctx: Context, target: FsTarget, exec: ToolRunContext): Promise<FsVersion | undefined> {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) return undefined
  if (info.type !== 'file') {
    throw new FsError(`cannot write ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return info.version
}

/**
 * Write one path's complete content through the `fs/write-intent` waterfall,
 * recording the version the write produced. An existing path is observed first,
 * so the mounted policy guards the replacement exactly as it guards `write`.
 * @param ctx - plugin context carrying `fs`.
 * @param target - the resolved destination.
 * @param content - the complete content to write.
 * @param exec - the tool-execution context (signal).
 * @param policy - the sandbox policy of this call.
 * @param fence - maps a sandbox denial for the model.
 * @returns the outcome of the write.
 */
async function writePath(
  ctx: Context,
  target: FsTarget,
  content: string,
  exec: ToolRunContext,
  policy: SandboxExecutionPolicy | undefined,
  fence: SandboxFence,
): Promise<FsWriteOutcome> {
  const version = await observeExisting(ctx, target, exec)
  // Without a policy listener the bare provider's write still needs the guard
  // that matches what this call observed: an absent path is created, and an
  // existing one is replaced at the version just recorded.
  const intent = await ctx.waterfall(
    'fs/write-intent',
    target,
    exec,
    () => version === undefined ? { kind: 'createIfAbsent' } as const : { kind: 'replaceIfVersion', version } as const,
  )
  let outcome: FsWriteOutcome
  try {
    outcome = await ctx.fs.writeText(target, content, intent, exec.signal, policy)
  } catch (error: unknown) {
    throw fence.mapError(error, policy)
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  return outcome
}

/**
 * Perform the patch, in patch order, and report the files it touched.
 * @param ctx - plugin context carrying `fs`, `shell` for removals, and the `fs/*` events.
 * @param patch - the complete patch envelope text.
 * @param exec - the tool-execution context (agent, signal).
 * @param detailLimit - how many findings of each miss-detail list are printed.
 * @param fence - the sandbox fence of this composition.
 * @returns the reference implementation's summary: `Success. Updated the following files:`
 *   followed by one `A`, `M`, or `D` line per path, grouped by that letter.
 * @throws Error when the envelope is malformed or declares no operation.
 * @throws FsError with the code of the first failing operation. Nothing is rolled back after the commit pass has started.
 */
export async function applyPatch(
  ctx: Context,
  patch: string,
  exec: ToolRunContext,
  detailLimit: number,
  fence: SandboxFence,
): Promise<string> {
  const operations = parsePatch(patch)
  if (operations.length === 0) throw new Error('No files were modified.')

  // Nothing is written until the whole patch is known to be applicable.
  await preflight(ctx, operations, exec, detailLimit)

  const policy = fence.resolve(exec)
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const operation of operations) {
    const target = await resolveTarget(ctx, operation.path, exec)
    if (operation.kind === 'add') {
      await writePath(ctx, target, addedContent(operation.lines), exec, policy, fence)
      added.push(target.displayPath)
      continue
    }
    if (operation.kind === 'delete') {
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) throw new FsError(`Failed to remove ${target.displayPath}: no such file`, 'FS_NOT_FOUND')
      if (info.type !== 'file') {
        throw new FsError(`Failed to remove ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      await deleteTarget(ctx, target, exec, policy)
      deleted.push(target.displayPath)
      continue
    }

    const info = await ctx.fs.stat(target, exec.signal)
    if (info?.type !== 'file') {
      throw new FsError(`Failed to update ${target.displayPath}: not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    const content = await ctx.fs.readText(target, exec.signal)
    ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
    const next = applyHunks(content, operation.hunks, target.displayPath, detailLimit)
    if (operation.moveTo !== undefined) {
      const destination = await resolveTarget(ctx, operation.moveTo, exec)
      await writePath(ctx, destination, next, exec, policy, fence)
      await deleteTarget(ctx, target, exec, policy)
      modified.push(target.displayPath)
      continue
    }
    if (next !== content) {
      // A policy may guard the edit with its own version; without one the
      // version this call just read is the compare-and-swap basis.
      const guard = await ctx.waterfall('fs/edit-intent', target, exec, () => ({ version: info.version }))
      const basis = guard === undefined ? info.version : guard.version
      try {
        await ctx.fs.writeText(target, next, { kind: 'replaceIfVersion', version: basis }, exec.signal, policy)
      } catch (error: unknown) {
        throw fence.mapError(error, policy)
      }
      const written = await ctx.fs.stat(target, exec.signal)
      if (written?.type === 'file') {
        ctx.emit('fs/observed', target, { kind: 'present', version: written.version }, exec)
      }
    }
    modified.push(target.displayPath)
  }
  return [
    'Success. Updated the following files:',
    ...added.map(path => `A ${path}`),
    ...modified.map(path => `M ${path}`),
    ...deleted.map(path => `D ${path}`),
  ].join('\n')
}
