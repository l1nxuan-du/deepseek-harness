import { rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { deleteCommand } from '../src/delete.ts'
import * as ToolApplyPatch from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
let sequence = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * A `ctx.shell` whose runs the test decides, so the delete and move paths run
 * on every platform instead of depending on a host shell.
 */
class FakeShell extends ShellExecutor {
  /** Every request the tool resolved, in call order. */
  readonly requests: ShellExecRequest[] = []
  /** Every resolved command, in call order. */
  readonly commands: string[] = []
  /** The outcome of one run; the default succeeds with no output. */
  onRun: ((spec: ShellExecSpec) => Promise<ShellRunResult> | ShellRunResult) | undefined

  override resolve(request: ShellExecRequest): ShellExecSpec {
    this.requests.push(request)
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: 5_000,
      stdoutMaxBytes: 1_024,
      signal: request.signal,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.commands.push(spec.command)
    return await this.onRun?.(spec) ?? succeeded(spec)
  }

  override async start(): Promise<ShellProcess> {
    throw new Error('apply_patch runs foreground commands only')
  }
}

/** One successful run with no output. */
function succeeded(spec: ShellExecSpec): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: spec.timeoutMs,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  }
}

/** Build a patch envelope from its body lines. */
function envelope(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

/** The path a shell in this backend's world removes for `path`. */
async function shellPath(ctx: Context, path: string): Promise<string> {
  return ctx.fs.processPath(await ctx.fs.resolve(path))
}

/** An `fs/edit-intent` listener that guards with the supplied version, or declines to guard. */
function editGuard(version: FsVersion | undefined) {
  return (ctx: Context): void => {
    // The waterfall's declared slot answer is a promise, so a listener that
    // occupies it without calling next() answers promise-shaped.
    ctx.on('fs/edit-intent', () => Promise.resolve(version === undefined ? undefined : { version }))
  }
}

/**
 * Run one filesystem change the first time the tool records an observation,
 * which is the commit pass: the preflight emits nothing, so this simulates
 * another process changing the workspace between the two passes.
 */
function onceBeforeCommit(ctx: Context, change: () => void): void {
  let pending = true
  ctx.on('fs/observed', () => {
    if (!pending) return
    pending = false
    change()
  })
}

function agent(ctx: Context, cwd: string): Agent {
  const id = SessionId(`apply-patch-owner-${++sequence}`)
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * The summary one successful call returns: the reference implementation's
 * header plus its `A`, `M`, then `D` lines.
 * @param lines - the per-path lines the call is expected to report.
 * @returns the complete model-facing result text.
 */
function summary(...lines: string[]): string {
  return ['Success. Updated the following files:', ...lines].join('\n')
}

function call(ctx: Context, owner: Agent | undefined, patch: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`apply-patch-${++sequence}`),
    name: 'apply_patch',
    arguments: { patch },
    ...owner === undefined ? {} : { agent: owner },
  })
}

async function setup(
  config: ToolApplyPatch.Config = {},
  options: { fsPolicy?: boolean; shell?: boolean; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-apply-patch-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (options.sandboxMode === undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
  } else {
    // SandboxPolicy declares the registry as a required injection; mount it
    // before the policy activates.
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicy, { mode: options.sandboxMode, workspaceRoot: root })
    await ctx.plugin(SandboxedFileSystem, { cwd: root })
  }
  if (options.fsPolicy === true) await ctx.plugin(FsPolicy)
  if (options.shell === true) await ctx.plugin(FakeShell)
  const fiber = await ctx.plugin(ToolApplyPatch, config)
  return {
    ctx,
    root,
    fiber,
    owner: agent(ctx, root),
    shell: options.shell === true ? ctx.shell as unknown as FakeShell : undefined,
  }
}

/** The mounted fake shell; fails the test when the case mounted none. */
function fakeShell(shell: FakeShell | undefined): FakeShell {
  if (shell === undefined) throw new Error('the case did not mount the fake shell')
  return shell
}

describe('apply_patch registration', () => {
  it('registers the envelope schema, presents a generic edit card, and drops both on dispose', async () => {
    const { ctx, root, fiber } = await setup({ description: 'custom patch description' })
    const schema = ctx.tools.schemas()[0]
    expect(ctx.tools.schemas().map(item => item.name)).toEqual(['apply_patch'])
    expect(schema?.description).toBe('custom patch description')
    const parameters = schema?.parameters as {
      properties: Record<string, { type?: string; description?: string }>
      required?: string[]
    }
    expect(parameters.properties.patch?.type).toBe('string')
    expect(parameters.properties.patch?.description).toBe('The complete Codex-style patch envelope.')
    expect(parameters.required).toEqual(['patch'])
    // The envelope is also offered as grammar-constrained freeform input, so a
    // wire with custom tools lets the model write it without JSON escaping.
    expect(schema?.format).toEqual({
      type: 'grammar',
      syntax: 'lark',
      definition: expect.stringContaining('start: begin_patch hunk+ end_patch') as string,
    })

    const patch = envelope(
      `*** Add File: ${join(root, 'added.txt')}`,
      '+one',
      `*** Update File: ${join(root, 'updated.txt')}`,
      '@@',
      ' keep',
      `*** Delete File: ${join(root, 'deleted.txt')}`,
    )
    // The call knows nothing but patch text, so the pending card stays generic
    // and offers the header paths for follow-along instead of a fabricated diff.
    expect(ctx.tools.get('apply_patch')?.presentCall?.({ patch })).toEqual({
      card: 'generic',
      title: 'apply_patch',
      kind: 'edit',
      locations: [
        { path: join(root, 'added.txt') },
        { path: join(root, 'updated.txt') },
        { path: join(root, 'deleted.txt') },
      ],
    })

    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.get('apply_patch')).toBeUndefined()
  })

  it('rejects invalid plugin config', () => {
    expect(() => {
      ToolApplyPatch.apply(new Context(), { detailLimit: 0 })
    }).toThrow('detailLimit must be a positive safe integer')
    expect(() => {
      ToolApplyPatch.apply(new Context(), { detailLimit: 1.5 })
    }).toThrow('detailLimit must be a positive safe integer')
    expect(() => {
      ToolApplyPatch.apply(new Context(), { description: ' ' })
    }).toThrow('description must be non-empty')
  })

  it('drops the grammar presentation when a deployment turns it off', async () => {
    const { ctx } = await setup({ freeform: false })
    expect(ctx.tools.schemas()[0]?.format).toBeUndefined()
  })

  it('reports a missing sandbox policy during plugin startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tool-apply-patch-policy-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    Object.defineProperty(ctx.fs, 'sandboxMode', { value: 'read-only' })

    await expect(ctx.plugin(ToolApplyPatch))
      .rejects.toThrow('the mounted filesystem confines but ctx.sandboxPolicy is missing')
  })
})

describe('apply_patch operations', () => {
  it('creates files with a trailing newline, and an empty one from no body lines', async () => {
    const { ctx, root, owner } = await setup()
    const added = join(root, 'added.txt')
    const empty = join(root, 'empty.txt')
    const result = await call(ctx, owner, envelope(
      `*** Add File: ${added}`,
      '+one',
      '+two',
      `*** Add File: ${empty}`,
    ))
    expect(text(result)).toBe(summary(`A ${added}`, `A ${empty}`))
    expect(await readFile(added, 'utf8')).toBe('one\ntwo\n')
    expect(await readFile(empty, 'utf8')).toBe('')
  })

  it('accepts the envelope as the freeform text a custom-tool wire delivers', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'freeform.txt')
    // A grammar-constrained wire delivers the model's raw text as the call's
    // arguments; the registry turns it into the declared `patch` parameter.
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`apply-patch-freeform-${++sequence}`),
      name: 'apply_patch',
      arguments: envelope(`*** Add File: ${path}`, '+freeform'),
      agent: owner,
    })
    expect(text(result)).toBe(summary(`A ${path}`))
    expect(await readFile(path, 'utf8')).toBe('freeform\n')
  })

  it('overwrites an existing path, the reference implementation\'s add semantics', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'present.txt')
    await writeFile(path, 'original\n')
    const result = await call(ctx, owner, envelope(`*** Add File: ${path}`, '+overwrite'))
    expect(text(result)).toBe(summary(`A ${path}`))
    expect(await readFile(path, 'utf8')).toBe('overwrite\n')
  })

  it('refuses an add whose target is not a regular file', async () => {
    const { ctx, root, owner } = await setup()
    const directory = join(root, 'directory')
    await mkdir(directory)
    const result = await call(ctx, owner, envelope(`*** Add File: ${directory}`, '+x'))
    expect(result.error)
      .toMatchObject({ message: `cannot add ${directory}: not a regular file`, info: { code: 'FS_NOT_REGULAR_FILE' } })
  })

  it('updates a file in place and keeps its CRLF line endings', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'crlf.txt')
    await writeFile(path, 'alpha\r\nbeta\r\ngamma\r\n')
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${path}`,
      '@@',
      ' alpha',
      '-beta',
      '+BETA',
      '+extra',
    ))
    expect(text(result)).toBe(summary(`M ${path}`))
    expect(await readFile(path, 'utf8')).toBe('alpha\r\nBETA\r\nextra\r\ngamma\r\n')
  })

  it('reports an unchanged hunk without writing the file', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'same.txt')
    await writeFile(path, 'one\ntwo\n')
    let writes = 0
    const writeText = ctx.fs.writeText.bind(ctx.fs)
    ctx.fs.writeText = async (...args: Parameters<typeof writeText>) => {
      writes += 1
      return await writeText(...args)
    }
    let observed = 0
    ctx.on('fs/observed', () => {
      observed += 1
    })
    const result = await call(ctx, owner, envelope(`*** Update File: ${path}`, '@@', ' one', ' two'))
    expect(text(result)).toBe(summary(`M ${path}`))
    expect(writes).toBe(0)
    // The read behind the comparison is recorded; no write follows it.
    expect(observed).toBe(1)
    expect(await readFile(path, 'utf8')).toBe('one\ntwo\n')
  })

  it('applies a repeated anchor to its first match, and reports a miss with its diagnostics', async () => {
    const { ctx, root, owner } = await setup()
    const repeated = join(root, 'repeated.txt')
    await writeFile(repeated, 'same\nother\nsame\n')
    // The reference implementation applies to the first run at or after the
    // cursor rather than refusing an ambiguous hunk.
    const applied = await call(ctx, owner, envelope(`*** Update File: ${repeated}`, '@@', '-same', '+edited'))
    expect(text(applied)).toBe(summary(`M ${repeated}`))
    expect(await readFile(repeated, 'utf8')).toBe('edited\nother\nsame\n')

    const absent = await call(ctx, owner, envelope(`*** Update File: ${repeated}`, '@@', '-absent', '+edited'))
    expect(absent.error).toMatchObject({ info: { code: 'FS_EDIT_NOT_FOUND' } })
    expect(text(absent)).toContain(`Failed to find expected lines in ${repeated}:`)
    expect(text(absent)).toContain('did not match (the patch was declined, nothing was written)')
    expect(text(absent)).toContain('  hunk line 1 is not in the file: "absent"')
    expect(await readFile(repeated, 'utf8')).toBe('edited\nother\nsame\n')
  })

  it('refuses to update a missing path or a directory, and appends an unanchored hunk', async () => {
    const { ctx, root, owner } = await setup()
    const directory = join(root, 'directory')
    await mkdir(directory)
    const absent = await call(ctx, owner, envelope(`*** Update File: ${join(root, 'absent.txt')}`, '@@', '-x', '+y'))
    expect(absent.error).toMatchObject({ message: `Failed to update ${join(root, 'absent.txt')}: no such file`, info: { code: 'FS_NOT_REGULAR_FILE' } })
    const onDirectory = await call(ctx, owner, envelope(`*** Update File: ${directory}`, '@@', '-x', '+y'))
    expect(onDirectory.error).toMatchObject({ message: `cannot update ${directory}: not a regular file`, info: { code: 'FS_NOT_REGULAR_FILE' } })
    const unanchoredPath = join(root, 'anchored.txt')
    await writeFile(unanchoredPath, 'content\n')
    const unanchored = await call(ctx, owner, envelope(`*** Update File: ${unanchoredPath}`, '+x'))
    expect(text(unanchored)).toBe(summary(`M ${unanchoredPath}`))
    expect(await readFile(unanchoredPath, 'utf8')).toBe('content\nx\n')
  })

  it('moves a file by creating the destination and removing the source', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const source = join(root, 'source.txt')
    const destination = join(root, 'moved.txt')
    await writeFile(source, 'alpha\nbeta\n')
    const removed = await shellPath(ctx, source)
    const fake = fakeShell(shell)
    fake.onRun = async (spec) => {
      await rm(source, { force: true })
      return succeeded(spec)
    }

    const result = await call(ctx, owner, envelope(
      `*** Update File: ${source}`,
      `*** Move to: ${destination}`,
      '@@',
      '-beta',
      '+BETA',
    ))
    expect(text(result)).toBe(summary(`M ${source}`))
    expect(await readFile(destination, 'utf8')).toBe('alpha\nBETA\n')
    await expect(stat(source)).rejects.toThrow()
    expect(fake.commands).toEqual([deleteCommand(removed, process.platform)])
    expect(fake.requests[0]?.workdir).toBe(root)
  })

  it('overwrites an existing move destination, the reference implementation\'s move semantics', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const source = join(root, 'source.txt')
    const destination = join(root, 'occupied.txt')
    await writeFile(source, 'alpha\n')
    await writeFile(destination, 'other\n')
    const fake = fakeShell(shell)
    fake.onRun = async (spec) => {
      await rm(source, { force: true })
      return succeeded(spec)
    }
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${source}`,
      `*** Move to: ${destination}`,
      '@@',
      '-alpha',
      '+beta',
    ))
    expect(text(result)).toBe(summary(`M ${source}`))
    expect(await readFile(destination, 'utf8')).toBe('beta\n')
    await expect(stat(source)).rejects.toThrow()
  })

  it('deletes a file through the shell and records its absence', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const path = join(root, 'gone.txt')
    const ownerlessPath = join(root, 'ownerless.txt')
    await writeFile(path, 'bye')
    await writeFile(ownerlessPath, 'bye')
    const fake = fakeShell(shell)
    let absences = 0
    ctx.on('fs/observed', (_target, observation) => {
      if (observation.kind === 'absent') absences += 1
    })
    let pending = path
    fake.onRun = async (spec) => {
      await rm(pending, { force: true })
      return succeeded(spec)
    }

    const result = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(text(result)).toBe(summary(`D ${path}`))
    await expect(stat(path)).rejects.toThrow()
    expect(absences).toBe(1)

    // Without an owning agent there is no session cwd, so the command runs in
    // the executor's own working directory.
    pending = ownerlessPath
    const ownerless = await call(ctx, undefined, envelope(`*** Delete File: ${ownerlessPath}`))
    expect(text(ownerless)).toBe(summary(`D ${ownerlessPath}`))
    expect(Object.hasOwn(fake.requests[1] as object, 'workdir')).toBe(false)
    await expect(stat(ownerlessPath)).rejects.toThrow()
  })

  it('refuses a delete of a missing path', async () => {
    const { ctx, root, owner } = await setup({}, { shell: true })
    const path = join(root, 'absent.txt')
    const result = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(result.error).toMatchObject({ message: `Failed to remove ${path}: no such file`, info: { code: 'FS_NOT_FOUND' } })
    await expect(stat(path)).rejects.toThrow()
  })

  it('refuses a delete of a path that is not a regular file', async () => {
    const { ctx, root, owner } = await setup({}, { shell: true })
    const directory = join(root, 'directory')
    await mkdir(directory)
    const result = await call(ctx, owner, envelope(`*** Delete File: ${directory}`))
    expect(result.error).toMatchObject({
      message: `Failed to remove ${directory}: not a regular file`,
      info: { code: 'FS_NOT_REGULAR_FILE' },
    })
    expect((await stat(directory)).isDirectory()).toBe(true)
  })

  it('reports a failed delete, and the marker of a sandbox-denied one', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const path = join(root, 'file.txt')
    await writeFile(path, 'x')
    const fake = fakeShell(shell)

    fake.onRun = spec => ({ ...succeeded(spec), exitCode: 2, stderr: { text: 'rm: denied', truncated: false } })
    const failed = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(failed.error).toMatchObject({ message: `apply_patch: cannot delete ${path}: rm: denied`, info: { code: 'FS_IO_ERROR' } })
    expect(await readFile(path, 'utf8')).toBe('x')

    fake.onRun = spec => ({ ...succeeded(spec), exitCode: 3 })
    const silent = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(silent.error).toMatchObject({ message: `apply_patch: cannot delete ${path}: the delete command exited with code 3` })

    fake.onRun = spec => ({ ...succeeded(spec), sandbox: { mode: 'read-only', denied: true } })
    const denied = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(denied.error).toMatchObject({ message: '[sandbox: file access denied under read-only mode]', info: { code: 'FS_SANDBOX_DENIED' } })
    expect(await readFile(path, 'utf8')).toBe('x')
  })

  it('fails loudly when the composition mounts no shell service', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'file.txt')
    await writeFile(path, 'x')
    const result = await call(ctx, owner, envelope(`*** Delete File: ${path}`))
    expect(result.error).toMatchObject({ message: 'tool-apply-patch: this composition mounts no shell service (ctx.shell), which removing a path requires' })
    expect(await readFile(path, 'utf8')).toBe('x')
  })

  it('writes nothing when a later operation of the patch fails', async () => {
    const { ctx, root, owner } = await setup()
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    await writeFile(first, 'original\n')
    await writeFile(second, 'other\n')
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${first}`,
      '@@',
      '-original',
      '+changed',
      `*** Update File: ${second}`,
      '@@',
      '-nothing like this line',
      '+x',
    ))
    expect(result.error).toMatchObject({ info: { code: 'FS_EDIT_NOT_FOUND' } })
    expect(await readFile(first, 'utf8')).toBe('original\n')
    expect(await readFile(second, 'utf8')).toBe('other\n')

    const created = join(root, 'created.txt')
    const blocked = join(root, 'blocked')
    await mkdir(blocked)
    const adds = await call(ctx, owner, envelope(`*** Add File: ${created}`, '+new', `*** Add File: ${blocked}`, '+x'))
    expect(adds.error).toMatchObject({ info: { code: 'FS_NOT_REGULAR_FILE' } })
    await expect(stat(created)).rejects.toThrow()
  })

  it('applies two operations on one path in patch order', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'staged.txt')
    const result = await call(ctx, owner, envelope(
      `*** Add File: ${path}`,
      '+created',
      `*** Update File: ${path}`,
      '@@',
      '-created',
      '+updated',
    ))
    expect(text(result)).toBe(summary(`A ${path}`, `M ${path}`))
    expect(await readFile(path, 'utf8')).toBe('updated\n')
  })

  it('replaces a file by deleting and re-adding it in one patch', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const path = join(root, 'replaced.txt')
    await writeFile(path, 'original\n')
    const fake = fakeShell(shell)
    fake.onRun = async (spec) => {
      await rm(path, { force: true })
      return succeeded(spec)
    }
    const result = await call(ctx, owner, envelope(
      `*** Delete File: ${path}`,
      `*** Add File: ${path}`,
      '+replacement',
    ))
    expect(text(result)).toBe(summary(`A ${path}`, `D ${path}`))
    expect(await readFile(path, 'utf8')).toBe('replacement\n')
  })

  it('refuses a patch with no operation, an empty path, or a malformed envelope', async () => {
    const { ctx, owner } = await setup()
    expect(text(await call(ctx, owner, envelope()))).toContain('No files were modified.')
    expect(text(await call(ctx, owner, envelope('*** Add File: ', '+x'))))
      .toContain('unexpected patch line: "*** Add File: "')
    expect(text(await call(ctx, owner, 'not a patch'))).toContain('patch must start with `*** Begin Patch`')
    expect(text(await call(ctx, owner, envelope('*** Update File: relative.txt', '@@', 'no prefix'))))
      .toContain('invalid update line: "no prefix"')
  })

  it('refuses an update of a path the same patch deletes', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'victim.txt')
    await writeFile(path, 'content\n')
    const result = await call(ctx, owner, envelope(
      `*** Delete File: ${path}`,
      `*** Update File: ${path}`,
      '@@',
      '-content',
      '+changed',
    ))
    expect(result.error)
      .toMatchObject({ message: `Failed to update ${path}: no such file`, info: { code: 'FS_NOT_REGULAR_FILE' } })
    expect(await readFile(path, 'utf8')).toBe('content\n')
  })

  it('overwrites a path that appears between the preflight and the commit', async () => {
    const { ctx, root, owner } = await setup()
    const first = join(root, 'first.txt')
    const appeared = join(root, 'appeared.txt')
    await writeFile(first, 'one\n')
    onceBeforeCommit(ctx, () => {
      writeFileSync(appeared, 'appeared\n')
    })
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${first}`,
      '@@',
      '-one',
      '+two',
      `*** Add File: ${appeared}`,
      '+content',
    ))
    // The commit pass reads what it is about to replace, so the reference
    // add-over-existing semantics still hold against a racing writer.
    expect(text(result)).toBe(summary(`A ${appeared}`, `M ${first}`))
    expect(await readFile(appeared, 'utf8')).toBe('content\n')
  })

  it('stops the commit pass when a delete path disappears under it', async () => {
    const { ctx, root, owner } = await setup({}, { shell: true })
    const trigger = join(root, 'trigger.txt')
    const gone = join(root, 'gone.txt')
    await writeFile(trigger, 'content\n')
    await writeFile(gone, 'bye\n')
    onceBeforeCommit(ctx, () => {
      rmSync(gone)
    })
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${trigger}`,
      '@@',
      ' content',
      `*** Delete File: ${gone}`,
    ))
    expect(result.error).toMatchObject({ message: `Failed to remove ${gone}: no such file`, info: { code: 'FS_NOT_FOUND' } })
    expect(await readFile(trigger, 'utf8')).toBe('content\n')
  })

  it('overwrites a move destination that appears between the preflight and the commit', async () => {
    const { ctx, root, owner, shell } = await setup({}, { shell: true })
    const source = join(root, 'source.txt')
    const destination = join(root, 'destination.txt')
    await writeFile(source, 'alpha\n')
    onceBeforeCommit(ctx, () => {
      writeFileSync(destination, 'occupied\n')
    })
    const fake = fakeShell(shell)
    fake.onRun = async (spec) => {
      await rm(source, { force: true })
      return succeeded(spec)
    }
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${source}`,
      `*** Move to: ${destination}`,
      '@@',
      '-alpha',
      '+beta',
    ))
    expect(text(result)).toBe(summary(`M ${source}`))
    expect(await readFile(destination, 'utf8')).toBe('beta\n')
    await expect(stat(source)).rejects.toThrow()
  })

  it('stops the commit pass when an update path disappears under it', async () => {
    const { ctx, root, owner } = await setup()
    const trigger = join(root, 'trigger.txt')
    const victim = join(root, 'victim.txt')
    await writeFile(trigger, 'content\n')
    await writeFile(victim, 'content\n')
    onceBeforeCommit(ctx, () => {
      rmSync(victim)
    })
    const result = await call(ctx, owner, envelope(
      `*** Update File: ${trigger}`,
      '@@',
      ' content',
      `*** Update File: ${victim}`,
      '@@',
      '-content',
      '+changed',
    ))
    expect(result.error)
      .toMatchObject({ message: `Failed to update ${victim}: not a regular file`, info: { code: 'FS_NOT_REGULAR_FILE' } })
    await expect(stat(victim)).rejects.toThrow()
    expect(await readFile(trigger, 'utf8')).toBe('content\n')
  })

  it('resolves relative paths against the session workspace, and against the provider without an agent', async () => {    const { ctx, root, owner } = await setup()
    const owned = await call(ctx, owner, envelope('*** Add File: owned.txt', '+one'))
    expect(text(owned)).toBe(summary(`A ${join(root, 'owned.txt')}`))
    expect(await readFile(join(root, 'owned.txt'), 'utf8')).toBe('one\n')

    const ownerless = await call(ctx, undefined, envelope('*** Add File: ownerless.txt', '+two'))
    expect(ownerless.isError).toBe(false)
    expect(await readFile(join(root, 'ownerless.txt'), 'utf8')).toBe('two\n')
  })
})

describe('apply_patch service seams', () => {
  it('satisfies the mounted observation policy and records what it read', async () => {
    const { ctx, root, owner } = await setup({}, { fsPolicy: true })
    const path = join(root, 'guarded.txt')
    await writeFile(path, 'original\n')
    const created = await call(ctx, owner, envelope(`*** Add File: ${join(root, 'new.txt')}`, '+hello'))
    expect(text(created)).toBe(summary(`A ${join(root, 'new.txt')}`))

    const updated = await call(ctx, owner, envelope(`*** Update File: ${path}`, '@@', '-original', '+changed'))
    expect(text(updated)).toBe(summary(`M ${path}`))
    expect(await readFile(path, 'utf8')).toBe('changed\n')

    // The update's own read is the observation that authorizes edits, so the
    // same target passes the policy's edit gate immediately afterwards.
    const target = await ctx.fs.resolve(path)
    await expect(ctx.waterfall('fs/edit-intent', target, { agent: owner }, () => undefined))
      .resolves.toEqual({ version: expect.anything() })
  })

  it('uses the version an edit-intent listener supplies, and the read version when it declines', async () => {
    const { ctx, root, owner } = await setup()
    const path = join(root, 'guarded.txt')
    await writeFile(path, 'one\n')
    await ctx.plugin(editGuard(FsVersion('stale-version')))
    const stale = await call(ctx, owner, envelope(`*** Update File: ${path}`, '@@', '-one', '+two'))
    expect(stale.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(path, 'utf8')).toBe('one\n')

    const unguarded = await setup()
    const unguardedPath = join(unguarded.root, 'guarded.txt')
    await writeFile(unguardedPath, 'one\n')
    await unguarded.ctx.plugin(editGuard(undefined))
    const applied = await call(unguarded.ctx, unguarded.owner, envelope(`*** Update File: ${unguardedPath}`, '@@', '-one', '+two'))
    expect(text(applied)).toBe(summary(`M ${unguardedPath}`))
    expect(await readFile(unguardedPath, 'utf8')).toBe('two\n')
  })

  it('fences every mutation with the session sandbox policy', async () => {
    const { ctx, root, owner, shell } = await setup({}, { sandboxMode: 'read-only', shell: true })
    const blocked = join(root, 'blocked.txt')
    const denied = await call(ctx, owner, envelope(`*** Add File: ${blocked}`, '+blocked'))
    expect(denied.error).toMatchObject({ message: '[sandbox: file access denied under read-only mode]', info: { code: 'FS_SANDBOX_DENIED' } })
    await expect(stat(blocked)).rejects.toThrow()

    // A call with no owning agent carries no session, so the policy resolves
    // its deployment default instead of a session override.
    const ownerless = await call(ctx, undefined, envelope(`*** Add File: ${join(root, 'ownerless.txt')}`, '+blocked'))
    expect(ownerless.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })

    const existing = join(root, 'existing.txt')
    await writeFile(existing, 'x')
    const fake = fakeShell(shell)
    fake.onRun = spec => ({ ...succeeded(spec), sandbox: { mode: 'read-only', denied: true } })
    const removal = await call(ctx, owner, envelope(`*** Delete File: ${existing}`))
    expect(removal.error).toMatchObject({ info: { code: 'FS_SANDBOX_DENIED' } })
    // The session's mode reaches the shell command too, not only the writes.
    expect(fake.requests[0]?.sandboxPolicy?.mode).toBe('read-only')
    expect(await readFile(existing, 'utf8')).toBe('x')
  })

  it('passes an unexpected backend failure through unchanged', async () => {
    const { ctx, root, owner } = await setup()
    ctx.fs.writeText = async () => {
      throw new Error('backend write failed')
    }
    const result = await call(ctx, owner, envelope(`*** Add File: ${join(root, 'failed.txt')}`, '+x'))
    expect(result.error).toMatchObject({ message: 'backend write failed' })
  })
})

describe('deleteCommand', () => {
  it('quotes the path for the shell of each platform', () => {
    expect(deleteCommand('/tmp/plain.txt', 'linux')).toBe("rm -f -- '/tmp/plain.txt'")
    expect(deleteCommand("/tmp/it's here.txt", 'darwin')).toBe("rm -f -- '/tmp/it'\"'\"'s here.txt'")
    expect(deleteCommand("C:\\work\\it's here.txt", 'win32')).toBe("Remove-Item -LiteralPath 'C:\\work\\it''s here.txt' -Force")
  })
})
