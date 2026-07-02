import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

async function run(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: opts.timeout || 8000, maxBuffer: opts.maxBuffer || 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    return '';
  }
}

function parseUnit(content) {
  const get = (key) => {
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    description: get('Description'),
    workingDirectory: get('WorkingDirectory'),
    execStart: get('ExecStart'),
    environmentFile: get('EnvironmentFile'),
    user: get('User') || 'root',
    restart: get('Restart')
  };
}

function detectStack(dir) {
  const files = new Set();
  try { for (const f of fs.readdirSync(dir)) files.add(f); } catch {}
  const stack = [];
  if (files.has('package.json')) stack.push('Node.js');
  if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('venv')) stack.push('Python');
  if (files.has('Dockerfile') || files.has('docker-compose.yml')) stack.push('Docker');
  if (files.has('.git')) stack.push('Git');
  if (files.has('.env')) stack.push('.env vorhanden');
  return stack;
}

async function gitRemote(dir) {
  if (!dir || !fs.existsSync(path.join(dir, '.git'))) return '';
  return await run('git', ['-C', dir, 'remote', 'get-url', 'origin']);
}

async function listOptProjects() {
  const base = '/opt';
  const dirs = [];
  try {
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      if (!fs.statSync(full).isDirectory()) continue;
      dirs.push({ name, path: full, stack: detectStack(full), gitRemote: await gitRemote(full) });
    }
  } catch {}
  return dirs.sort((a,b) => a.name.localeCompare(b.name));
}

async function listServices() {
  const dir = '/etc/systemd/system';
  const services = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.service')); } catch {}
  for (const file of names) {
    const unit = file;
    const full = path.join(dir, file);
    let content = '';
    try { content = fs.readFileSync(full, 'utf8'); } catch {}
    const parsed = parseUnit(content);
    const active = await run('systemctl', ['is-active', unit]);
    const enabled = await run('systemctl', ['is-enabled', unit]);
    const logs = await run('journalctl', ['-u', unit, '-n', '8', '--no-pager'], { timeout: 5000, maxBuffer: 512*1024 });
    const stack = parsed.workingDirectory ? detectStack(parsed.workingDirectory) : [];
    services.push({ unit, active, enabled, file: full, ...parsed, stack, logs: logs.split('\n').filter(Boolean).slice(-8) });
  }
  return services.sort((a,b) => a.unit.localeCompare(b.unit));
}


function isTextFile(name) {
  return /\.(js|mjs|cjs|ts|tsx|jsx|py|html|css|json|md|txt|yml|yaml|toml|ini|service|sh|env\.example)$/i.test(name) || /(^|\/)(Dockerfile|requirements\.txt|pyproject\.toml|package\.json|README\.md)$/i.test(name);
}

function shouldSkipPath(p) {
  const parts = p.split(path.sep);
  return parts.some(part => ['node_modules','venv','.venv','env','.git','__pycache__','.cache','dist','build','coverage','logs','tmp','temp'].includes(part))
    || /\.pyc$|\.sqlite$|\.db$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.pdf$|\.zip$|\.tar$|\.gz$|\.mp4$|\.mov$/i.test(p)
    || /(^|\/)\.env($|\.)/i.test(p);
}

function languageFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.service')) return 'systemd';
  if (lower.endsWith('.sh')) return 'shell';
  return 'text';
}

function simpleHash(text) {
  let h = 2166136261;
  for (let i=0; i<text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function maskLocalSecrets(text) {
  return String(text || '')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[MASKED_GITHUB_TOKEN]')
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, '[MASKED_OPENAI_KEY]')
    .replace(/(AIza[0-9A-Za-z\-_]{20,})/g, '[MASKED_GOOGLE_OR_FIREBASE_KEY]')
    .replace(/(bot[0-9]{6,}:[A-Za-z0-9_-]{20,})/gi, '[MASKED_TELEGRAM_TOKEN]')
    .replace(/(-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]+?-----END [^-]+ PRIVATE KEY-----)/g, '[MASKED_PRIVATE_KEY]')
    .replace(/(password|token|secret|api[_-]?key)\s*=\s*[^\n]+/gi, '$1=[MASKED]');
}

async function collectLocalProjectFiles(projectPath, limitFiles = 80, maxBytesPerFile = 120000) {
  const files = [];
  const base = path.resolve(projectPath || '');
  if (!base.startsWith('/opt') || !fs.existsSync(base)) return { base, files, warnings:['Pfad nicht gefunden oder außerhalb von /opt.'] };
  function walk(dir) {
    if (files.length >= limitFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch { return; }
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (files.length >= limitFiles) break;
      const full = path.join(dir, ent.name);
      const rel = path.relative(base, full);
      if (shouldSkipPath(full) || shouldSkipPath(rel)) continue;
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.isFile() || !isTextFile(ent.name)) continue;
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > maxBytesPerFile) continue;
      let text=''; try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const safe = maskLocalSecrets(text);
      files.push({ path: full, relativePath: rel, language: languageFor(ent.name), bytes: stat.size, lines: safe.split(/\r?\n/).length, hash: simpleHash(safe), text: safe });
    }
  }
  walk(base);
  return { base, files, warnings: files.length >= limitFiles ? [`Dateiliste auf ${limitFiles} Dateien begrenzt.`] : [] };
}

export async function getServerProjectDetails({ path: projectPath, unit } = {}) {
  const inv = await getServerInventory();
  let service = null;
  if (unit) service = (inv.services || []).find(s => s.unit === unit) || null;
  const resolvedPath = projectPath || service?.workingDirectory || '';
  const optProject = (inv.optProjects || []).find(p => p.path === resolvedPath || (resolvedPath && p.path && resolvedPath.startsWith(p.path))) || null;
  const corpus = await collectLocalProjectFiles(resolvedPath);
  return { inventory: inv, service, optProject, projectPath: resolvedPath, corpus, scannedAt: new Date().toISOString() };
}

export async function getServerInventory() {
  const [services, optProjects, listenersRaw, ipsRaw, osRaw] = await Promise.all([
    listServices(),
    listOptProjects(),
    run('ss', ['-tulpn']),
    run('hostname', ['-I']),
    run('lsb_release', ['-ds'])
  ]);
  const listeners = listenersRaw.split('\n').filter(l => /LISTEN/.test(l)).slice(0, 80);
  const ips = ipsRaw.split(/\s+/).filter(Boolean);
  return { scannedAt: new Date().toISOString(), host: await run('hostname', []), os: osRaw.replace(/\"/g, ''), ips, publicIp: ips[0] || '', services, optProjects, listeners };
}
