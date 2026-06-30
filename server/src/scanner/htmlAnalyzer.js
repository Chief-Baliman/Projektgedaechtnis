import { parseDocument } from 'htmlparser2';
import { addFact, snippetAtLine } from './utils.js';

export function analyzeHtml(files, ctx) {
  const out = { files: [], tags: {}, ids: [], classes: [], text: [], scripts: [], links: [] };
  for (const file of files.filter(f => f.language === 'html')) {
    const doc = parseDocument(file.text, { lowerCaseTags: true, lowerCaseAttributeNames: true });
    const info = { file: file.path, tags: {}, ids: [], classes: [], text: [] };
    walk(doc.children || [], node => {
      if (node.type === 'tag') {
        info.tags[node.name] = (info.tags[node.name] || 0) + 1;
        out.tags[node.name] = (out.tags[node.name] || 0) + 1;
        if (node.attribs?.id) {
          info.ids.push(node.attribs.id); out.ids.push({ file:file.path, id:node.attribs.id });
          addFact(ctx.facts, { category: 'ui', type: 'id', file: file.path, line: findLine(file.text, node.attribs.id), value: `#${node.attribs.id}`, snippet: snippetAtLine(file.text, findLine(file.text, node.attribs.id)), strength: 2, reason: 'HTML-ID im UI.' });
        }
        if (node.attribs?.class) {
          const cls = node.attribs.class.split(/\s+/).filter(Boolean);
          info.classes.push(...cls); cls.forEach(c => out.classes.push({ file:file.path, class:c }));
        }
        if (node.name === 'script' && node.attribs?.src) out.scripts.push({ file:file.path, src: node.attribs.src });
        if (node.name === 'link' && node.attribs?.href) out.links.push({ file:file.path, href: node.attribs.href });
      }
      if (node.type === 'text') {
        const text = String(node.data || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 3 && text.length <= 140 && /[a-zA-ZäöüÄÖÜß]/.test(text)) {
          info.text.push(text); out.text.push({ file:file.path, text });
          if (/(queue|angebot|deal|preis|team|quiz|liga|grading|psa|bot|login|deploy|scan)/i.test(text)) {
            addFact(ctx.facts, { category:'ui', type:'visible_text', file:file.path, line: findLine(file.text, text), value:text, snippet: snippetAtLine(file.text, findLine(file.text, text)), strength:3, reason:'Sichtbarer UI-Text im HTML.' });
          }
        }
      }
    });
    out.files.push(info);
  }
  return out;
}

function walk(nodes, cb) {
  for (const node of nodes) {
    cb(node);
    if (node.children) walk(node.children, cb);
  }
}

function findLine(text, needle) {
  const idx = String(text).indexOf(String(needle));
  if (idx < 0) return null;
  return String(text).slice(0, idx).split(/\r?\n/).length;
}
