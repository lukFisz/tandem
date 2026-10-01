// Unified git diff of one file (working tree vs HEAD), parsed into hunks of rows, and the marks a
// file excerpt shows for it. The daemon stores the whole file's diff (`git diff HEAD
// --unified=999999 -- path`, or `--no-index /dev/null path` for an untracked file) as a blob.

export type RowType = 'ctx' | 'add' | 'del'

export interface DiffRow {
  type: RowType
  /** Old-side (HEAD) line number; unset on added rows. */
  oldNo?: number
  /** New-side (working tree) line number, the real file line; unset on deleted rows. */
  newNo?: number
  text: string
  /** The change group (a run of deleted and added rows with no context between) of a changed row. */
  group?: number
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** The text after the closing @@ (git's function context), without the leading space. */
  section: string
  rows: DiffRow[]
}

export interface ChangeGroup {
  id: number
  /** Added lines, in order (their newNo). */
  adds: number[]
  /** Deleted rows' text, in order. */
  dels: string[]
  /** The new-side line the group sits before: its first added line, or for a pure deletion the
   *  line that now follows the deleted ones (file length + 1 at the end of the file). */
  site: number
}

export interface ParsedDiff {
  hunks: Hunk[]
  groups: ChangeGroup[]
  /** The file is new (untracked or added): the diff is against /dev/null. */
  isNew: boolean
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

// parseDiff reads unified diff text. Header lines (diff --git, index, ---, +++, mode lines) and
// "\ No newline at end of file" markers are skipped; each hunk reads exactly the rows its header
// counts, so a trailing newline or stray text after the last hunk never turns into a row.
export function parseDiff(text: string): ParsedDiff {
  const lines = text.split('\n')
  const hunks: Hunk[] = []
  const groups: ChangeGroup[] = []
  let isNew = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i].replace(/\r$/, '')
    const m = HUNK.exec(line)
    if (!m) {
      if (line === '--- /dev/null' || line.startsWith('new file mode')) isNew = true
      i++
      continue
    }
    const hunk: Hunk = {
      oldStart: Number(m[1]),
      oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
      section: m[5] ?? '',
      rows: [],
    }
    hunks.push(hunk)
    i++
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    let oldLeft = hunk.oldLines
    let newLeft = hunk.newLines
    let group: ChangeGroup | null = null
    while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
      const raw = lines[i]
      if (raw.startsWith('\\')) {
        i++
        continue
      }
      if (HUNK.test(raw)) break
      const sign = raw[0] ?? ' '
      const body = raw.slice(1)
      if (sign === '+') {
        if (!group) groups.push((group = { id: groups.length + 1, adds: [], dels: [], site: newNo }))
        group.adds.push(newNo)
        hunk.rows.push({ type: 'add', newNo: newNo++, text: body, group: group.id })
        newLeft--
      } else if (sign === '-') {
        if (!group) groups.push((group = { id: groups.length + 1, adds: [], dels: [], site: newNo }))
        group.dels.push(body)
        hunk.rows.push({ type: 'del', oldNo: oldNo++, text: body, group: group.id })
        oldLeft--
      } else {
        // A context row; some tools write an empty context line as an empty line.
        group = null
        hunk.rows.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: body })
        oldLeft--
        newLeft--
      }
      i++
    }
  }
  for (const g of groups) if (g.adds.length) g.site = g.adds[0]
  return { hunks, groups, isNew }
}

/** Deleted lines shown (ghosted, with the Changes switch on) before or after an excerpt line. */
export interface DelSite {
  group: number
  lines: string[]
  /** A pure deletion (no lines added in its place): gets the red wedge in the gutter. */
  pure: boolean
}

export interface LineMark {
  kind?: 'add' | 'mod'
  group?: number
  delBefore?: DelSite
  /** Only on the excerpt's last line: lines deleted right after it. */
  delAfter?: DelSite
}

export interface ExcerptChanges {
  marks: Map<number, LineMark>
  /** Lines added with nothing deleted in their group. */
  added: number
  /** Added lines in a group that also deletes lines (a replacement). */
  modified: number
  /** Lines deleted outright (pure deletions) at a site inside the excerpt or on its edges. */
  deleted: number
}

function mark(marks: Map<number, LineMark>, line: number): LineMark {
  let m = marks.get(line)
  if (!m) marks.set(line, (m = {}))
  return m
}

// excerptChanges derives the marks of excerpt lines first..last. A replaced group's deleted
// lines are attached before its first added line inside the excerpt; a pure deletion sits before
// the line that now follows it, and counts when that line is first..last+1 (between the excerpt's
// neighbours and its own lines too: it is visible on the excerpt's edge).
export function excerptChanges(diff: ParsedDiff, first: number, last: number): ExcerptChanges {
  const marks = new Map<number, LineMark>()
  let added = 0
  let modified = 0
  let deleted = 0
  const inside = (n: number) => n >= first && n <= last
  for (const g of diff.groups) {
    if (g.adds.length) {
      const kind = g.dels.length ? 'mod' : 'add'
      const here = g.adds.filter(inside)
      for (const n of here) Object.assign(mark(marks, n), { kind, group: g.id })
      if (kind === 'add') added += here.length
      else modified += here.length
      if (g.dels.length && here.length) mark(marks, here[0]).delBefore = { group: g.id, lines: g.dels, pure: false }
    } else if (g.site >= first && g.site <= last + 1) {
      const site: DelSite = { group: g.id, lines: g.dels, pure: true }
      if (g.site <= last) mark(marks, g.site).delBefore = site
      else mark(marks, last).delAfter = site
      deleted += g.dels.length
    }
  }
  return { marks, added, modified, deleted }
}

export function hasChanges(c: ExcerptChanges): boolean {
  return c.added + c.modified + c.deleted > 0
}

// rowInExcerpt: a context or added row whose line is in the excerpt, or a deleted row whose group
// touches it (adds a line in it, or deletes at a site on it or its edges).
export function rowInExcerpt(diff: ParsedDiff, row: DiffRow, first: number, last: number): boolean {
  if (row.type !== 'del') return row.newNo !== undefined && row.newNo >= first && row.newNo <= last
  const g = diff.groups[(row.group ?? 0) - 1]
  if (!g) return false
  if (g.adds.length) return g.adds.some((n) => n >= first && n <= last)
  return g.site >= first && g.site <= last + 1
}

export interface Segment {
  /** The @@ line shown above the rows. */
  header: string
  rows: DiffRow[]
  /** Index of the segment's first row in its hunk (for token lookups). */
  hunk: number
  offset: number
}

export const CONTEXT = 3

function headerOf(rows: DiffRow[], section: string): string {
  const olds = rows.filter((r) => r.type !== 'add')
  const news = rows.filter((r) => r.type !== 'del')
  const oldStart = olds[0]?.oldNo ?? Math.max(0, (rows.find((r) => r.oldNo !== undefined)?.oldNo ?? 1) - 1)
  const newStart = news[0]?.newNo ?? Math.max(0, (rows.find((r) => r.newNo !== undefined)?.newNo ?? 1) - 1)
  return `@@ -${olds.length ? oldStart : 0},${olds.length} +${news.length ? newStart : 0},${news.length} @@${section ? ' ' + section : ''}`
}

// segments lists what the diff modal shows: in 'file' scope every hunk as it is; in 'excerpt'
// scope, per hunk, the rows from the first to the last one in the excerpt plus up to CONTEXT
// context rows on each side (stopping at a change outside it), with a header recomputed for them.
export function segments(diff: ParsedDiff, scope: 'excerpt' | 'file', first: number, last: number): Segment[] {
  const out: Segment[] = []
  diff.hunks.forEach((h, hi) => {
    if (scope === 'file') {
      out.push({ header: headerOf(h.rows, h.section), rows: h.rows, hunk: hi, offset: 0 })
      return
    }
    let lo = -1
    let hi2 = -1
    h.rows.forEach((r, k) => {
      if (!rowInExcerpt(diff, r, first, last)) return
      if (lo < 0) lo = k
      hi2 = k
    })
    if (lo < 0) return
    for (let n = 0; n < CONTEXT && lo > 0 && h.rows[lo - 1].type === 'ctx'; n++) lo--
    for (let n = 0; n < CONTEXT && hi2 < h.rows.length - 1 && h.rows[hi2 + 1].type === 'ctx'; n++) hi2++
    const rows = h.rows.slice(lo, hi2 + 1)
    out.push({ header: headerOf(rows, h.section), rows, hunk: hi, offset: lo })
  })
  return out
}

/** Added and deleted row counts of the given rows (the modal's "+X −Y"). */
export function rowStats(rows: DiffRow[]): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const r of rows) {
    if (r.type === 'add') added++
    else if (r.type === 'del') deleted++
  }
  return { added, deleted }
}

export type SplitCell = DiffRow | null

// splitRows pairs a unified run into side-by-side rows: context on both sides, and within a
// change group its deleted rows against its added rows, padded with blanks.
export function splitRows(rows: DiffRow[]): [SplitCell, SplitCell][] {
  const out: [SplitCell, SplitCell][] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].type === 'ctx') {
      out.push([rows[i], rows[i]])
      i++
      continue
    }
    const dels: DiffRow[] = []
    const adds: DiffRow[] = []
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++])
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k] ?? null, adds[k] ?? null])
  }
  return out
}
