import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { AppEnv } from '../../platform/context.js';
import { AppError } from '../../platform/errors.js';

export interface Template {
  id: string;
  category: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  stack: string[];
  skills: string[];
}

export interface Skill {
  name: string;
  description: string;
  body: string;
}

export interface Catalog {
  templates: Template[];
  skills: Skill[];
}

const CATALOG_DIR = new URL('../../../catalog/', import.meta.url);

/** `## name`, then `_description_`, then the body, until the next `## `. */
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
      return { name: nameLine!.trim(), description, body };
    });
}

/** The templates and skills Pono serves (phase 6); read once, at start. */
export function loadCatalog(dir: URL = CATALOG_DIR): Catalog {
  const templates = JSON.parse(readFileSync(new URL('templates.json', dir), 'utf8')) as Template[];
  const skills = parseSkills(readFileSync(new URL('skills.md', dir), 'utf8'));
  const known = new Set(skills.map((s) => s.name));
  for (const t of templates) {
    const missing = t.skills.filter((s) => !known.has(s));
    if (missing.length)
      throw new Error(`Template ${t.id} names unknown skills: ${missing.join(', ')}`);
  }
  return { templates, skills };
}

/** `/v1/catalog/*`: the same catalog for the console and the agents. */
export function catalogRoutes(catalog: Catalog): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/templates', (c) => c.json({ templates: catalog.templates }))
    .get('/skills', (c) =>
      c.json({ skills: catalog.skills.map(({ name, description }) => ({ name, description })) }),
    )
    .get('/skills/:name', (c) => {
      const skill = catalog.skills.find((s) => s.name === c.req.param('name'));
      if (!skill) throw new AppError('skill.not_found', 404, 'No such skill.');
      return c.json({ skill });
    });
}
