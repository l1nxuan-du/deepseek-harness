import { describe, expect, it } from 'vitest'
import { parsePatch } from '../src/patch.ts'

/** Join patch lines into one envelope. */
function envelope(lines: readonly string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

describe('parsePatch', () => {
  it('reads add, update, and delete blocks in patch order', () => {
    expect(parsePatch(envelope([
      '*** Add File: a.txt',
      '+one',
      '+two',
      '*** Update File: b.txt',
      '*** Move to: c.txt',
      '@@',
      ' keep',
      '-old',
      '+new',
      '*** Delete File: d.txt',
    ]))).toEqual([
      { kind: 'add', path: 'a.txt', lines: ['one', 'two'] },
      {
        kind: 'update',
        path: 'b.txt',
        moveTo: 'c.txt',
        hunks: [{
          context: undefined,
          oldLines: ['keep', 'old'],
          newLines: ['keep', 'new'],
          contextPairs: [[0, 0]],
          endOfFile: false,
          added: 1,
        }],
      },
      { kind: 'delete', path: 'd.txt' },
    ])
  })

  it('normalizes CRLF and lone CR, and accepts padded envelope markers', () => {
    expect(parsePatch('  *** Begin Patch  \r\n*** Add File: a.txt\r\n+one\r\n*** End Patch'))
      .toEqual([{ kind: 'add', path: 'a.txt', lines: ['one'] }])
    expect(parsePatch('*** Begin Patch\r*** Add File: a.txt\r+x\r*** End Patch'))
      .toEqual([{ kind: 'add', path: 'a.txt', lines: ['x'] }])
    expect(parsePatch('*** Begin Patch \n*** Add File: a.txt\n+x\n *** End Patch'))
      .toEqual([{ kind: 'add', path: 'a.txt', lines: ['x'] }])
    expect(parsePatch('*** Begin Patch\n  *** Update File: a.txt\n@@\n-one\n+two\n*** End Patch'))
      .toEqual([{
        kind: 'update',
        path: 'a.txt',
        moveTo: undefined,
        hunks: [{
          context: undefined,
          oldLines: ['one'],
          newLines: ['two'],
          contextPairs: [],
          endOfFile: false,
          added: 1,
        }],
      }])
  })

  it('trims a header path and reads one move destination before the hunks', () => {
    const operations = parsePatch(envelope([
      '*** Update File:   spaced.txt  ',
      '*** Move to:  moved.txt  ',
      '@@',
      ' one',
      '+two',
    ]))
    expect(operations).toEqual([{
      kind: 'update',
      path: 'spaced.txt',
      moveTo: 'moved.txt',
      hunks: [{
        context: undefined,
        oldLines: ['one'],
        newLines: ['one', 'two'],
        contextPairs: [[0, 0]],
        endOfFile: false,
        added: 1,
      }],
    }])
    // The reference parser reads the move line only before the block's first hunk.
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '@@', '-one', '+two', '*** Move to: b.txt'])))
      .toThrow('unexpected line in an update hunk: "*** Move to: b.txt"')
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '*** Move to: b.txt', '*** Move to: c.txt'])))
      .toThrow('unexpected line in an update hunk: "*** Move to: c.txt"')
  })

  it('rejects a header whose marker carries no path', () => {
    // The marker includes its trailing space, so a header stripped of its path
    // no longer names a block at all.
    expect(() => parsePatch(envelope(['*** Add File: '])))
      .toThrow('unexpected patch line: "*** Add File: "')
  })

  it('opens a hunk lazily and reads a change-context label', () => {
    expect(parsePatch(envelope([
      '*** Update File: a.txt',
      ' one',
      '@@ function keep() {',
      ' two',
    ]))).toEqual([{
      kind: 'update',
      path: 'a.txt',
      moveTo: undefined,
      hunks: [
        { context: undefined, oldLines: ['one'], newLines: ['one'], contextPairs: [[0, 0]], endOfFile: false, added: 0 },
        {
          context: 'function keep() {',
          oldLines: ['two'],
          newLines: ['two'],
          contextPairs: [[0, 0]],
          endOfFile: false,
          added: 0,
        },
      ],
    }])
  })

  it('marks the hunk a `*** End of File` line follows', () => {
    const operations = parsePatch(envelope([
      '*** Update File: a.txt',
      '@@',
      ' first',
      '-second',
      '+second updated',
      '*** End of File',
    ]))
    expect(operations).toEqual([{
      kind: 'update',
      path: 'a.txt',
      moveTo: undefined,
      hunks: [{
        context: undefined,
        oldLines: ['first', 'second'],
        newLines: ['first', 'second updated'],
        contextPairs: [[0, 0]],
        endOfFile: true,
        added: 1,
      }],
    }])
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '@@', '*** End of File'])))
      .toThrow('an update hunk cannot be empty')
  })

  it('reads a blank line inside an update block as an empty context line', () => {
    expect(parsePatch(envelope([
      '*** Update File: a.txt',
      '@@',
      ' one',
      '',
      '+two',
    ]))).toEqual([{
      kind: 'update',
      path: 'a.txt',
      moveTo: undefined,
      hunks: [{
        context: undefined,
        oldLines: ['one', ''],
        newLines: ['one', '', 'two'],
        contextPairs: [[0, 0], [1, 1]],
        endOfFile: false,
        added: 1,
      }],
    }])
  })

  it('accepts blank lines after the closing marker and nothing else', () => {
    expect(parsePatch('*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\n\n  \n'))
      .toEqual([{ kind: 'add', path: 'a.txt', lines: ['x'] }])
    expect(() => parsePatch('*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\ntrailing'))
      .toThrow('unexpected content after `*** End Patch`')
  })

  it('requires the begin and end markers, comparing both trimmed', () => {
    expect(() => parsePatch('*** End Patch')).toThrow('patch must start with `*** Begin Patch`')
    expect(() => parsePatch('')).toThrow('patch must start with `*** Begin Patch`')
    expect(() => parsePatch('*** Begin Patch\n*** Update File: a.txt'))
      .toThrow('patch is missing `*** End Patch`')
    expect(parsePatch('*** Begin Patch\n*** End Patch ')).toEqual([])
  })

  it('rejects a line that belongs to no block and a non-add line in an add block', () => {
    expect(() => parsePatch(envelope(['stray']))).toThrow('unexpected patch line: "stray"')
    expect(() => parsePatch(envelope(['*** Add File: a.txt', 'one'])))
      .toThrow('add-file lines must start with \'+\': "one"')
  })

  it('rejects body lines in a delete block', () => {
    expect(() => parsePatch(envelope(['*** Delete File: a.txt', '-gone'])))
      .toThrow('unexpected line under delete: "-gone"')
  })

  it('rejects an update line that carries no prefix', () => {
    expect(() => parsePatch(envelope(['*** Update File: a.txt', 'plain'])))
      .toThrow('invalid update line: "plain"')
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '@@', '@@@'])))
      .toThrow('invalid update line: "@@@"')
  })

  it('rejects an empty hunk', () => {
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '@@']))).toThrow('an update hunk cannot be empty')
    expect(() => parsePatch(envelope(['*** Update File: a.txt', '@@', '@@']))).toThrow('an update hunk cannot be empty')
  })
})
