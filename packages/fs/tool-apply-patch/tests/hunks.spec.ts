import { describe, expect, it } from 'vitest'
import { FsError } from '@deepseek-ai/dsh-fs'
import { applyHunks } from '../src/hunks.ts'
import type { PatchHunk } from '../src/patch.ts'

/**
 * One hunk as the parser builds it. `added` is the parser's count of `+` lines,
 * which the miss explanation reads to tell a re-sent hunk from a pure deletion;
 * `contextPairs` locates the lines the parser saw on both sides.
 */
function hunk(
  oldLines: readonly string[],
  newLines: readonly string[] = oldLines,
  options: {
    added?: number
    context?: string
    endOfFile?: boolean
    contextPairs?: Array<[number, number]>
  } = {},
): PatchHunk {
  return {
    context: options.context,
    oldLines: [...oldLines],
    newLines: [...newLines],
    contextPairs: options.contextPairs ?? [],
    endOfFile: options.endOfFile ?? false,
    added: options.added ?? 0,
  }
}

/** The message and code of the failure one hunk application produced. */
function rejection(content: string, hunks: readonly PatchHunk[], detailLimit = 3): { message: string; code: string } {
  try {
    applyHunks(content, hunks, 'file.txt', detailLimit)
  } catch (error) {
    if (error instanceof FsError) return { message: error.message, code: error.code }
    throw error
  }
  throw new Error('applyHunks accepted a patch it should have declined')
}

const DECLINED = 'the patch was declined, nothing was written'

describe('applyHunks', () => {
  it('replaces the matched run with the hunk body', () => {
    expect(applyHunks('a\nb\nc\n', [hunk(['b'], ['B'])], 'file.txt', 3)).toBe('a\nB\nc\n')
    // The body replaces the matched run exactly: a shorter body shrinks the
    // file and a longer one grows it.
    expect(applyHunks('a\nb\nc\n', [hunk(['b', 'c'], ['B'])], 'file.txt', 3)).toBe('a\nB\n')
    expect(applyHunks('a\nb\nc\n', [hunk(['a', 'b'], ['a', 'B', 'c'])], 'file.txt', 3)).toBe('a\nB\nc\nc\n')
    expect(applyHunks('a\nb\nc\n', [hunk(['b'])], 'file.txt', 3)).toBe('a\nb\nc\n')
  })

  it('appends a hunk that carries no context or removed line', () => {
    // The reference implementation treats a body of only `+` lines as an
    // insertion at the end of the file.
    expect(applyHunks('line1\nline2\n', [hunk([], ['added line 1', 'added line 2'], { added: 2 })], 'file.txt', 3))
      .toBe('line1\nline2\nadded line 1\nadded line 2\n')
    expect(applyHunks('', [hunk([], ['only'], { added: 1 })], 'file.txt', 3)).toBe('only\n')
  })

  it('searches each hunk from the end of the previous one', () => {
    expect(applyHunks('a\nb\nc\nd\n', [hunk(['b'], ['B']), hunk(['c'], ['C'])], 'file.txt', 3))
      .toBe('a\nB\nC\nd\n')
    // The cursor only moves forward, so a later hunk cannot reach back.
    expect(rejection('a\nb\nc\n', [hunk(['b'], ['B']), hunk(['a'], ['A'])]).code).toBe('FS_EDIT_NOT_FOUND')
  })

  it('keeps the first match when the anchor text occurs more than once', () => {
    // The reference implementation applies to the first run at or after the
    // cursor instead of refusing an ambiguous hunk.
    expect(applyHunks('a\na\n', [hunk(['a'], ['A'])], 'file.txt', 3)).toBe('A\na\n')
    expect(applyHunks('a\nb\na\nb\n', [hunk(['a', 'b'], ['A', 'B'])], 'file.txt', 3))
      .toBe('A\nB\na\nb\n')
  })

  it('matches with the reference leniency: trailing, then leading, then typographic', () => {
    // Trailing whitespace the file carries but the hunk omits.
    expect(applyHunks('foo   \nbar\t\n', [hunk(['foo', 'bar'], ['foo', 'BAR'])], 'file.txt', 3))
      .toBe('foo\nBAR\n')
    // Leading whitespace, and context lines whose own text survives verbatim.
    expect(applyHunks('    foo   \n   bar\t\n', [hunk(['foo', 'bar'], ['foo', 'BAR'], {
      contextPairs: [[0, 0]],
    })], 'file.txt', 3)).toBe('    foo   \nBAR\n')
    // Typographic punctuation in the file against plain ASCII in the hunk.
    expect(applyHunks('const x = "a\u2014b";\n', [hunk(['const x = "a-b";'], ['const y = "a-b";'])], 'file.txt', 3))
      .toBe('const y = "a-b";\n')
  })

  it('keeps CRLF terminators for inserted lines and untouched lines', () => {
    expect(applyHunks('a\r\nb\r\nc\r\n', [hunk(['b'], ['B', 'B2'])], 'file.txt', 3))
      .toBe('a\r\nB\r\nB2\r\nc\r\n')
  })

  it('gives inserted lines the file\'s first terminator in a mixed file', () => {
    expect(applyHunks('a\r\nb\nc\r', [hunk(['b'], ['B'])], 'file.txt', 3)).toBe('a\r\nB\r\nc\r')
    expect(applyHunks('a\r\nb\n', [hunk(['a'], ['A'])], 'file.txt', 3)).toBe('A\r\nb\n')
  })

  it('ends the file with a terminator after an update', () => {
    // The reference implementation has always added the trailing newline an
    // update produces, including for a final line that had none.
    expect(applyHunks('a\nb', [hunk(['b'], ['B'])], 'file.txt', 3)).toBe('a\nB\n')
    expect(applyHunks('a\nb', [hunk(['b'], ['B', 'c'])], 'file.txt', 3)).toBe('a\nB\nc\n')
  })

  it('honors a hunk that declares the end of the file', () => {
    // Without the marker the first match wins; with it the search starts at the
    // file's end, which is what `*** End of File` is for.
    expect(applyHunks('first\nsecond\nsecond\n', [hunk(['second'], ['SECOND'])], 'file.txt', 3))
      .toBe('first\nSECOND\nsecond\n')
    expect(applyHunks('first\nsecond\nsecond\n', [hunk(['second'], ['SECOND'], { endOfFile: true })], 'file.txt', 3))
      .toBe('first\nsecond\nSECOND\n')
  })

  it('moves the search past the line a change-context label names', () => {
    expect(applyHunks('def f():\n  pass\ndef g():\n  pass\n', [
      hunk(['  pass'], ['  return 1'], { context: 'def g():' }),
    ], 'file.txt', 3)).toBe('def f():\n  pass\ndef g():\n  return 1\n')
    expect(rejection('def f():\n  pass\n', [hunk(['  pass'], ['  return 1'], { context: 'def g():' })]))
      .toEqual({
        message: 'Failed to find context "def g():" in file.txt',
        code: 'FS_EDIT_NOT_FOUND',
      })
  })

  it('names the hunk, the expected lines, and the nearest lines it did not find', () => {
    expect(rejection('alpha\nbeta\ngamma\n', [hunk(['alpha', 'delta'], ['alpha', 'DELTA'])])).toEqual({
      message: [
        'Failed to find expected lines in file.txt:',
        'alpha',
        'delta',
        `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
        '  hunk line 2 is not in the file: "delta"',
        '    nearest is line 1: "alpha"',
        '  the block came closest at line 1, where 1 of 2 hunk lines match exactly',
      ].join('\n'),
      code: 'FS_EDIT_NOT_FOUND',
    })
  })

  it('never matches inside a longer line and refuses the hunk by name', () => {
    const content = 'alpha\nbeta gamma\n'
    expect(rejection(content, [hunk(['beta'], ['BETA'])])).toEqual({
      message: [
        'Failed to find expected lines in file.txt:',
        'beta',
        `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
        '  hunk line 1 is not a whole line, though line 2 contains it: "beta gamma"',
      ].join('\n'),
      code: 'FS_EDIT_NOT_FOUND',
    })
  })

  it('prefers the closest position when two starts match the same number of lines', () => {
    // Start 1 wins on shared characters alone: both starts match exactly one
    // hunk line, and start 1 shares more of both lines.
    expect(rejection('abcdef\nabcdefxy\nuvwxyz\n', [hunk(['abcdef', 'uvwxyz'])]).message).toBe([
      'Failed to find expected lines in file.txt:',
      'abcdef',
      'uvwxyz',
      `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
      '  every hunk line is in the file on its own, but never as one block',
      '  the block came closest at line 2, where 1 of 2 hunk lines match exactly',
    ].join('\n'))
  })

  it('prints the shared prefix when the nearest line starts the same way', () => {
    expect(rejection('alpha\nalpha one\n', [hunk(['alpha two'])]).message).toBe([
      'Failed to find expected lines in file.txt:',
      'alpha two',
      `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
      '  hunk line 1 is not in the file: "alpha two"',
      '    nearest is line 2: "alpha one" (both start with the same 6 characters)',
    ].join('\n'))
  })

  it('counts the hunk lines it did not print', () => {
    expect(rejection('a\nb\n', [hunk(['x', 'y', 'z', 'w'])], 1).message).toBe([
      'Failed to find expected lines in file.txt:',
      'x',
      'y',
      'z',
      'w',
      `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
      '  hunk line 1 is not in the file: "x"',
      '    nearest is line 1: "a"',
      '  ... and 3 more hunk lines the file does not have',
    ].join('\n'))
  })

  it('reports a miss against an empty file without a nearest line', () => {
    expect(rejection('', [hunk(['x', 'y'])]).message).toBe([
      'Failed to find expected lines in file.txt:',
      'x',
      'y',
      `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
      '  hunk line 1 is not in the file: "x"',
      '  hunk line 2 is not in the file: "y"',
    ].join('\n'))
  })

  it('hints that a hunk whose result is already present may be applied', () => {
    expect(rejection('a\nb\nc\n', [hunk(['x', 'b'], ['b', 'c'], { added: 2 })]).message).toBe([
      'Failed to find expected lines in file.txt:',
      'x',
      'b',
      `apply_patch: hunk 1 of 1 in file.txt did not match (${DECLINED})`,
      '  hunk line 1 is not in the file: "x"',
      '    nearest is line 1: "a"',
      '  the block came closest at line 1, where 1 of 2 hunk lines match exactly',
      "  hint: this hunk's added lines are already in the file at line 2, so it may already be applied",
    ].join('\n'))
    expect(rejection('b\nc\nb\nc\n', [hunk(['q', 'b'], ['b', 'c'], { added: 2 })]).message)
      .toContain("hint: this hunk's added lines are already in the file at 2 places, the first at line 1")
    expect(rejection('b\nx\nc\n', [hunk(['q', 'b'], ['b', 'c'], { added: 2 })]).message)
      .toContain('hint: every line this hunk would write is already in the file, so it may already be applied')
  })

  it('names the failing hunk when a block carries several', () => {
    expect(rejection('a\n', [hunk(['a'], ['A']), hunk(['zz'], ['ZZ'])], 3).message)
      .toContain('apply_patch: hunk 2 of 2 in file.txt did not match')
  })
})
