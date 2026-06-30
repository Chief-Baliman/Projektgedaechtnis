import crypto from 'crypto';
import path from 'path';

export function sha256(bufferOrText) {
  return crypto.createHash('sha256').update(bufferOrText || '').digest('hex');
}

export function extOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

export function languageOf(filePath) {
  const ext = extOf(filePath);
  const base = path.basename(filePath).toLowerCase();
  if (['package.json', 'firebase.json', 'database.rules.json'].includes(base) || ext === '.json') return 'json';
  if (['.js', '.mjs', '.cjs'].includes(ext)) return 'javascript';
  if (['.ts', '.tsx'].includes(ext)) return 'typescript';
  if (ext === '.jsx') return 'javascript-react';
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.css'].includes(ext)) return 'css';
  if (['.md', '.markdown'].includes(ext)) return 'markdown';
  if (['.yml', '.yaml'].includes(ext)) return 'yaml';
  if (['.env', '.example'].includes(ext) || base.includes('.env')) return 'env';
  if (['.py'].includes(ext)) return 'python';
  if (['.sh'].includes(ext)) return 'shell';
  return 'other';
}

export function isProbablyText(filePath, size = 0) {
  const lang = languageOf(filePath);
  if (['javascript','typescript','javascript-react','html','css','json','markdown','yaml','env','python','shell','other'].includes(lang)) {
    const ext = extOf(filePath);
    const blocked = ['.png','.jpg','.jpeg','.webp','.gif','.ico','.pdf','.zip','.woff','.woff2','.ttf','.eot','.mp4','.mov','.mp3','.wav','.sqlite','.db'];
    if (blocked.includes(ext)) return false;
    if (size > 1_500_000) return false;
    return true;
  }
  return false;
}

export function lineNumberForOffset(text, offset) {
  if (offset == null || offset < 0) return null;
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function snippetAtLine(text, line, radius = 0) {
  const lines = String(text || '').split(/\r?\n/);
  const start = Math.max(0, (line || 1) - 1 - radius);
  const end = Math.min(lines.length, (line || 1) + radius);
  return lines.slice(start, end).join('\n').slice(0, 500);
}

export function normalizePath(p) {
  return String(p || '').replace(/^\/+/, '').replace(/\\/g, '/');
}

export function addFact(facts, fact) {
  facts.push({
    id: `${facts.length + 1}`,
    strength: fact.strength || 1,
    category: fact.category || 'code',
    type: fact.type || 'generic',
    value: fact.value ?? '',
    file: fact.file || '',
    line: fact.line || null,
    snippet: String(fact.snippet || '').trim().slice(0, 700),
    reason: fact.reason || ''
  });
}

export function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

export function safeJsonParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, error: e.message }; }
}

export function getByPath(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

export function countWords(text) {
  const map = new Map();
  const blacklist = new Set(['const','let','var','function','return','class','async','await','true','false','null','undefined','import','from','export','default','this','that','with','then','else','if','for','while','button','input','div','span','text','value','data','item','items','array','object','string','number','error','console','log','document','window','queryselector','addeventlistener','innerhtml','length','push','map','filter','find','set','get']);
  const words = String(text || '').toLowerCase().match(/[a-zäöüß][a-z0-9äöüß_-]{2,}/g) || [];
  for (const w of words) {
    if (blacklist.has(w)) continue;
    map.set(w, (map.get(w) || 0) + 1);
  }
  return [...map.entries()].sort((a,b) => b[1] - a[1]).slice(0, 80).map(([word,count]) => ({ word, count }));
}
