import { getGithubToken } from './store.js';

const API = 'https://api.github.com';

async function request(path, options = {}) {
  const token = getGithubToken();
  if (!token) throw new Error('Kein GitHub Token gespeichert.');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Chief-Developer-Hub',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = data?.message || text || `GitHub Fehler ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function listRepos() {
  const repos = await request('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    description: r.description || '',
    htmlUrl: r.html_url,
    language: r.language,
    defaultBranch: r.default_branch,
    hasPages: Boolean(r.has_pages),
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
    size: r.size,
    visibility: r.visibility
  }));
}

export async function getRepo(fullName) {
  const [owner, repo] = fullName.split('/');
  const r = await request(`/repos/${owner}/${repo}`);
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    description: r.description || '',
    htmlUrl: r.html_url,
    language: r.language,
    defaultBranch: r.default_branch,
    hasPages: Boolean(r.has_pages),
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
    size: r.size,
    visibility: r.visibility,
    homepage: r.homepage || '',
    topics: r.topics || []
  };
}

export async function getTree(fullName, ref) {
  const [owner, repo] = fullName.split('/');
  const tree = await request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return tree.tree || [];
}

export async function getBlobBuffer(fullName, sha) {
  const [owner, repo] = fullName.split('/');
  const blob = await request(`/repos/${owner}/${repo}/git/blobs/${sha}`);
  if (blob.encoding === 'base64') return Buffer.from(blob.content || '', 'base64');
  return Buffer.from(String(blob.content || ''), 'utf8');
}

export async function getBranchHead(fullName, branch) {
  const [owner, repo] = fullName.split('/');
  const ref = await request(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

export async function getFileMeta(fullName, path, branch) {
  const [owner, repo] = fullName.split('/');
  try {
    return await request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`);
  } catch (e) {
    if (String(e.message).includes('Not Found')) return null;
    throw e;
  }
}

export async function putFile(fullName, branch, filePath, contentBuffer, message) {
  const [owner, repo] = fullName.split('/');
  const existing = await getFileMeta(fullName, filePath, branch);
  const body = {
    message,
    content: Buffer.from(contentBuffer).toString('base64'),
    branch
  };
  if (existing?.sha) body.sha = existing.sha;
  return request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export async function resetBranch(fullName, branch, sha) {
  const [owner, repo] = fullName.split('/');
  return request(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha, force: true })
  });
}
