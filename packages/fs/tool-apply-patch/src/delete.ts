/**
 * The delete half of `apply_patch`. `ctx.fs` has no removal operation, so a
 * `*** Delete File: ` block and the source of a move are removed by one shell
 * call built here: the platform shell's own unconditional file removal, whose
 * exit status and sandbox facts decide success. A composition without a shell
 * service refuses the call loudly rather than reporting a file as deleted.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/delete
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { sessionCwd } from './session-cwd.ts'

/**
 * The shell command that removes one path, in the dialect of the shell the
 * composition mounts for that platform: `rm -f --` under a POSIX shell, and
 * PowerShell's `Remove-Item -LiteralPath … -Force` on Windows. Both tolerate a
 * path that is already absent, and both take the path as one literal word, so a
 * name with quotes or spaces cannot become a second command word.
 * @param processPath - absolute path in the shell's own execution world, from `ctx.fs.processPath`.
 * @param platform - the platform whose shell runs the command.
 * @returns the complete command line to hand to `ctx.shell`.
 */
export function deleteCommand(processPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? `Remove-Item -LiteralPath '${processPath.replaceAll("'", "''")}' -Force`
    : `rm -f -- '${processPath.replaceAll("'", "'\"'\"'")}'`
}

/**
 * Remove one resolved target through the shell service, then record it as
 * absent so a policy's read-before-write state matches the world.
 * @param ctx - plugin context carrying `fs` and, in the deleting composition, the `shell` service.
 * @param target - the resolved target to remove.
 * @param exec - the tool-execution context (session cwd, signal).
 * @param policy - the sandbox policy of this call; omit when the mounted filesystem never confines.
 * @throws Error when no shell service is mounted, naming the missing service.
 * @throws FsError `FS_SANDBOX_DENIED` when the sandbox refused the command, `FS_IO_ERROR` when the command exited nonzero.
 */
export async function deleteTarget(
  ctx: Context,
  target: FsTarget,
  exec: ToolRunContext,
  policy: SandboxExecutionPolicy | undefined,
): Promise<void> {
  const shell = ctx.get('shell')
  if (shell === undefined) {
    throw new Error('tool-apply-patch: this composition mounts no shell service (ctx.shell), which removing a path requires')
  }
  const cwd = sessionCwd(exec)
  const request: ShellExecRequest = {
    command: deleteCommand(ctx.fs.processPath(target), process.platform),
    ...cwd === undefined ? {} : { workdir: cwd },
    signal: exec.signal,
    ...policy === undefined ? {} : { sandboxPolicy: policy },
  }
  const result = await shell.run(shell.resolve(request))
  if (result.sandbox?.denied === true) {
    throw new FsError(sandboxDenialMarker(result.sandbox.mode), 'FS_SANDBOX_DENIED')
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.text || `the delete command exited with code ${String(result.exitCode)}`
    throw new FsError(`apply_patch: cannot delete ${target.displayPath}: ${detail}`, 'FS_IO_ERROR')
  }
  ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
}
