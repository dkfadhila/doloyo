const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** Tiny markdown renderer: headings, paragraphs, bullet/numbered lists, tables, fenced code, blockquotes, bold, inline code. */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let code: string[] | null = null;
  let table: string[] = [];

  const flushPara = () => {
    if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, , ...rows] = table;
    out.push(
      '<table><thead><tr>' + cells(head).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>',
    );
    table = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const line of src.replace(/\r/g, '').split('\n')) {
    if (code) {
      if (line.startsWith('```')) {
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.trimStart().startsWith('|')) {
      flushPara();
      closeList();
      table.push(line);
      continue;
    }
    flushTable();
    if (line.startsWith('```')) {
      flushPara();
      closeList();
      code = [];
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const kind = li[1] ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push('<li>' + inline(li[3]) + '</li>');
      continue;
    }
    if (line.startsWith('>')) {
      flushPara();
      closeList();
      out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>');
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  flushTable();
  closeList();
  return out.join('\n');
}
