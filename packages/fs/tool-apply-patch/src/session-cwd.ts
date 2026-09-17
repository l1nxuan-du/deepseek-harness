/**
 * The working directory a patch's relative paths resolve against: the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so a patch
 * acts on its own session's workspace rather than the server's launch
 * directory. A non-agent call returns `undefined`, leaving the fallback to the
 * filesystem provider instead of reading `process.cwd()` here.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * The session workspace cwd for this call.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}
