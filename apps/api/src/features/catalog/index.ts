import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization, type Pool } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { record } from '../journal/index.js';

export type SkillFamily = 'safety' | 'opinion' | 'design';
/** Where an entry comes from (D-016): Pono's files, the operator, an organization, or shared. */
export type Scope = 'pono' | 'official' | 'private' | 'proposed' | 'shared' | 'refused';

export interface Template {
  id: string;
  category: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  stack: string[];
  skills: string[];
  /** A template repository the project is generated from (`owner/name`); none: an empty one. */
  starter?: string;
  scope?: Scope;
}

export interface Skill {
  name: string;
  family: SkillFamily;
  description: string;
  body: string;
  scope?: Scope;
}

export interface Catalog {
  templates: Template[];
  skills: Skill[];
}

const CATALOG_DIR = new URL('../../../catalog/', import.meta.url);

/** `## name · family`, then `_description_`, then the body, until the next `## `. */
export function parseSkills(markdown: string): Skill[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [nameLine, ...rest] = section.split('\n');
      const descriptionIndex = rest.findIndex((l) => /^_.+_$/.test(l.trim()));
      const description = descriptionIndex >= 0 ? rest[descriptionIndex]!.trim().slice(1, -1) : '';
      const body = rest
        .slice(descriptionIndex + 1)
        .join('\n')
        .trim();
      const [name, family] = nameLine!.split('·').map((x) => x.trim());
      if (family !== 'safety' && family !== 'opinion' && family !== 'design')
        throw new Error(`Skill ${name} has no family (safety, opinion or design).`);
      return { name: name!, family, description, body };
    });
}

function checkSkills(catalog: Catalog): void {
  const known = new Set(catalog.skills.map((s) => s.name));
  for (const t of catalog.templates) {
    const missing = t.skills.filter((s) => !known.has(s));
    if (missing.length)
      throw new Error(`Template ${t.id} names unknown skills: ${missing.join(', ')}`);
  }
}

/** The templates and skills shipped with Pono (phase 6); read once, at start. */
export function loadCatalog(dir: URL = CATALOG_DIR): Catalog {
  const templates = JSON.parse(readFileSync(new URL('templates.json', dir), 'utf8')) as Template[];
  const skills = parseSkills(readFileSync(new URL('skills.md', dir), 'utf8'));
  const catalog = {
    templates: templates.map((t) => ({ ...t, scope: 'pono' as const })),
    skills: skills.map((s) => ({ ...s, scope: 'pono' as const })),
  };
  checkSkills(catalog);
  return catalog;
}

// --- Validation of what an organization or the operator brings ---

const entryName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/);
const words = z.object({ fr: z.string().min(1).max(300), en: z.string().min(1).max(300) });

export const templateInput = z.strictObject({
  id: entryName,
  category: z.enum(['free', 'services', 'commerce', 'software', 'presence']),
  name: words,
  description: words,
  stack: z.array(z.string().min(1).max(40)).max(12),
  skills: z.array(entryName).max(30),
  starter: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
});

export const skillInput = z.strictObject({
  name: entryName,
  family: z.enum(['safety', 'opinion', 'design']),
  description: z.string().min(10).max(300),
  body: z.string().min(20).max(20_000),
});

interface EntryRow {
  id: string;
  organization_id: string | null;
  kind: 'template' | 'skill';
  name: string;
  body: Template | Skill;
  sharing: Exclude<Scope, 'pono'>;
}

/**
 * The catalog an organization sees: Pono's files, then the operator's official entries, the shared
 * ones, and its own. Its own private entries never take the name of an official one.
 */
export async function catalogFor(
  pool: Pool,
  base: Catalog,
  organizationId: string,
): Promise<Catalog> {
  const rows = await withOrganization(
    pool,
    organizationId,
    async (client) =>
      (
        await client.query<EntryRow>(
          "SELECT id, organization_id, kind, name, body, sharing FROM catalog_entries WHERE sharing <> 'refused' OR organization_id = pono_current_organization() ORDER BY sharing = 'official' DESC, name",
        )
      ).rows,
  );
  const templates = new Map(base.templates.map((t) => [t.id, t]));
  const skills = new Map(base.skills.map((s) => [s.name, s]));
  for (const row of rows) {
    const visible = row.organization_id === organizationId || row.sharing !== 'refused';
    if (!visible) continue;
    if (row.kind === 'template') {
      const t = row.body as Template;
      if (!templates.has(t.id) || row.sharing === 'official')
        templates.set(t.id, { ...t, scope: row.sharing });
    } else {
      const s = row.body as Skill;
      if (!skills.has(s.name) || row.sharing === 'official')
        skills.set(s.name, { ...s, scope: row.sharing });
    }
  }
  return { templates: [...templates.values()], skills: [...skills.values()] };
}

export interface CatalogDeps {
  pool: Pool;
  catalog: Catalog;
}

/** A private skill of the organization: opinion or design; safety stays Pono's. */
export async function createSkill(
  deps: CatalogDeps,
  actor: Actor,
  input: z.infer<typeof skillInput>,
): Promise<Skill> {
  if (input.family === 'safety')
    throw new AppError('catalog.safety_reserved', 403, 'Safety skills are Pono’s own.');
  const visible = await catalogFor(deps.pool, deps.catalog, actor.organizationId);
  const existing = visible.skills.find((s) => s.name === input.name);
  if (existing && existing.scope !== 'private' && existing.scope !== 'refused')
    throw new AppError('catalog.name_taken', 409, 'A skill of that name exists.');
  await save(deps, actor, 'skill', input.name, input);
  return { ...input, scope: 'private' };
}

/** A private template; its skills must exist in what the organization sees. */
export async function createTemplate(
  deps: CatalogDeps,
  actor: Actor,
  input: z.infer<typeof templateInput>,
): Promise<Template> {
  const visible = await catalogFor(deps.pool, deps.catalog, actor.organizationId);
  const known = new Set(visible.skills.map((s) => s.name));
  const missing = input.skills.filter((s) => !known.has(s));
  if (missing.length)
    throw new AppError('skill.not_found', 404, 'No such skill.', { skills: missing });
  const existing = visible.templates.find((t) => t.id === input.id);
  if (existing && existing.scope !== 'private' && existing.scope !== 'refused')
    throw new AppError('catalog.name_taken', 409, 'A template of that name exists.');
  await save(deps, actor, 'template', input.id, input);
  const { starter, ...rest } = input;
  return { ...rest, ...(starter ? { starter } : {}), scope: 'private' };
}

async function save(
  deps: CatalogDeps,
  actor: Actor,
  kind: 'template' | 'skill',
  name: string,
  body: unknown,
): Promise<void> {
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    await client.query(
      `INSERT INTO catalog_entries (organization_id, kind, name, body, sharing, created_by)
       VALUES ($1, $2, $3, $4, 'private', $5)
       ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name)
       DO UPDATE SET body = excluded.body, sharing = 'private', updated_at = now()`,
      [actor.organizationId, kind, name, JSON.stringify(body), actor.personId],
    );
    await record(client, {
      organizationId: actor.organizationId,
      action: `catalog.${kind}_saved`,
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { name },
    });
  });
}

/** Asks the operator to share an entry with everyone; it stays private until approved. */
export async function proposeSharing(
  deps: CatalogDeps,
  actor: Actor,
  kind: 'template' | 'skill',
  name: string,
): Promise<void> {
  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const updated = await client.query(
      "UPDATE catalog_entries SET sharing = 'proposed', updated_at = now() WHERE organization_id = $1 AND kind = $2 AND name = $3 AND sharing IN ('private', 'refused')",
      [actor.organizationId, kind, name],
    );
    if (!updated.rowCount) throw new AppError('catalog.not_found', 404, 'No such private entry.');
    await record(client, {
      organizationId: actor.organizationId,
      action: 'catalog.sharing_proposed',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { kind, name },
    });
  });
}

async function remove(
  deps: CatalogDeps,
  actor: Actor,
  kind: 'template' | 'skill',
  name: string,
): Promise<void> {
  const deleted = await withOrganization(deps.pool, actor.organizationId, (client) =>
    client.query(
      'DELETE FROM catalog_entries WHERE organization_id = $1 AND kind = $2 AND name = $3',
      [actor.organizationId, kind, name],
    ),
  );
  if (!deleted.rowCount) throw new AppError('catalog.not_found', 404, 'No such private entry.');
}

/** A template repository's description: `pono-template.yaml` and `.pono/skills/*.md`. */
export function readTemplateRepository(
  repository: string,
  templateFile: string,
  skillFiles: string[],
): { template: z.infer<typeof templateInput>; skills: Skill[] } {
  let raw: unknown;
  try {
    raw = parseYaml(templateFile);
  } catch {
    throw new AppError('catalog.unreadable', 422, 'pono-template.yaml is not YAML.');
  }
  const parsed = templateInput.safeParse({ ...(raw as object), starter: repository });
  if (!parsed.success)
    throw new AppError('catalog.unreadable', 422, 'pono-template.yaml does not read.', {
      problems: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  const skills = skillFiles.flatMap((content) => {
    try {
      return parseSkills(content);
    } catch (error) {
      throw new AppError('catalog.unreadable', 422, (error as Error).message);
    }
  });
  for (const s of skills) {
    const ok = skillInput.safeParse(s);
    if (!ok.success)
      throw new AppError('catalog.unreadable', 422, `Skill ${s.name} does not read.`, {
        problems: ok.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
  }
  return { template: parsed.data, skills };
}

const kindOf = (raw: string): 'template' | 'skill' => {
  if (raw === 'templates') return 'template';
  if (raw === 'skills') return 'skill';
  throw new AppError('route.not_found', 404, 'No such route.');
};

const card = ({ name, family, description, scope }: Skill) => ({
  name,
  family,
  description,
  scope,
});

/** `/v1/catalog/*`: the same catalog for the console and the agents. */
export function catalogRoutes(deps: CatalogDeps): Hono<AppEnv> {
  const of = (actor: Actor) => catalogFor(deps.pool, deps.catalog, actor.organizationId);
  return new Hono<AppEnv>()
    .get('/templates', async (c) => c.json({ templates: (await of(c.var.actor)).templates }))
    .get('/skills', async (c) => c.json({ skills: (await of(c.var.actor)).skills.map(card) }))
    .get('/skills/:name', async (c) => {
      const skill = (await of(c.var.actor)).skills.find((s) => s.name === c.req.param('name'));
      if (!skill) throw new AppError('skill.not_found', 404, 'No such skill.');
      return c.json({ skill });
    })
    .post('/skills', async (c) => {
      const body = skillInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        throw new AppError('request.invalid', 400, 'Expected name, family, description, body.');
      return c.json({ skill: await createSkill(deps, c.var.actor, body.data) }, 201);
    })
    .post('/templates', async (c) => {
      const body = templateInput.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new AppError('request.invalid', 400, 'Expected a template.');
      return c.json({ template: await createTemplate(deps, c.var.actor, body.data) }, 201);
    })
    .post('/:kind/:name/share', async (c) => {
      await proposeSharing(deps, c.var.actor, kindOf(c.req.param('kind')), c.req.param('name'));
      return c.body(null, 204);
    })
    .delete('/:kind/:name', async (c) => {
      await remove(deps, c.var.actor, kindOf(c.req.param('kind')), c.req.param('name'));
      return c.body(null, 204);
    });
}
