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

export async function getServerInventory() {
  const [services, optProjects, listenersRaw] = await Promise.all([
    listServices(),
    listOptProjects(),
    run('ss', ['-tulpn'])
  ]);
  const listeners = listenersRaw.split('\n').filter(l => /LISTEN/.test(l)).slice(0, 80);
  return { scannedAt: new Date().toISOString(), host: await run('hostname', []), services, optProjects, listeners };
}
