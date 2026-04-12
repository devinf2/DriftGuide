/**
 * Strips common markdown from bundled / persisted offline guide text so UI never shows ## or **.
 */
export function stripOfflineGuideMarkdown(input: string): string {
  let t = input.replace(/\r\n/g, '\n').trim();
  t = t
    .split('\n')
    .map((line) => {
      let l = line.replace(/^#{1,6}\s+/, '');
      l = l.replace(/^\s*[-*+]\s+/, '• ');
      return l;
    })
    .join('\n');
  t = t.replace(/^\s*-{3,}\s*$/gm, '');
  while (/\*\*[^*]+\*\*/.test(t)) {
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  }
  /** Any leftover `**` (broken pairs or edge cases) — never show raw markdown in UI. */
  t = t.replace(/\*\*/g, '');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}
