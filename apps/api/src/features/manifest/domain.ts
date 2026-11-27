import { parse as parseYaml, stringify } from 'yaml';
import { z } from 'zod';

/**
 * `pono.yaml`, at the root of the repository: the project's truth (D-014). Identifiers only, never a
 * secret, and never the release mode: a file an agent can edit cannot hold a rule agents must not
 * change (D-006).
 */
export const MANIFEST_PATH = 'pono.yaml';
/** Published by Pono itself, read signed out (D-044): editors validate `pono.yaml` against it. */
export const SCHEMA_URL = 'https://pono.kete.digital/v1/schema/project-1.json';

const name = z.string().min(1).max(100);
const path = z.string().min(1).max(300);
const url = z.url().max(500);

const environment = z.strictObject({
  branch: z.string().min(1).max(200).optional(),
  hosting: z.string().min(1).max(50).optional(),
  site: z.string().min(1).max(200).optional(),
  url: url.optional(),
  server: z.literal('pono').optional(),
});

const destruction = z.union([
  path,
  z.strictObject({ file: path, operation: z.string().min(1).max(50).optional() }),
]);

export const manifestSchema = z.strictObject({
  version: z.literal(1),
  name,
  template: z.string().min(1).max(50).optional(),
  agent: z.enum(['claude-code', 'codex', 'opencode', 'none']).optional(),
  environments: z
    .strictObject({
      production: environment.optional(),
      preview: environment.optional(),
      development: environment.optional(),
    })
    .optional(),
  database: z
    .strictObject({
      provider: z.string().min(1).max(50),
      project: z.string().min(1).max(200),
      branches: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  skills: z
    .strictObject({
      use: z.array(name).max(100).optional(),
      off: z.array(name).max(100).optional(),
      local: path.optional(),
    })
    .optional(),
  release: z
    .strictObject({
      migrations: z.array(path).max(50).optional(),
      example_files: z.array(path).max(100).optional(),
      declared_destructions: z.array(destruction).max(50).optional(),
    })
    .optional(),
  analytics: z
    .strictObject({
      provider: z.enum(['umami', 'posthog']),
      website: z.string().min(1).max(200),
    })
    .optional(),
  mcp: z.array(z.string().min(1).max(50)).max(30).optional(),
  /** How the project runs on its development server (D-020). */
  dev: z
    .strictObject({
      install: z.string().min(1).max(500).optional(),
      command: z.string().min(1).max(500),
      port: z.number().int().min(1024).max(65535),
    })
    .optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

export type ManifestReading =
  { ok: true; manifest: Manifest } | { ok: false; problems: { path: string; message: string }[] };

/** Reads `pono.yaml`; every problem names its place, so a person or an agent can fix the file. */
export function readManifest(content: string): ManifestReading {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    return {
      ok: false,
      problems: [{ path: '', message: `Not YAML: ${(error as Error).message.split('\n')[0]}` }],
    };
  }
  const release = (raw as { release?: { mode?: unknown } } | null)?.release;
  if (release && typeof release === 'object' && 'mode' in release)
    return {
      ok: false,
      problems: [
        {
          path: 'release.mode',
          message: 'The release mode lives in Pono, never in the repository (D-006).',
        },
      ],
    };
  const parsed = manifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** The canonical file: a schema line for editors, stable key order, no empty sections. */
export function writeManifest(manifest: Manifest): string {
  const clean = JSON.parse(JSON.stringify(manifestSchema.parse(manifest))) as Manifest;
  return `# yaml-language-server: $schema=${SCHEMA_URL}\n# Pono manifest: the project's truth, kept in its own repository.\n${stringify(clean, { lineWidth: 100 })}`;
}

/** The files a destructive migration was declared in (`release.declared_destructions`). */
export function declaredFiles(manifest: Manifest | null): string[] {
  return (manifest?.release?.declared_destructions ?? []).map((d) =>
    typeof d === 'string' ? d : d.file,
  );
}

// --- Adoption: a manifest pre-filled from what the repository and the providers already say ---

type DraftEnvironment = Partial<Record<'branch' | 'hosting' | 'site' | 'url', string | undefined>>;

export interface Draft {
  source: 'pono' | 'studio-project-yaml' | 'fluxio' | 'livio' | 'detection';
  name?: string;
  production?: DraftEnvironment;
  development?: DraftEnvironment;
  database?: { provider: string; project?: string; branches?: Record<string, string> };
}

/** The files an existing project may already describe itself in, read in this order. */
export const LEGACY_FILES = ['project.yaml', '.fluxio/project.json', 'stack.hcl'] as const;

export function readLegacy(path: (typeof LEGACY_FILES)[number], content: string): Draft | null {
  if (path === 'project.yaml') {
    try {
      const raw = parseYaml(content) as { name?: unknown } | null;
      return typeof raw?.name === 'string' && raw.name
        ? { source: 'studio-project-yaml', name: raw.name }
        : null;
    } catch {
      return null;
    }
  }
  if (path === '.fluxio/project.json') return readFluxio(content);
  return readLivio(content);
}

type Json = Record<string, unknown>;
const section = (o: Json, k: string): Json =>
  o[k] && typeof o[k] === 'object' ? (o[k] as Json) : {};
const text = (o: Json, k: string): string | undefined =>
  typeof o[k] === 'string' && o[k] ? (o[k] as string) : undefined;

function readFluxio(content: string): Draft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !('fluxioVersion' in raw)) return null;
  const o = raw as Json;
  const code = section(o, 'github');
  const site = section(o, 'netlify');
  const app = section(o, 'coolify');
  const neon = section(o, 'neon');
  const production = text(code, 'defaultBranch');
  const development = text(code, 'devBranch');
  const gitBranches = section(neon, 'branches');
  const branches: Record<string, string> = {};
  if (production && production in gitBranches) branches.production = production;
  if (development && development in gitBranches) branches.development = development;
  const draft: Draft = { source: 'fluxio' };
  const slug = text(o, 'slug');
  if (slug) draft.name = slug;
  if (text(site, 'siteId'))
    draft.production = compact({
      branch: production,
      hosting: 'netlify',
      site: text(site, 'siteId'),
      url: text(site, 'url'),
    });
  if (text(app, 'applicationUuid'))
    draft.development = compact({
      branch: development,
      hosting: 'coolify',
      site: text(app, 'applicationUuid'),
      url: text(app, 'devUrl'),
    });
  const projectId = text(neon, 'projectId');
  if (projectId)
    draft.database = {
      provider: 'neon',
      project: projectId,
      ...(Object.keys(branches).length ? { branches } : {}),
    };
  return draft;
}

/** Livio's `stack.hcl`: `block { key = "value" }`, flattened to `block.key`. */
function readLivio(content: string): Draft | null {
  const values = new Map<string, string>();
  const stack: string[] = [];
  const source = content
    .split('\n')
    .map((l) => l.split('#', 1)[0])
    .join('\n');
  for (const m of source.matchAll(/(\w+)\s*=\s*"([^"]*)"|(\w+)\s*\{|(\})/g)) {
    const [, key, value, block, closing] = m;
    if (block) stack.push(block);
    else if (closing) stack.pop();
    else if (key) values.set([...stack, key].join('.'), value ?? '');
  }
  if (![...values.keys()].some((k) => k === 'livio' || k.startsWith('livio.'))) return null;
  const draft: Draft = { source: 'livio' };
  const projectName = values.get('project.name');
  if (projectName) draft.name = projectName;
  const hosting = values.get('hosting.provider');
  if (hosting) draft.production = { hosting };
  const database = values.get('database.provider');
  if (database) {
    const branches: Record<string, string> = {};
    const prod = values.get('database.branches.prod');
    const dev = values.get('database.branches.dev');
    if (prod) branches.production = prod;
    if (dev) branches.development = dev;
    draft.database = {
      provider: database,
      ...(Object.keys(branches).length ? { branches } : {}),
    };
  }
  return draft;
}

function compact<T extends Record<string, string | undefined>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface Detected {
  repositoryName: string;
  defaultBranch: string;
  hosting: { provider: string; site: string; url: string | null; branch: string | null } | null;
  database: { provider: string; ref: string } | null;
}

/**
 * The manifest a project is adopted with. What the repository says wins; detection only completes
 * it, never overwrites it.
 */
export function prefill(detected: Detected, draft: Draft | null): Manifest {
  const production = {
    branch: draft?.production?.branch ?? detected.hosting?.branch ?? detected.defaultBranch,
    ...compact({
      hosting: draft?.production?.hosting ?? detected.hosting?.provider,
      site: draft?.production?.site ?? detected.hosting?.site,
      url: draft?.production?.url ?? detected.hosting?.url ?? undefined,
    }),
  };
  const manifest: Manifest = {
    version: 1,
    name: draft?.name ?? detected.repositoryName,
    environments: {
      production,
      ...(draft?.development ? { development: draft.development } : {}),
    },
  };
  const project = draft?.database?.project ?? detected.database?.ref;
  const provider = draft?.database?.provider ?? detected.database?.provider;
  if (provider && project)
    manifest.database = {
      provider,
      project,
      ...(draft?.database?.branches ? { branches: draft.database.branches } : {}),
    };
  return manifest;
}

// --- Skills: two families, and the repository's own conventions first ---

export type SkillFamily = 'safety' | 'opinion' | 'design';
export type ProjectOrigin = 'template' | 'adopted';

export interface SkillChoice {
  name: string;
  family: SkillFamily;
  active: boolean;
  /** Why it is on or off: what the person can change. */
  because: 'template' | 'safety_default' | 'chosen' | 'turned_off' | 'not_chosen';
}

/**
 * The skills of a project. Safety skills are on by default everywhere: turning them off removes no
 * guard, Pono still applies them. Opinion and design skills are on for a project launched from a
 * template, off for an adopted one: an experienced person keeps their own architecture.
 */
export function resolveSkills(
  catalog: { name: string; family: SkillFamily }[],
  origin: ProjectOrigin,
  templateSkills: string[],
  choice: Manifest['skills'] | undefined,
): SkillChoice[] {
  const use = new Set(choice?.use ?? []);
  const off = new Set(choice?.off ?? []);
  return catalog.map(({ name, family }) => {
    if (off.has(name)) return { name, family, active: false, because: 'turned_off' };
    if (use.has(name)) return { name, family, active: true, because: 'chosen' };
    if (origin === 'template' && templateSkills.includes(name))
      return { name, family, active: true, because: 'template' };
    if (family === 'safety') return { name, family, active: true, because: 'safety_default' };
    return { name, family, active: false, because: 'not_chosen' };
  });
}

/** The manifest as a JSON Schema, served at `SCHEMA_URL`: one source, the Zod schema above. */
export function manifestJsonSchema(): Record<string, unknown> {
  return {
    $id: SCHEMA_URL,
    title: 'Pono manifest (pono.yaml)',
    ...z.toJSONSchema(manifestSchema, { io: 'input' }),
  };
}
