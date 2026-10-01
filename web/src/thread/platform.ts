// M7: the composer's "⌘↵ sends…" hint showed the Mac glyph on every platform. modKeyLabel picks
// the right one from navigator.platform/userAgent (both are checked since either can be absent
// or spoofed, and neither alone is reliable across browsers).
export function isMac(): boolean {
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const platform = nav.platform ?? nav.userAgentData?.platform ?? ''
    const ua = nav.userAgent ?? ''
    return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X|darwin/i.test(ua)
  } catch {
    return false
  }
}

export function modKeyLabel(): string {
  return isMac() ? '⌘↵' : 'Ctrl↵'
}
