import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Actor, AppEnv } from '../../platform/context.js';
import { withOrganization } from '../../platform/db.js';
import { AppError, errorBody } from '../../platform/errors.js';
import { hashToken } from '../../platform/secrets.js';
import {
  catalogFor,
  createSkill,
  createTemplate,
  proposeSharing,
  skillInput,
  type Catalog,
} from '../catalog/index.js';
import { launchProject, type LaunchDeps } from '../launch/index.js';
import { siteMetrics } from '../analytics/index.js';
import { checkSecrets, listVariables, requestVariable, variableName } from '../variables/index.js';
import { activeCredentials } from '../connections/index.js';
import { LEVEL_GUIDANCE, LEVELS, levelOf, setLevel } from '../identity/index.js';
import { manifestView, proposeSkills } from '../manifest/index.js';
import { importProject, refreshProject } from '../projects/application.js';
import { evaluateReleases, listReleases, requestRollback } from '../releases/index.js';
import { serversView, sleepServer, syncServers, wakeServer } from '../servers/index.js';
import { readUsage, usageView, type UsageDeps } from '../usage/index.js';
import { mcpUnauthorized } from './oauth.js';
import { recognize, type Candidate } from './recognize.js';

export interface McpDeps extends LaunchDeps, UsageDeps {
  catalog: Catalog;
  publicUrl: string;
}

const INSTRUCTIONS = `Pono is the person's workshop: their projects, what their subscriptions cost, a server for each
project, and releases that obey the rule they chose. When the person says « launch a project with
Pono », call get_profile and follow its guidance, then launch_project (suggest a template from list_templates first). When they say « let's
continue X », or « continue this project » inside a folder, call find_project with the name, or with
the folder's git remote as repository, then resume_project. A repository Pono does not know yet, in any
technology, joins with adopt_project. If find_project answers ambiguous, ask
the person which one; never guess. Never ask for a key in the conversation: keys are set in the
console. You never validate a release nor roll back: you propose, a person decides.`;

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

function json(value: unknown): Text {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function guard(work: () => Promise<unknown>): Promise<Text> {
  try {
    return json(await work());
  } catch (error) {
    if (error instanceof AppError)
      return { ...json(errorBody(error.code, error.message, error.detail)), isError: true };
    throw error;
  }
}

async function codeHostOf(deps: McpDeps, actor: Actor) {
  const creds = await withOrganization(deps.pool, actor.organizationId, (client) =>
    activeCredentials(client, deps.sealer, 'code_host'),
  );
  for (const host of deps.adapters.codeHosts) {
    const credential = creds.find((c) => c.provider === host.id)?.credential;
    if (credential) return { host, credential };
  }
  throw new AppError('connection.code_host_missing', 409, 'Connect your code host first.');
}

async function candidates(deps: McpDeps, actor: Actor): Promise<Candidate[]> {
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      repository: string;
      last: Date | null;
    }>(
      'SELECT id, name, repository, greatest(last_commit_at, refreshed_at) AS last FROM projects ORDER BY name',
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      repository: r.repository,
      lastActivity: r.last,
    }));
  });
}

async function projectStatus(deps: McpDeps, actor: Actor, projectId: string) {
  return withOrganization(deps.pool, actor.organizationId, async (client) => {
    const { rows } = await client.query(
      `SELECT p.id, p.name, p.repository, p.default_branch, p.state, p.state_reason, p.production_url, p.link_status,
         p.hosting_provider, p.hosting_status, p.database_provider, p.database_status, p.release_mode, p.release_mode_until,
         s.id AS server_id, s.status AS server_status, s.url AS server_url, s.agent AS server_agent
       FROM projects p LEFT JOIN project_servers s ON s.project_id = p.id AND s.status <> 'released' WHERE p.id = $1`,
      [projectId],
    );
    if (!rows[0]) throw new AppError('project.not_found', 404, 'No such project.');
    return rows[0];
  });
}

/** One MCP server per request, bound to the agent's token: the same rights as its person (principle 5). */
function buildServer(deps: McpDeps, actor: Actor, scope: 'read' | 'act'): McpServer {
  const server = new McpServer({ name: 'pono', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const act = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
  const acting = (work: () => Promise<unknown>) =>
    scope === 'act'
      ? guard(work)
      : guard(async () =>
          Promise.reject(
            new AppError('agent.scope_insufficient', 403, 'This agent may only read.'),
          ),
        );

  server.registerTool(
    'get_profile',
    {
      description:
        'How much the person wants to decide, and how to talk to them. Call it first in a conversation about a new project.',
      annotations: read,
    },
    async () =>
      guard(async () => {
        const level = await levelOf(deps.pool, actor.personId);
        return { login: actor.login, level, guidance: LEVEL_GUIDANCE[level ?? 'unknown'] };
      }),
  );

  server.registerTool(
    'set_level',
    {
      description:
        'Saves how much the person wants to decide, as they said it: guided (do it all for me), choosing (a few options), expert (my own technology).',
      inputSchema: { level: z.enum(LEVELS) },
      annotations: act,
    },
    async ({ level }) =>
      acting(async () => {
        await setLevel(deps.pool, actor.personId, level);
        return { level, guidance: LEVEL_GUIDANCE[level] };
      }),
  );

  server.registerTool(
    'list_projects',
    { description: "The workshop's projects with their state.", annotations: read },
    async () =>
      guard(() =>
        withOrganization(
          deps.pool,
          actor.organizationId,
          async (client) =>
            (
              await client.query(
                'SELECT id, name, repository, state, state_reason, production_url, link_status FROM projects ORDER BY name',
              )
            ).rows,
        ),
      ),
  );

  server.registerTool(
    'find_project',
    {
      description:
        'Recognizes the project a conversation means, by a name the person said or the git remote of the current folder.',
      inputSchema: { query: z.string().optional(), repository: z.string().optional() },
      annotations: read,
    },
    async ({ query, repository }) =>
      guard(async () => recognize(await candidates(deps, actor), { query, repository })),
  );

  server.registerTool(
    'resume_project',
    {
      description:
        'Everything to continue a project: its state, its server, its release mode, the skills to follow.',
      inputSchema: { projectId: z.string() },
      annotations: read,
    },
    async ({ projectId }) =>
      guard(async () => {
        const project = await projectStatus(deps, actor, projectId);
        const manifest = await manifestView(deps, actor, projectId);
        const active = manifest.skills.filter((s) => s.active);
        const known = (await catalog()).skills;
        return {
          project,
          manifest: {
            status: manifest.status,
            problems: manifest.problems,
            proposalUrl: manifest.proposalUrl,
            local: manifest.manifest?.skills?.local ?? null,
          },
          skills: active.map((s) => ({
            name: s.name,
            family: s.family,
            description: known.find((c) => c.name === s.name)?.description ?? '',
          })),
          next: [
            'Read each active skill with get_skill before changing code; the repository’s own conventions (CLAUDE.md, AGENTS.md, the local skills folder) come first.',
            manifest.status === 'proposed'
              ? 'pono.yaml is proposed in a pull request: tell the person to complete and merge it.'
              : manifest.status === 'invalid'
                ? 'pono.yaml does not read: fix the problems listed, in a proposal.'
                : null,
            'If the server sleeps, call wake_server.',
          ].filter(Boolean),
        };
      }),
  );

  server.registerTool(
    'create_skill',
    {
      description:
        "Keeps a way of doing as a skill of the organization (private; family opinion or design). Write it in the person's words; it is read by every agent of the organization.",
      inputSchema: {
        name: z.string(),
        family: z.enum(['opinion', 'design']),
        description: z.string(),
        body: z.string(),
      },
      annotations: act,
    },
    async (input) =>
      acting(async () => {
        const parsed = skillInput.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            'request.invalid',
            400,
            'A name in kebab-case, a description, a body.',
          );
        return createSkill(deps, actor, parsed.data);
      }),
  );

  server.registerTool(
    'save_as_template',
    {
      description:
        "Makes a project the organization's own template: its repository becomes the starter new projects are generated from, with its skills. Private until the person asks to share it.",
      inputSchema: {
        projectId: z.string(),
        id: z.string(),
        category: z.enum(['free', 'services', 'commerce', 'software', 'presence']).default('free'),
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(300),
        stack: z.array(z.string()).default([]),
      },
      annotations: act,
    },
    async (input) =>
      acting(async () => {
        const project = await projectStatus(deps, actor, input.projectId);
        const manifest = await manifestView(deps, actor, input.projectId);
        const skills = manifest.skills.filter((s) => s.active).map((s) => s.name);
        const { host, credential } = await codeHostOf(deps, actor);
        await host.markAsTemplate(credential, String(project.repository));
        return createTemplate(deps, actor, {
          id: input.id,
          category: input.category,
          name: { fr: input.name, en: input.name },
          description: { fr: input.description, en: input.description },
          stack: input.stack,
          skills,
          starter: String(project.repository),
        });
      }),
  );

  server.registerTool(
    'share_with_everyone',
    {
      description:
        "Asks Pono's operator to share a private template or skill with everyone. Nothing is shared until they approve it.",
      inputSchema: { kind: z.enum(['template', 'skill']), name: z.string() },
      annotations: act,
    },
    async ({ kind, name }) =>
      acting(async () => {
        await proposeSharing(deps, actor, kind, name);
        return { proposed: true, kind, name };
      }),
  );

  server.registerTool(
    'list_variables',
    {
      description:
        "A project's development variables, by name, and whether each is set. Values are never shown: they reach the project's server only.",
      inputSchema: { projectId: z.string() },
      annotations: read,
    },
    async ({ projectId }) => guard(() => listVariables(deps, actor, projectId)),
  );

  server.registerTool(
    'request_variable',
    {
      description:
        'Asks the person for a development variable the project needs (a name in CAPITALS and why). They set the value in the console; never ask for a value in the conversation.',
      inputSchema: { projectId: z.string(), name: z.string(), reason: z.string().max(280) },
      annotations: act,
    },
    async ({ projectId, name, reason }) =>
      acting(async () => {
        const parsed = variableName.safeParse(name);
        if (!parsed.success)
          throw new AppError(
            'variable.invalid_name',
            400,
            'A name in CAPITALS, not starting with PONO_.',
          );
        return requestVariable(deps, actor, projectId, parsed.data, reason);
      }),
  );

  server.registerTool(
    'check_secrets',
    {
      description:
        'Checks files for secrets before you commit them: the same rules as the release guard. Call it on every batch of files you are about to commit; fix every finding first.',
      inputSchema: {
        files: z.array(z.object({ path: z.string(), content: z.string().max(500_000) })).max(200),
      },
      annotations: read,
    },
    async ({ files }) => guard(async () => checkSecrets(files)),
  );

  server.registerTool(
    'adopt_project',
    {
      description:
        'Puts an existing repository under Pono, whatever its technology: the project joins the workshop and Pono proposes its pono.yaml in a pull request, pre-filled. Use with the git remote of the current folder.',
      inputSchema: { repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/) },
      annotations: act,
    },
    async ({ repository }) =>
      acting(async () => {
        const projectId = await importProject(deps, actor, repository);
        return { projectId, manifest: await manifestView(deps, actor, projectId) };
      }),
  );

  server.registerTool(
    'set_skills',
    {
      description:
        'Turns skills on or off for a project. Pono proposes the change of pono.yaml in a pull request; the person merges it.',
      inputSchema: {
        projectId: z.string(),
        use: z.array(z.string()).default([]),
        off: z.array(z.string()).default([]),
      },
      annotations: act,
    },
    async ({ projectId, use, off }) =>
      acting(() => proposeSkills(deps, actor, projectId, { use, off })),
  );

  server.registerTool(
    'read_usage',
    {
      description:
        'What the subscriptions cost this month, every figure with its source, and the open alerts.',
      annotations: read,
    },
    async () => guard(() => withOrganization(deps.pool, actor.organizationId, usageView)),
  );

  const catalog = () => catalogFor(deps.pool, deps.catalog, actor.organizationId);

  server.registerTool(
    'read_site_metrics',
    {
      description:
        "A project's visits over the last days (pageviews, visitors, top pages and sources), measured at its analytics provider, or why they are unavailable.",
      inputSchema: { projectId: z.string(), days: z.number().int().min(1).max(90).default(30) },
      annotations: read,
    },
    async ({ projectId, days }) =>
      guard(() =>
        siteMetrics({ ...deps, analytics: deps.analytics ?? [] }, actor, projectId, days),
      ),
  );

  server.registerTool(
    'list_templates',
    {
      description:
        "The templates a project can start from: Pono's, the operator's, the shared ones and the organization's own.",
      annotations: read,
    },
    async () =>
      guard(async () =>
        (await catalog()).templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          stack: t.stack,
          skills: t.skills,
          scope: t.scope,
        })),
      ),
  );

  server.registerTool(
    'get_skill',
    {
      description: 'A skill Pono serves: how to do a thing right on a Pono project.',
      inputSchema: { name: z.string() },
      annotations: read,
    },
    async ({ name }) =>
      guard(async () => {
        const skill = (await catalog()).skills.find((s) => s.name === name);
        if (!skill) throw new AppError('skill.not_found', 404, 'No such skill.');
        return skill;
      }),
  );

  server.registerTool(
    'list_servers',
    {
      description: 'The project servers, and how many the plan lets run at once.',
      annotations: read,
    },
    async () =>
      guard(async () => {
        await syncServers(deps, actor.organizationId);
        return withOrganization(deps.pool, actor.organizationId, serversView);
      }),
  );

  server.registerTool(
    'list_releases',
    {
      description: "A project's proposals and their verdicts.",
      inputSchema: { projectId: z.string() },
      annotations: read,
    },
    async ({ projectId }) => guard(() => listReleases(deps, actor, projectId)),
  );

  server.registerTool(
    'launch_project',
    {
      description:
        'Launches a project: a repository in the person’s account, its manifest, and its server with the template’s skills. When the plan is full, the answer names the servers: ask which one to put to sleep, then call again with sleepServerId.',
      inputSchema: {
        template: z.string(),
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
        agent: z.enum(['claude-code', 'codex', 'opencode', 'none']).default('claude-code'),
        private: z.boolean().default(true),
        sleepServerId: z.string().optional(),
      },
      annotations: act,
    },
    async (input) =>
      acting(() =>
        launchProject(deps, actor, {
          template: input.template,
          name: input.name,
          agent: input.agent,
          private: input.private,
          ...(input.sleepServerId ? { sleepServerId: input.sleepServerId } : {}),
        }),
      ),
  );

  server.registerTool(
    'wake_server',
    {
      description: "Wakes a project's server (it counts against the plan while awake).",
      inputSchema: { serverId: z.string(), sleepServerId: z.string().optional() },
      annotations: act,
    },
    async ({ serverId, sleepServerId }) =>
      acting(async () => {
        await wakeServer(deps, actor, serverId, sleepServerId);
        return { woken: serverId };
      }),
  );

  server.registerTool(
    'sleep_server',
    {
      description: "Puts a project's server to sleep; its files stay.",
      inputSchema: { serverId: z.string() },
      annotations: act,
    },
    async ({ serverId }) =>
      acting(async () => {
        await sleepServer(deps, actor, serverId);
        return { slept: serverId };
      }),
  );

  server.registerTool(
    'refresh_project',
    {
      description: "Reads a project's state again at its providers.",
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) =>
      acting(async () => {
        await refreshProject(deps, actor, projectId);
        return projectStatus(deps, actor, projectId);
      }),
  );

  server.registerTool(
    'refresh_usage',
    { description: 'Reads what every connected provider consumed.', annotations: act },
    async () => acting(async () => ({ readings: await readUsage(deps, actor) })),
  );

  server.registerTool(
    'propose_release',
    {
      description:
        "Evaluates a project's open proposals; what ships next follows the project's mode, chosen by the person.",
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) => acting(() => evaluateReleases(deps, actor, projectId)),
  );

  server.registerTool(
    'request_rollback',
    {
      description: 'Asks the person to roll production back; they decide in the console.',
      inputSchema: { projectId: z.string(), reason: z.string().max(280) },
      annotations: act,
    },
    async ({ projectId, reason }) =>
      acting(async () => {
        await requestRollback(deps, actor, projectId, reason);
        return { requested: true };
      }),
  );

  return server;
}

/** `/mcp`: Streamable HTTP, stateless, behind the agent's bearer token (D-008). */
export function mcpHandler(deps: McpDeps) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const bearer = c.req.header('authorization')?.match(/^Bearer pono_(\S+)$/)?.[1];
    if (!bearer) return mcpUnauthorized(deps.publicUrl);
    const { rows } = await deps.pool.query<{
      id: string;
      organization_id: string;
      person_id: string;
      name: string;
      scope: 'read' | 'act';
      login: string;
    }>('SELECT * FROM agent_by_token($1)', [hashToken(bearer)]);
    const agent = rows[0];
    if (!agent) return mcpUnauthorized(deps.publicUrl);
    const actor: Actor = {
      personId: agent.person_id,
      login: agent.login,
      name: agent.name,
      organizationId: agent.organization_id,
      channel: 'mcp',
    };
    const server = buildServer(deps, actor, agent.scope);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
}
