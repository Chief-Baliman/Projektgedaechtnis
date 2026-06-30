import { addFact, snippetAtLine } from './utils.js';

export function analyzeCss(files, ctx) {
  const out = { files: [], selectors: [] };
  for (const file of files.filter(f => f.language === 'css')) {
    const selectors = [];
    const re = /([^{}]+)\{/g;
    let m;
    while ((m = re.exec(file.text))) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      if (!selector || selector.startsWith('@')) continue;
      const line = file.text.slice(0, m.index).split(/\r?\n/).length;
      selectors.push(selector);
      if (/(queue|offer|deal|quiz|team|grading|bot|dashboard|card|panel)/i.test(selector)) {
        addFact(ctx.facts, { category:'ui', type:'css_selector', file:file.path, line, value:selector, snippet: snippetAtLine(file.text,line), strength:2, reason:'Fachlich relevanter CSS-Selektor.' });
      }
    }
    out.files.push({ file:file.path, selectorCount:selectors.length });
    out.selectors.push(...selectors.slice(0, 200).map(s => ({ file:file.path, selector:s })));
  }
  return out;
}
