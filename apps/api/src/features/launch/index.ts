import { Hono } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { ProviderError } from '../../platform/http.js';
import { catalogFor, type Catalog } from '../catalog/index.js';
import { activeCredentials } from '../connections/index.js';
import { record } from '../journal/index.js';
import { writeManifest } from '../manifest/domain.js';
import { importProject, type ProjectsDeps } from '../projects/application.js';
import {
  allocateServer,
  serversView,
  type Agent,
  type ServersDeps,
  type ServerView,
} from '../servers/index.js';

/** The Impeccable version Pono reviewed; changed only by a commit to Pono. */
export const IMPECCABLE_VERSION = '4.8.0';

export interface LaunchDeps extends ProjectsDeps, ServersDeps {
  catalog: Catalog;
}

export interface LaunchInput {
  template: string;
  name: string;
  agent: Agent;
  private: boolean;
  sleepServerId?: string;
}

export interface Launched {
  projectId: string;
  repository: string;
  server: ServerView;
  /** From the request to the server answering: the product's one indicator (MANDAT). */
  durationMs: number;
}

/** The manifest written at the root of every launched project: the truth lives in the repository. */
export function manifest(input: {
  name: string;
  template: string;
  skills: string[];
  agent: Agent;
}): string {
  return writeManifest({
    version: 1,
    name: input.name,
    template: input.template,
    agent: input.agent,
    environments: {
      production: { branch: 'main' },
      development: { branch: 'dev', server: 'pono' },
    },
    skills: { use: input.skills, local: '.pono/skills/' },
    release: { declared_destructions: [] },
  });
}

/**
 * One sentence, and the project exists: a repository in the person's account with its manifest,
 * the project in the workshop, and its server with the template's skills (phase 4 and 6).
 * The place is checked first, so nothing is created when the plan is full.
 */
export async function launchProject(
  deps: LaunchDeps,
  actor: Actor,
  input: LaunchInput,
): Promise<Launched> {
  const started = Date.now();
  const catalog = await catalogFor(deps.pool, deps.catalog, actor.organizationId);
  const template = catalog.templates.find((t) => t.id === input.template);
  if (!template) throw new AppError('template.not_found', 404, 'No such template.');

  await withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { limit, active, servers } = await serversView(client);
    if (active >= limit && !input.sleepServerId) {
      throw new AppError(
        'servers.limit_reached',
        409,
        'Every active server of the plan is taken.',
        {
          limit,
          active: servers
            .filter(
              (s) => s.status === 'running' || s.status === 'provisioning' || s.status === 'waking',
            )
            .map((s) => ({ id: s.id, projectName: s.projectName })),
        },
      );
    }
  });

  const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
    activeCredentials(client, deps.sealer, 'code_host'),
  );
  const host = deps.adapters.codeHosts.find((h) => creds.some((c) => c.provider === h.id));
  const credential = creds.find((c) => c.provider === host?.id)?.credential;
  if (!host || !credential)
    throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');

  let repository;
  try {
    repository = await host.createRepository(credential, {
      name: input.name,
      private: input.private,
      description: template.description.en,
      ...(template.starter ? { starter: template.starter } : {}),
      files: {
        'pono.yaml': manifest({
          name: input.name,
          template: template.id,
          skills: template.skills,
          agent: input.agent,
        }),
      },
    });
  } catch (error) {
    if (error instanceof ProviderError && error.status === 409)
      throw new AppError('launch.name_taken', 409, 'A repository of that name exists.');
    throw error;
  }

  const projectId = await importProject(deps, actor, repository.fullName, {
    origin: 'template',
    template: template.id,
  });
  const server = await allocateServer(deps, actor, projectId, {
    agent: input.agent,
    env: {
      PONO_SKILLS: template.skills.join(','),
      PONO_TEMPLATE: template.id,
      // Pinned and reviewed design skills (D-016): the agent installs this exact version.
      ...(template.skills.includes('impeccable') ? { PONO_IMPECCABLE: IMPECCABLE_VERSION } : {}),
    },
    ...(input.sleepServerId ? { sleepServerId: input.sleepServerId } : {}),
  });
  const durationMs = Date.now() - started;
  await withOrganization(deps.pool, actor.organizationId, (client) =>
    record(client, {
      organizationId: actor.organizationId,
      projectId,
      action: 'project.launched',
      actorPerson: actor.personId,
      channel: actor.channel,
      detail: { template: template.id, durationMs },
    }),
  );
  return { projectId, repository: repository.fullName, server, durationMs };
}

export const launchBody = z.object({
  template: z.string().min(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
  agent: z.enum(['claude-code', 'codex', 'opencode', 'none']).default('claude-code'),
  private: z.boolean().default(true),
  sleepServerId: z.uuid().optional(),
});

/** `POST /v1/launch`. */
export function launchRoutes(deps: LaunchDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post('/', async (c) => {
    const body = launchBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      throw new AppError('request.invalid', 400, 'Expected a template and a name in lowercase.');
    const { sleepServerId, ...rest } = body.data;
    return c.json(
      await launchProject(deps, c.var.actor, {
        ...rest,
        ...(sleepServerId ? { sleepServerId } : {}),
      }),
      201,
    );
  });
}
