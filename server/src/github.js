import { getSetting } from './db.js';
import { decryptText } from './crypto.js';

export function getToken() {
  const item = getSetting('githubToken');
  if (!item?.encrypted) throw new Error('GitHub Token fehlt. Bitte im Developer Hub speichern oder GitHub OAuth einrichten.');
  return decryptText(item.encrypted);
}

export async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${data?.message || res.statusText}`);
  return data;
}

export async function listRepos() {
  const repos = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    language: r.language,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
    hasPages: r.has_pages,
    size: r.size,
    description: r.description || ''
  }));
}

export async function getTree(fullName, branch) {
  const [owner, repo] = fullName.split('/');
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const treeData = await gh(`/repos/${owner}/${repo}/git/trees/${headSha}?recursive=1`);
  return { headSha, tree: treeData.tree || [] };
}

export async function getFileContent(fullName, filePath, ref) {
  const [owner, repo] = fullName.split('/');
  const safe = encodeURIComponent(filePath).replaceAll('%2F', '/');
  const data = await gh(`/repos/${owner}/${repo}/contents/${safe}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(data) || !data.content) return '';
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function putFile(fullName, branch, filePath, content, message) {
  const [owner, repo] = fullName.split('/');
  const safe = encodeURIComponent(filePath).replaceAll('%2F', '/');
  let sha;
  try {
    const existing = await gh(`/repos/${owner}/${repo}/contents/${safe}?ref=${encodeURIComponent(branch)}`);
    sha = existing.sha;
  } catch {}
  return gh(`/repos/${owner}/${repo}/contents/${safe}`, {
    method: 'PUT',
    body: JSON.stringify({ message, branch, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) })
  });
}

export async function resetBranch(fullName, branch, sha) {
  const [owner, repo] = fullName.split('/');
  return gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha, force: true })
  });
}
