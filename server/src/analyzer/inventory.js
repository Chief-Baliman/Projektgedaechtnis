import { sha, languageOf, extOf, clean } from './utils.js';
export function buildInventory(files = []) {
  const rows = files.map(f => {
    const content = String(f.content || '');
    return {
      path: f.path,
      extension: extOf(f.path),
      language: languageOf(f.path),
      bytes: Buffer.byteLength(content, 'utf8'),
      lines: content ? content.split(/\r?\n/).length : 0,
      sha1: sha(content),
      firstMeaningfulLine: clean(content.split(/\r?\n/).find(l => clean(l)) || '').slice(0,180)
    };
  });
  const byLanguage = {};
  for (const r of rows) byLanguage[r.language] = (byLanguage[r.language] || 0) + 1;
  return {
    files: rows,
    byLanguage,
    fileCount: rows.length,
    totalBytes: rows.reduce((a,b)=>a+b.bytes,0),
    totalLines: rows.reduce((a,b)=>a+b.lines,0),
    fingerprint: sha(rows.map(r => `${r.path}:${r.sha1}:${r.bytes}`).join('|')),
    largestFiles: [...rows].sort((a,b)=>b.bytes-a.bytes).slice(0,25),
    codeFiles: rows.filter(r => !['markdown','text'].includes(r.language)).length
  };
}
