/**
 * The Codex patch envelope: the block headers, body-line prefixes, and closing
 * marker `apply_patch` accepts, and the operations a patch text declares.
 * Parsing is textual and follows the reference implementation's leniency: the
 * envelope's first and last lines are compared trimmed, block headers are read
 * from the trimmed line, an update hunk may carry a `@@ <text>` label, and a
 * blank line inside an update block is an empty context line.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/patch
 */

/** One update hunk: the whole lines it anchors on and the whole lines it writes. */
export interface PatchHunk {
  /** `@@ <text>` label the search continues after, or undefined for a plain `@@`. */
  context: string | undefined
  /** Context and removed lines, in patch order — the contiguous run the hunk anchors on. */
  oldLines: string[]
  /** Context and added lines, in patch order — what that run is replaced by. */
  newLines: string[]
  /** Index pairs locating each context line in {@link PatchHunk.oldLines} and {@link PatchHunk.newLines}. */
  contextPairs: Array<[number, number]>
  /** True when the hunk declared `*** End of File`, anchoring its search at the file's end. */
  endOfFile: boolean
  /** Count of `+` lines, which separates an already-applied hunk from a pure deletion when a miss is explained. */
  added: number
}

/** An `*** Add File: ` block: the complete content of a path, overwritten when it already exists. */
export interface AddOperation {
  kind: 'add'
  /** The trimmed header remainder, resolved by the filesystem backend. */
  path: string
  /** Body lines without their `+`, in patch order; no lines means an empty file. */
  lines: string[]
}

/** An `*** Update File: ` block: hunks applied in patch order, optionally moving the file afterwards. */
export interface UpdateOperation {
  kind: 'update'
  /** The trimmed header remainder, resolved by the filesystem backend. */
  path: string
  /** Destination of the block's `*** Move to: ` line, or undefined when the block moves nothing. */
  moveTo: string | undefined
  hunks: PatchHunk[]
}

/** A `*** Delete File: ` block; the block accepts no body lines. */
export interface DeleteOperation {
  kind: 'delete'
  /** The trimmed header remainder, resolved by the filesystem backend. */
  path: string
}

/** One operation of a patch, tagged by {@link PatchOperation.kind}. */
export type PatchOperation = AddOperation | UpdateOperation | DeleteOperation

const BEGIN_PATCH = '*** Begin Patch'
const END_PATCH = '*** End Patch'
const ADD_FILE = '*** Add File: '
const UPDATE_FILE = '*** Update File: '
const DELETE_FILE = '*** Delete File: '
const MOVE_TO = '*** Move to: '
const END_OF_FILE = '*** End of File'
const HUNK_MARKER = '@@'
const CHANGE_CONTEXT = '@@ '

/** An empty hunk; body lines fill {@link PatchHunk.oldLines}/{@link PatchHunk.newLines} in patch order. */
function newHunk(): PatchHunk {
  return { context: undefined, oldLines: [], newLines: [], contextPairs: [], endOfFile: false, added: 0 }
}

/** The patch text split into lines; the CRLF and lone-CR terminators become `\n` first. */
function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/**
 * Parse one patch envelope into its operations, in patch order.
 *
 * A block header is recognized in any state, so the next header closes an open
 * block instead of rejecting it; `*** Move to: ` is read only before the update
 * block's first hunk, and `*** End of File` closes the hunk it follows.
 * Everything after the closing line must be blank.
 * @param patch - the complete envelope text; CRLF and lone CR terminators are normalized to LF first.
 * @returns the operations the envelope declares, in patch order.
 * @throws Error when a line does not fit the envelope, a hunk is empty, or the closing line is missing.
 */
export function parsePatch(patch: string): PatchOperation[] {
  const lines = normalizeLines(patch.trim())
  if ((lines[0] as string).trim() !== BEGIN_PATCH) {
    throw new Error('patch must start with `*** Begin Patch`')
  }
  const operations: PatchOperation[] = []
  let current: PatchOperation | undefined
  /** The hunk still receiving body lines, with the update block that owns it. */
  let open: { operation: UpdateOperation; hunk: PatchHunk } | undefined

  const closeHunk = (): void => {
    if (open === undefined) return
    if (open.hunk.oldLines.length === 0 && open.hunk.newLines.length === 0) {
      throw new Error('an update hunk cannot be empty')
    }
    open.operation.hunks.push(open.hunk)
    open = undefined
  }
  const startBlock = (operation: PatchOperation): void => {
    closeHunk()
    if (current !== undefined) operations.push(current)
    current = operation
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    const trimmed = line.trim()
    if (trimmed === END_PATCH) {
      closeHunk()
      if (current !== undefined) operations.push(current)
      if (index !== lines.length - 1 && lines.slice(index + 1).some(item => item.trim() !== '')) {
        throw new Error('unexpected content after `*** End Patch`')
      }
      return operations
    }
    if (trimmed.startsWith(ADD_FILE)) {
      startBlock({ kind: 'add', path: trimmed.slice(ADD_FILE.length).trim(), lines: [] })
      continue
    }
    if (trimmed.startsWith(UPDATE_FILE)) {
      startBlock({ kind: 'update', path: trimmed.slice(UPDATE_FILE.length).trim(), moveTo: undefined, hunks: [] })
      continue
    }
    if (trimmed.startsWith(DELETE_FILE)) {
      startBlock({ kind: 'delete', path: trimmed.slice(DELETE_FILE.length).trim() })
      continue
    }
    if (current === undefined) throw new Error(`unexpected patch line: ${JSON.stringify(line)}`)
    if (current.kind === 'add') {
      if (!line.startsWith('+')) throw new Error(`add-file lines must start with '+': ${JSON.stringify(line)}`)
      current.lines.push(line.slice(1))
      continue
    }
    if (current.kind === 'update') {
      if (trimmed.startsWith(MOVE_TO)) {
        // The reference parser reads the move line only before the block's first hunk.
        if (open !== undefined || current.hunks.length > 0 || current.moveTo !== undefined) {
          throw new Error(`unexpected line in an update hunk: ${JSON.stringify(line)}`)
        }
        current.moveTo = trimmed.slice(MOVE_TO.length).trim()
        continue
      }
      if (trimmed === END_OF_FILE) {
        open ??= { operation: current, hunk: newHunk() }
        if (open.hunk.oldLines.length === 0 && open.hunk.newLines.length === 0) {
          throw new Error('an update hunk cannot be empty')
        }
        open.hunk.endOfFile = true
        continue
      }
      if (trimmed === HUNK_MARKER || trimmed.startsWith(CHANGE_CONTEXT)) {
        closeHunk()
        const hunk = newHunk()
        if (trimmed.startsWith(CHANGE_CONTEXT)) hunk.context = trimmed.slice(CHANGE_CONTEXT.length)
        open = { operation: current, hunk }
        continue
      }
      open ??= { operation: current, hunk: newHunk() }
      if (line === '') {
        open.hunk.contextPairs.push([open.hunk.oldLines.length, open.hunk.newLines.length])
        open.hunk.oldLines.push('')
        open.hunk.newLines.push('')
      } else if (line.startsWith(' ')) {
        open.hunk.contextPairs.push([open.hunk.oldLines.length, open.hunk.newLines.length])
        open.hunk.oldLines.push(line.slice(1))
        open.hunk.newLines.push(line.slice(1))
      } else if (line.startsWith('-')) {
        open.hunk.oldLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        open.hunk.newLines.push(line.slice(1))
        open.hunk.added += 1
      } else {
        throw new Error(`invalid update line: ${JSON.stringify(line)}`)
      }
      continue
    }
    throw new Error(`unexpected line under ${current.kind}: ${JSON.stringify(line)}`)
  }
  throw new Error('patch is missing `*** End Patch`')
}
