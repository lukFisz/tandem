import { describe, expect, it } from 'vitest'
import { excerptChanges, parseDiff, rowInExcerpt, rowStats, segments, splitRows } from './diff'
import { diffTokens } from './tokens'
import { plainTokenize } from '../highlight/tokenize'

// The mockup's excerpt (lines 40–55 of blobs.go) in git's order: one added line, three modified
// lines and one deleted line.
export const BLOBS_DIFF = [
  'diff --git a/internal/store/blobs.go b/internal/store/blobs.go',
  'index 1111111..2222222 100644',
  '--- a/internal/store/blobs.go',
  '+++ b/internal/store/blobs.go',
  '@@ -40,16 +40,16 @@ func (s *Store) Put',
  ' func (s *Store) Put(ctx context.Context, b []byte) (string, error) {',
  ' \tsum := sha256.Sum256(b)',
  ' \tkey := hex.EncodeToString(sum[:])',
  ' \tpath := filepath.Join(s.root, key[:2], key)',
  '-\tif fileExists(path) {',
  '+\tif _, err := os.Stat(path); err == nil {',
  ' \t\treturn key, nil',
  ' \t}',
  '-\ts.log.Debug("blob miss", "key", key)',
  ' \tif err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {',
  '-\t\treturn "", err',
  '+\t\treturn "", fmt.Errorf("mkdir blob dir: %w", err)',
  ' \t}',
  '+\ttmp := path + ".tmp"',
  ' \tif err := os.WriteFile(tmp, b, 0o644); err != nil {',
  ' \t\treturn "", err',
  ' \t}',
  '-\treturn key, nil',
  '+\treturn key, os.Rename(tmp, path)',
  ' }',
  '',
].join('\n')

describe('parseDiff', () => {
  it('reads a hunk into numbered rows and change groups, skipping headers', () => {
    const d = parseDiff(BLOBS_DIFF)
    expect(d.isNew).toBe(false)
    expect(d.hunks).toHaveLength(1)
    const h = d.hunks[0]
    expect(h).toMatchObject({ oldStart: 40, oldLines: 16, newStart: 40, newLines: 16, section: 'func (s *Store) Put' })
    expect(h.rows).toHaveLength(20)
    expect(h.rows[0]).toEqual({ type: 'ctx', oldNo: 40, newNo: 40, text: 'func (s *Store) Put(ctx context.Context, b []byte) (string, error) {' })
    expect(h.rows[4]).toEqual({ type: 'del', oldNo: 44, text: '\tif fileExists(path) {', group: 1 })
    expect(h.rows[5]).toEqual({ type: 'add', newNo: 44, text: '\tif _, err := os.Stat(path); err == nil {', group: 1 })
    expect(h.rows[9]).toEqual({ type: 'ctx', oldNo: 48, newNo: 47, text: '\tif err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {' })
    expect(d.groups.map((g) => [g.id, g.adds, g.dels.length, g.site])).toEqual([
      [1, [44], 1, 44],
      [2, [], 1, 47],
      [3, [48], 1, 48],
      [4, [50], 0, 50],
      [5, [54], 1, 54],
    ])
  })

  it('reads an untracked file (against /dev/null) as all added', () => {
    const d = parseDiff('diff --git a/x.go b/x.go\nnew file mode 100644\n--- /dev/null\n+++ b/x.go\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n')
    expect(d.isNew).toBe(true)
    expect(d.hunks[0].rows.map((r) => [r.type, r.newNo])).toEqual([
      ['add', 1],
      ['add', 2],
      ['add', 3],
    ])
    const c = excerptChanges(d, 2, 3)
    expect([c.added, c.modified, c.deleted]).toEqual([2, 0, 0])
    expect(c.marks.get(2)).toEqual({ kind: 'add', group: 1 })
    expect(segments(d, 'excerpt', 2, 3)[0].header).toBe('@@ -0,0 +2,2 @@')
  })

  it('skips "No newline at end of file" markers', () => {
    const d = parseDiff('@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n')
    expect(d.hunks[0].rows.map((r) => `${r.type}:${r.text}`)).toEqual(['ctx:a', 'del:b', 'add:b'])
    expect(d.groups).toHaveLength(1)
    expect(excerptChanges(d, 1, 2).marks.get(2)).toMatchObject({ kind: 'mod', group: 1 })
  })

  it('reads multiple hunks with their own numbering and one-line counts', () => {
    const d = parseDiff('@@ -2 +2 @@\n-x\n+y\n@@ -10,2 +10,3 @@ fn\n a\n+b\n c\n')
    expect(d.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [2, 1, 2, 1],
      [10, 2, 10, 3],
    ])
    expect(d.hunks[1].rows.map((r) => r.newNo)).toEqual([10, 11, 12])
    expect(d.groups.map((g) => g.id)).toEqual([1, 2])
    expect(excerptChanges(d, 1, 20).marks.get(11)).toEqual({ kind: 'add', group: 2 })
    expect(segments(d, 'excerpt', 11, 11).map((s) => s.hunk)).toEqual([1])
  })

  it('keeps an empty context line', () => {
    const d = parseDiff('@@ -1,3 +1,3 @@\n a\n\n-c\n+C\n')
    expect(d.hunks[0].rows.map((r) => r.type)).toEqual(['ctx', 'ctx', 'del', 'add'])
  })
})

describe('excerptChanges', () => {
  const d = parseDiff(BLOBS_DIFF)

  it('marks added and modified lines and counts pure deletions', () => {
    const c = excerptChanges(d, 40, 55)
    expect([c.added, c.modified, c.deleted]).toEqual([1, 3, 1])
    expect(c.marks.get(44)).toEqual({ kind: 'mod', group: 1, delBefore: { group: 1, lines: ['\tif fileExists(path) {'], pure: false } })
    expect(c.marks.get(50)).toEqual({ kind: 'add', group: 4 })
    expect(c.marks.get(54)).toMatchObject({ kind: 'mod', group: 5, delBefore: { pure: false, lines: ['\treturn key, nil'] } })
    expect(c.marks.get(47)).toEqual({ delBefore: { group: 2, lines: ['\ts.log.Debug("blob miss", "key", key)'], pure: true } })
    expect(c.marks.has(40)).toBe(false)
  })

  it('keeps only the lines inside the excerpt', () => {
    const c = excerptChanges(d, 45, 50)
    expect([c.added, c.modified, c.deleted]).toEqual([1, 1, 1])
    expect([...c.marks.keys()].sort((a, b) => a - b)).toEqual([47, 48, 50])
  })

  it('attaches a replaced group’s deleted lines to its first added line inside the excerpt', () => {
    const e = parseDiff('@@ -1,3 +1,4 @@\n a\n-b\n+B1\n+B2\n c\n')
    const c = excerptChanges(e, 3, 4)
    expect(c.marks.get(3)).toEqual({ kind: 'mod', group: 1, delBefore: { group: 1, lines: ['b'], pure: false } })
    expect(c.marks.has(2)).toBe(false)
    expect([c.added, c.modified, c.deleted]).toEqual([0, 1, 0])
  })

  it('puts a deletion right after the excerpt on its last line', () => {
    const c = excerptChanges(d, 44, 46)
    expect(c.marks.get(46)).toEqual({ delAfter: { group: 2, lines: ['\ts.log.Debug("blob miss", "key", key)'], pure: true } })
    expect(c.deleted).toBe(1)
    expect(excerptChanges(d, 48, 49).deleted).toBe(0)
  })

  it('handles a pure deletion at the end of the file', () => {
    const e = parseDiff('@@ -1,3 +1,2 @@\n a\n b\n-c\n')
    expect(e.groups[0].site).toBe(3)
    const c = excerptChanges(e, 1, 2)
    expect(c.marks.get(2)).toEqual({ delAfter: { group: 1, lines: ['c'], pure: true } })
    expect(c.deleted).toBe(1)
  })
})

describe('modal helpers', () => {
  const d = parseDiff(BLOBS_DIFF)

  it('selects excerpt rows with a few lines of context, stopping at changes outside it', () => {
    const s = segments(d, 'excerpt', 47, 48)
    expect(s).toHaveLength(1)
    expect(s[0].offset).toBe(6)
    expect(s[0].rows.map((r) => (r.type === 'del' ? `-${r.oldNo}` : r.newNo))).toEqual([45, 46, '-47', 47, '-49', 48, 49])
    expect(s[0].header).toBe('@@ -45,6 +45,5 @@ func (s *Store) Put')
    expect(segments(d, 'excerpt', 1, 10)).toEqual([])
  })

  it('shows every hunk in whole-file scope and flags excerpt rows', () => {
    const s = segments(d, 'file', 44, 44)
    expect(s[0].rows).toHaveLength(20)
    expect(s[0].header).toBe('@@ -40,16 +40,16 @@ func (s *Store) Put')
    const inEx = s[0].rows.filter((r) => rowInExcerpt(d, r, 44, 44))
    expect(inEx.map((r) => r.type)).toEqual(['del', 'add'])
  })

  it('counts and pairs rows', () => {
    expect(rowStats(d.hunks[0].rows)).toEqual({ added: 4, deleted: 4 })
    const pairs = splitRows(d.hunks[0].rows)
    expect(pairs[4].map((c) => c?.type)).toEqual(['del', 'add'])
    expect(pairs.filter(([l, r]) => l === null || r === null)).toHaveLength(2)
  })

  it('tokenizes old and new sides', () => {
    const t = diffTokens(d, plainTokenize, 'go')
    expect(t[0][4][0].content).toBe('\tif fileExists(path) {')
    expect(t[0][5][0].content).toBe('\tif _, err := os.Stat(path); err == nil {')
    expect(t[0][9][0].content).toBe('\tif err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {')
    expect(t[0].at(-1)![0].content).toBe('}')
  })
})
