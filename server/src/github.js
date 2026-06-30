import { decryptText } from './crypto.js';
import { getSetting } from './db.js';

export function getGithubToken() {
  const saved = getSetting('githubToken');
  if (!saved?.encrypted) return '';
  return decryptText(saved.encrypted);
}

export async function gh(path, options = {}) {
  const token = getGithubToken();
  if (!token) throw new Error('GitHub Token ist nicht hinterlegt.');
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message || res.statusText;
    throw new Error(`GitHub Fehler ${res.status}: ${message}`);
  }
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
    size: r.size
  }));
}

export async function getTree(fullName, branch) {
  const [owner, repo] = fullName.split('/');
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const sha = ref.object.sha;
  const tree = await gh(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  return { headSha: sha, tree: tree.tree || [] };
}

export async function getFileContent(fullName, path, ref) {
  const [owner, repo] = fullName.split('/');
  const data = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F','/')}?ref=${encodeURIComponent(ref)}`);
  if (!data.content) return '';
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function putFile(fullName, branch, filePath, content, message) {
  const [owner, repo] = fullName.split('/');
  let sha;
  try {
    const existing = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replaceAll('%2F','/')}?ref=${encodeURIComponent(branch)}`);
    sha = existing.sha;
  } catch (e) {
    sha = undefined;
  }
  return gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replaceAll('%2F','/')}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch,
      content: Buffer.from(content).toString('base64'),
      ...(sha ? { sha } : {})
    })
  });
}

export async function resetBranch(fullName, branch, sha) {
  const [owner, repo] = fullName.split('/');
  return gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha, force: true })
  });
}
