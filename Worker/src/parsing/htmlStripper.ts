/** Turn an HTML email body into clean, regex-friendly text (port of Swift
 *  HTMLStripper). Order matters — see each stage. */
export function stripHtml(html: string): string {
  let text = html;

  // 1. Comments + non-content blocks (content AND tags) — their inner text
  //    would otherwise pollute the output with stray numbers.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'head', 'title']) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }

  // 2. Block-level boundaries → newlines (keeps lines/cells separate).
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|tr|td|th|li|h[1-6]|table|ul|ol|section|header|footer)>/gi, '\n');

  // 3. Remaining tags → "" so a tag-split amount stays contiguous.
  text = text.replace(/<[^>]+>/g, '');

  // 4. Entities: named, then numeric decimal (&#36;) and hex (&#x24;).
  const named: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
  };
  for (const [entity, ch] of Object.entries(named)) text = text.split(entity).join(ch);
  text = text.replace(/&#(\d+);/g, (m, d) => {
    const cp = Number(d);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
  text = text.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => {
    const cp = parseInt(h, 16);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });

  // 5. Tidy whitespace: collapse spaces/tabs, strip spaces around newlines,
  //    cap blank runs.
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/ *\n/g, '\n');
  text = text.replace(/\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
