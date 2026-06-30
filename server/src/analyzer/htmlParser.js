import { makeFact, lineNoAt, getLine, clean } from './utils.js';
export function analyzeHtml(files) {
  const facts = [];
  for (const file of files.filter(f => /\.(html|vue|svelte)$/i.test(f.path))) {
    const c = String(file.content || '');
    const specs = [
      ['html.title', /<title[^>]*>([^<]+)<\/title>/gi],
      ['html.heading', /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi],
      ['html.button', /<button[^>]*>([\s\S]*?)<\/button>/gi],
      ['html.input', /<input[^>]*(?:placeholder=["'`]([^"'`]+)["'`])?[^>]*>/gi],
      ['html.script', /<script[^>]*(?:src=["'`]([^"'`]+)["'`])?[^>]*>/gi]
    ];
    for (const [kind, re] of specs) {
      let m; while ((m = re.exec(c))) {
        const line = lineNoAt(c, m.index);
        const value = clean(m[2] || m[1] || m[0]);
        if (value) facts.push(makeFact({ kind, file:file.path, line, match:value, snippet:getLine(c,line), confidence:0.8 }));
      }
    }
  }
  return facts;
}
