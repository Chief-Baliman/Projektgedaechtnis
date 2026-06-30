import crypto from 'crypto';
export const ANALYZER_VERSION = '5.0-real-code-reader';
export const TEXT_EXT = /\.(html|js|ts|tsx|jsx|json|md|css|yml|yaml|env|txt|rules|cjs|mjs|py|service|toml|ini|conf|vue|svelte|xml|sh|bash)$/i;
export const MAX_FILES = 1600;
export const MAX_FILE_SIZE = 1500000;
export const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const uniq = arr => [...new Set((arr || []).filter(Boolean))];
export function sha(s) { return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 16); }
export function lineNoAt(text, index) { return String(text || '').slice(0, index).split(/\r?\n/).length; }
export function getLine(text, line) { return String(text || '').split(/\r?\n/)[Math.max(0, line - 1)] || ''; }
export function makeFact({ kind, file, line, match, snippet, confidence = 1, source = 'code', details = {} }) {
  return { kind, file, line, match: clean(match).slice(0, 240), snippet: clean(snippet).slice(0, 320), confidence, source, details };
}
export function shouldReadFile(item) {
  return item.type === 'blob'
    && TEXT_EXT.test(item.path)
    && (item.size || 0) <= MAX_FILE_SIZE
    && !/node_modules|dist|build|vendor|coverage|\.next|\.nuxt|\.cache|\.min\.js|package-lock\.json|pnpm-lock|yarn\.lock|\.map$/i.test(item.path);
}
export function scorePath(p) {
  if (/^(README\.md|index\.html|package\.json|firebase\.json|database\.rules\.json|firestore\.rules|storage\.rules|\.env\.example)$/i.test(p)) return 0;
  if (/^(src|server|app|pages|components|lib|scripts|functions|public|assets)\//i.test(p)) return 1;
  if (/firebase|database|rules|config|main|app|index|vite|next|nuxt|requirements|\.service|docker|nginx|bot|watcher|tracker|offer|angebot|queue|quiz/i.test(p)) return 2;
  return 5;
}
export function limitReadable(tree) { return tree.filter(shouldReadFile).sort((a,b) => scorePath(a.path) - scorePath(b.path)).slice(0, MAX_FILES); }
export function extOf(path) { return (path.match(/\.([^.\/]+)$/)?.[1] || '').toLowerCase(); }
export function languageOf(path) {
  const ext = extOf(path);
  if (['js','mjs','cjs','jsx'].includes(ext)) return 'javascript';
  if (['ts','tsx'].includes(ext)) return 'typescript';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'py') return 'python';
  if (['yml','yaml'].includes(ext)) return 'yaml';
  if (ext === 'md') return 'markdown';
  if (['rules'].includes(ext) || /firestore\.rules|database\.rules/i.test(path)) return 'firebase-rules';
  return 'text';
}
export function topCounts(items, n = 30) {
  const m = new Map();
  for (const x of items || []) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([value,count])=>({ value, count }));
}
