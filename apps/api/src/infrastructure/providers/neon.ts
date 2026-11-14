import type { Connectable } from '../../features/connections/index.js';
import type { Database } from '../../features/projects/index.js';
import { fetchJson, type Fetch } from '../../platform/http.js';

const ID = 'neon';
const API = 'https://console.neon.tech/api/v2';

interface ProjectsAnswer {
  projects: { id: string; name: string }[];
}

const headers = (token: string) => ({ authorization: `Bearer ${token}` });

/** Neon projects as databases. */
export function neonDatabase(fetchImpl: Fetch): Database & Connectable {
  const projects = (token: string, search?: string) =>
    fetchJson<ProjectsAnswer>(fetchImpl, {
      provider: ID,
      url: `${API}/projects?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      headers: headers(token),
    }).then((a) => a.projects);

  return {
    id: ID,
    kind: 'database',
    fields: ['token'],
    keyUrl: 'https://console.neon.tech/app/settings/api-keys',
    keyScopes: 'A personal API key',
    async verify(fields) {
      const token = fields.token!;
      const found = await projects(token);
      const me = await fetchJson<{ email?: string; name?: string }>(fetchImpl, {
        provider: ID,
        url: `${API}/users/me`,
        headers: headers(token),
      }).catch(() => null);
      return { account: me?.email || me?.name || `${found.length} projects`, credential: token };
    },
    async findProject(token, name) {
      const wanted = name.toLowerCase();
      const match = (await projects(token, name)).find((p) => p.name.toLowerCase() === wanted);
      return match ? { ref: match.id } : null;
    },
  };
}
