const API_BASE = 'https://api.github.com';

function decodeBase64Unicode(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export class GitHubService {
  constructor(token) {
    this.token = token;
  }

  async request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub Fehler ${response.status}: ${text}`);
    }

    return response.json();
  }

  async getUser() {
    return this.request('/user');
  }

  async listRepos() {
    const repos = [];
    let page = 1;
    while (page <= 5) {
      const chunk = await this.request(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
      repos.push(...chunk);
      if (chunk.length < 100) break;
      page += 1;
    }
    return repos;
  }

  async getRepoTree(owner, repo, branch) {
    const ref = branch || 'main';
    const data = await this.request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return data.tree || [];
  }

  async getFile(owner, repo, path, branch) {
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const data = await this.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}${ref}`);
    if (!data.content) return '';
    return decodeBase64Unicode(data.content);
  }
}
