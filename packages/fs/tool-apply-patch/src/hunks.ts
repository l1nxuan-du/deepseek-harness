/**
 * Whole-line matching for `apply_patch`, ported from Codex's `apply-patch`
 * crate: the line model that remembers each line's own terminator and the
 * ending new lines use, the four increasingly lenient run searches a hunk
 * anchors with, the replacement splice, and the diagnostics printed when a
 * hunk matches nowhere. A hunk's context and removed lines match one
 * contiguous run of whole lines; the first run at or after the previous
 * hunk's end wins, and `@@ <text>` moves the cursor past that text first.
 * @module @deepseek-ai/dsh-tool-apply-patch/src/hunks
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { PatchHunk } from './patch.ts'

/** One file line together with the terminator that followed it. */
interface Line {
  /** Line text without its terminator. */
  text: string
  /** `\n`, `\r\n`, `\r`, or the empty string on an unterminated final line. */
  eol: string
}

/** The line endings `apply_patch` recognizes, in the order a file may mix them. */
const LF = '\n'

/** The suffix every hunk-level failure carries, so the model never reads a declined patch as a partial one. */
const DECLINED = 'the patch was declined, nothing was written'

/**
 * Split content into lines, each remembering the terminator that followed it,
 * so a hunk can be matched line by line and the file reassembled without
 * touching a line ending it did not replace.
 * @param text - file content.
 * @returns one entry per line, the last carrying an empty terminator when the file does not end with one.
 */
function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '\n' && char !== '\r') continue
    const eol = char === '\r' && text[index + 1] === '\n' ? '\r\n' : char
    lines.push({ text: text.slice(start, index), eol })
    index += eol.length - 1
    start = index + 1
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' })
  return lines
}

/**
 * The terminator new lines inherit, which is the first terminator the file
 * already uses: a CRLF file stays CRLF, and a file with no terminator at all
 * (an empty or single unterminated line) takes LF.
 * @param lines - file lines in source order.
 * @returns the ending to give every inserted line.
 */
function preferredEnding(lines: readonly Line[]): string {
  for (const line of lines) {
    if (line.eol.length > 0) return line.eol
  }
  return LF
}

/**
 * Fold a line to the ASCII punctuation the fuzzy search compares: typographic
 * dashes, quotes, and spaces become their plain equivalents, and both ends are
 * trimmed. This mirrors `git apply`'s leniency for patches authored with plain
 * ASCII against files that use typography.
 * @param text - one line of the file or of the hunk.
 * @returns the folded comparison form.
 */
function normalizeLine(text: string): string {
  return [...text.trim()].map((char) => {
    if ('\u2010\u2011\u2012\u2013\u2014\u2015\u2212'.includes(char)) return '-'
    if ('\u2018\u2019\u201A\u201B'.includes(char)) return "'"
    if ('\u201C\u201D\u201E\u201F'.includes(char)) return '"'
    if ('\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000'.includes(char)) return ' '
    return char
  }).join('')
}

/**
 * Start index of the first run of whole lines that matches `pattern`, at or
 * after `start`, using the same four passes as Codex: exact, then ignoring
 * trailing whitespace, then ignoring leading and trailing whitespace, and
 * finally ignoring the difference between ASCII and common typographic
 * punctuation. Comparing line text rather than a slice of the file is what
 * stops a hunk from matching inside a longer line, and what lets a CRLF file
 * match a patch written with LF.
 * @param lines - the file's line texts.
 * @param pattern - the hunk's context and removed lines.
 * @param start - first index the search may use.
 * @param eof - whether the hunk declared `*** End of File`, which tries the file's end first.
 * @returns the match's start index, or undefined when no pass matches.
 */
function seekSequence(lines: readonly string[], pattern: readonly string[], start: number, eof: boolean): number | undefined {
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return undefined
  const lastStart = lines.length - pattern.length
  const searchStart = eof ? Math.max(lastStart, start) : start
  if (searchStart > lastStart) return undefined

  const passes: Array<(left: string) => string> = [
    text => text,
    text => text.trimEnd(),
    text => text.trim(),
    normalizeLine,
  ]
  for (const fold of passes) {
    for (let index = searchStart; index <= lastStart; index += 1) {
      if (pattern.every((line, offset) => fold((lines[index + offset] as string)) === fold(line))) return index
    }
  }
  return undefined
}

/**
 * Start indexes where `needle` matches `lines` as a run of whole lines, used by
 * the miss diagnostics to ask whether a hunk's own output is already present.
 * @param lines - file lines.
 * @param needle - the lines to look for, compared exactly.
 * @returns the start index of every whole-line match.
 */
function findLineRuns(lines: readonly Line[], needle: readonly string[]): number[] {
  const starts: number[] = []
  for (let index = 0; index + needle.length <= lines.length; index += 1) {
    const run = lines.slice(index, index + needle.length)
    if (run.every((line, offset) => line.text === needle[offset])) starts.push(index)
  }
  return starts
}

/**
 * Render a line so its invisible characters show: quotes around the text, with
 * trailing spaces and tabs spelled out. A hunk is declined over exactly that
 * kind of difference often enough to be worth printing.
 * @param text - line text.
 * @returns the line as a JSON string literal.
 */
function visible(text: string): string {
  return JSON.stringify(text)
}

/**
 * 1-based numbers of the lines whose text equals `text`.
 * @param lines - file lines.
 * @param text - the line text to find.
 * @returns the matching line numbers, in file order.
 */
function lineNumbersOf(lines: readonly Line[], text: string): number[] {
  const found: number[] = []
  for (const [index, line] of lines.entries()) {
    if (line.text === text) found.push(index + 1)
  }
  return found
}

/**
 * Length of the text two lines share from their first character.
 * @param left - one line's text.
 * @param right - the other line's text.
 * @returns the number of leading characters the two share.
 */
function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let length = 0
  while (length < limit && left[length] === right[length]) length += 1
  return length
}

/**
 * The file line that agrees with `text` for the most characters, so a hunk
 * declined over one edited word points at the line it probably meant. Ties go
 * to the earliest line.
 * @param lines - file lines.
 * @param text - the hunk line the file does not have as a whole line.
 * @returns the nearest line with its 1-based number and shared-prefix length, or undefined for an empty file.
 */
function nearestLine(lines: readonly Line[], text: string): { number: number; text: string; shared: number } | undefined {
  let best: { number: number; text: string; shared: number } | undefined
  for (const [index, line] of lines.entries()) {
    const shared = sharedPrefixLength(line.text, text)
    if (best === undefined || shared > best.shared) best = { number: index + 1, text: line.text, shared }
  }
  return best
}

/**
 * 1-based numbers of the lines that contain `text` inside a longer line.
 * @param lines - file lines.
 * @param text - the missing hunk line.
 * @returns the containing line numbers, in file order.
 */
function containingLines(lines: readonly Line[], text: string): number[] {
  if (text.length === 0) return []
  const found: number[] = []
  for (const [index, line] of lines.entries()) {
    if (line.text.includes(text)) found.push(index + 1)
  }
  return found
}

/** How closely a hunk's anchor lines agree with one position in the file. */
interface ClosestMatch {
  /** 1-based number of the start the hunk's lines agree with most. */
  number: number
  /** How many of the hunk's lines that start matches exactly. */
  matches: number
  /** Total shared-prefix characters the hunk's lines share with that start. */
  similarity: number
}

/**
 * Where a hunk's anchor lines agree with the file most closely, which is where
 * a reader looks first when a block is declined over one changed line inside it.
 * Exact line matches decide it first; when no position separates on matches,
 * the one whose lines share the most characters with the hunk's wins.
 * @param lines - file lines.
 * @param anchor - the hunk's context and removed lines.
 * @returns the closest start, or undefined when the file is shorter than the hunk.
 */
function closestMatch(lines: readonly Line[], anchor: readonly string[]): ClosestMatch | undefined {
  let best: ClosestMatch | undefined
  for (let start = 0; start + anchor.length <= lines.length; start += 1) {
    let matches = 0
    let similarity = 0
    for (const [offset, text] of anchor.entries()) {
      const candidate = (lines[start + offset] as Line).text
      if (candidate === text) matches += 1
      similarity += sharedPrefixLength(candidate, text)
    }
    if (best === undefined || matches > best.matches || (matches === best.matches && similarity > best.similarity)) {
      best = { number: start + 1, matches, similarity }
    }
  }
  return best
}

/**
 * Where the hunk's own replacement lines already sit in the file, if they do.
 * A patch re-sent after its first attempt landed is declined for a reason the
 * matcher cannot see on its own, so this is reported as a hint, not a fact.
 * The whole block is checked first, then each line on its own, which catches a
 * hunk whose output landed with a neighbouring line edited since.
 * @param lines - file lines.
 * @param hunk - the hunk that matched nowhere.
 * @returns the first place with its 1-based number, a placeless report when every written
 *   line exists but not as one block, or undefined for a hunk that writes nothing or writes
 *   something absent.
 */
function alreadyAppliedAt(lines: readonly Line[], hunk: PatchHunk): { number: number | undefined; places: number } | undefined {
  if (hunk.added === 0) return undefined
  const starts = findLineRuns(lines, hunk.newLines)
  if (starts.length > 0) return { number: (starts[0] as number) + 1, places: starts.length }
  return hunk.newLines.every(text => lineNumbersOf(lines, text).length > 0) ? { number: undefined, places: 0 } : undefined
}

/**
 * The detail lines printed under a declined hunk: which of its lines the file
 * does not have, the nearest line to each of those, where the block came
 * closest to matching, and whether the hunk's own output is already in the file.
 * @param lines - the file, split into lines.
 * @param hunk - the hunk that matched nowhere.
 * @param detailLimit - how many findings of each list are printed before the rest are counted.
 * @returns one indented detail line per finding.
 */
function explainMiss(lines: readonly Line[], hunk: PatchHunk, detailLimit: number): string[] {
  const details: string[] = []
  const missing = hunk.oldLines
    .map((text, offset) => ({ text, offset }))
    .filter(item => lineNumbersOf(lines, item.text).length === 0)

  if (missing.length === 0) {
    details.push('  every hunk line is in the file on its own, but never as one block')
  }
  for (const item of missing.slice(0, detailLimit)) {
    const label = `  hunk line ${item.offset + 1}`
    const inside = containingLines(lines, item.text)[0]
    if (inside !== undefined) {
      details.push(`${label} is not a whole line, though line ${inside} contains it: ${visible((lines[inside - 1] as Line).text)}`)
      continue
    }
    details.push(`${label} is not in the file: ${visible(item.text)}`)
    const nearest = nearestLine(lines, item.text)
    if (nearest !== undefined && nearest.shared > 0) {
      details.push(`    nearest is line ${nearest.number}: ${visible(nearest.text)} (both start with the same ${nearest.shared} characters)`)
    } else if (nearest !== undefined) {
      details.push(`    nearest is line ${nearest.number}: ${visible(nearest.text)}`)
    }
  }
  if (missing.length > detailLimit) {
    details.push(`  ... and ${missing.length - detailLimit} more hunk lines the file does not have`)
  }

  const closest = closestMatch(lines, hunk.oldLines)
  if (hunk.oldLines.length > 1 && closest !== undefined) {
    details.push(`  the block came closest at line ${closest.number}, where ${closest.matches} of ${hunk.oldLines.length} hunk lines match exactly`)
  }

  const applied = alreadyAppliedAt(lines, hunk)
  if (applied?.number !== undefined) {
    const places = applied.places > 1 ? `${applied.places} places, the first at line ${applied.number}` : `line ${applied.number}`
    details.push(`  hint: this hunk's added lines are already in the file at ${places}, so it may already be applied`)
  } else if (applied !== undefined) {
    details.push('  hint: every line this hunk would write is already in the file, so it may already be applied')
  }
  return details
}

/**
 * Apply a block's hunks, in patch order, over the growing line list.
 *
 * Each hunk matches one contiguous run of whole lines, searched from where the
 * previous hunk ended; context lines are kept in place so their own text and
 * terminators survive, and every inserted line takes the file's preferred
 * terminator. Like Codex, a hunk with no context or removed line inserts at the
 * end of the file, and the last line always ends with a terminator afterwards.
 * @param content - the whole file content the hunks run against.
 * @param hunks - the block's hunks, in patch order.
 * @param displayPath - the model-facing path named in a failure.
 * @param detailLimit - how many findings of each miss-detail list are printed.
 * @returns the complete content after every hunk was applied.
 * @throws FsError `FS_EDIT_NOT_FOUND` for a hunk whose anchor text is not in the file.
 */
export function applyHunks(content: string, hunks: readonly PatchHunk[], displayPath: string, detailLimit: number): string {
  const source = splitLines(content)
  const preferred = preferredEnding(source)
  /** One scheduled `(start, old length, inserted lines)` splice, in source order. */
  const replacements: Array<{ start: number; oldLength: number; newLines: readonly string[] }> = []
  let cursor = 0

  for (const [index, hunk] of hunks.entries()) {
    const where = `hunk ${index + 1} of ${hunks.length} in ${displayPath}`
    // `@@ <text>` moves the cursor past the line that text names, exactly as
    // the reference implementation's change context does; it never anchors a hunk.
    if (hunk.context !== undefined) {
      const anchor = seekSequence(source.map(line => line.text), [hunk.context], cursor, false)
      if (anchor === undefined) {
        throw new FsError(`Failed to find context ${JSON.stringify(hunk.context)} in ${displayPath}`, 'FS_EDIT_NOT_FOUND')
      }
      cursor = anchor + 1
    }

    // A hunk that removes and keeps nothing is Codex's insertion-at-EOF form.
    if (hunk.oldLines.length === 0) {
      replacements.push({ start: source.length, oldLength: 0, newLines: hunk.newLines })
      continue
    }

    const lines = source.map(line => line.text)
    let pattern = hunk.oldLines
    let inserted = hunk.newLines
    let found = seekSequence(lines, pattern, cursor, hunk.endOfFile)
    // A hunk that ends in an empty line usually means "the region up to the
    // file's final newline"; retry without that sentinel before declining.
    if (found === undefined && pattern.at(-1) === '') {
      pattern = pattern.slice(0, -1)
      if (inserted.at(-1) === '') inserted = inserted.slice(0, -1)
      found = seekSequence(lines, pattern, cursor, hunk.endOfFile)
    }
    if (found === undefined) {
      throw new FsError(
        [
          `Failed to find expected lines in ${displayPath}:`,
          ...hunk.oldLines,
          `apply_patch: ${where} did not match (${DECLINED})`,
          ...explainMiss(source, hunk, detailLimit),
        ].join('\n'),
        'FS_EDIT_NOT_FOUND',
      )
    }

    // Context lines appear on both sides of the hunk, so they are left out of
    // the replacement and the file's own text and terminator survive verbatim.
    let oldStart = 0
    let newStart = 0
    for (const [oldContext, newContext] of hunk.contextPairs) {
      if (oldContext >= pattern.length || newContext >= inserted.length) break
      if (oldStart !== oldContext || newStart !== newContext) {
        replacements.push({
          start: found + oldStart,
          oldLength: oldContext - oldStart,
          newLines: inserted.slice(newStart, newContext),
        })
      }
      oldStart = oldContext + 1
      newStart = newContext + 1
    }
    if (oldStart !== pattern.length || newStart !== inserted.length) {
      replacements.push({
        start: found + oldStart,
        oldLength: pattern.length - oldStart,
        newLines: inserted.slice(newStart),
      })
    }
    cursor = found + pattern.length
  }

  return applyReplacements(source, replacements, preferred)
}

/**
 * Build the file from the source lines and the scheduled splices, then give
 * every line an ending: an update has always ended the file with a newline in
 * the reference implementation, which also restores one to a final line an
 * insertion moved inward.
 * @param source - the file's parsed lines.
 * @param replacements - non-overlapping splices in source order.
 * @param preferred - terminator inserted lines use.
 * @returns the complete new content.
 */
function applyReplacements(
  source: readonly Line[],
  replacements: readonly { start: number; oldLength: number; newLines: readonly string[] }[],
  preferred: string,
): string {
  const out: Line[] = []
  let index = 0
  for (const replacement of replacements) {
    for (; index < replacement.start; index += 1) out.push(source[index] as Line)
    index += replacement.oldLength
    for (const text of replacement.newLines) out.push({ text, eol: preferred })
  }
  for (; index < source.length; index += 1) out.push(source[index] as Line)
  return out.map(line => line.text + (line.eol.length > 0 ? line.eol : preferred)).join('')
}
