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
  renderSkillFile,
  skillInput,
  templateGallery,
  type Catalog,
} from '../catalog/index.js';
import { launchProject, type LaunchDeps } from '../launch/index.js';
import { siteMetrics } from '../analytics/index.js';
import {
  codeOn,
  devStatus,
  jobOutput,
  LIMITS,
  previewLink,
  previewShot,
  pullChanges,
  pushChanges,
  runOn,
  startDev,
  stopDev,
} from '../devloop/index.js';
import { checkSecrets, listVariables, requestVariable, variableName } from '../variables/index.js';
import { activeCredentials, type Connectable } from '../connections/index.js';
import { LEVEL_GUIDANCE, LEVELS, levelOf, setLevel } from '../identity/index.js';
import { manifestView, proposeSkills } from '../manifest/index.js';
import { importProject, putOnline, refreshProject } from '../projects/application.js';
import { evaluateReleases, listReleases, requestRollback } from '../releases/index.js';
import {
  backupServer,
  listBackups,
  networkView,
  serversView,
  sleepServer,
  syncServers,
  wakeServer,
} from '../servers/index.js';
import { readUsage, usageView, type UsageDeps } from '../usage/index.js';
import { connectUrl, MISSING_BY_CODE, whatIsMissing } from './needs.js';
import { mcpUnauthorized } from './oauth.js';
import { recognize, type Candidate } from './recognize.js';

export interface McpDeps extends LaunchDeps, UsageDeps {
  catalog: Catalog;
  publicUrl: string;
  connectable: Connectable[];
}

const INSTRUCTIONS = `Pono is the person's workshop: their projects, what their subscriptions cost, a server for each
project, and releases that obey the rule they chose. When the person says « launch a project with
Pono », call get_profile and follow its guidance, then launch_project (suggest a template from list_templates first). When they say « let's
continue X », or « continue this project » inside a folder, call find_project with the name, or with
the folder's git remote as repository, then resume_project. A repository Pono does not know yet, in any
technology, joins with adopt_project. If find_project answers ambiguous, ask
the person which one; never guess. Never ask for a key in the conversation: keys are set in the
console. You never validate a release nor roll back: you propose, a person decides. Before
publishing, adding a database, counting visits or using AI, call what_is_missing: when a service is
missing, explain in plain words what it is for, give its link, and continue once it is connected.

You can code without any machine of your own: each project has a server where its repository lives
on the dev branch. Call start_dev once (it answers the preview address), then work there with
project_map, list_files, search_code, read_file, edit_file (or apply_patch for several files),
write_file and run_command. Read a file before you edit it: edit_file needs old_text as read. An
edit that breaks a file's syntax is refused; after a change, devServer shows the dev server's
errors: fix them before going on. undo_edit puts a file back. When dev_status says reloads: true the
preview follows the files by itself; otherwise call start_dev again after a change. You can see the
page yourself: preview_screenshot returns a capture (desktop or mobile) and the console errors.
Look at it after a visible change, then give the preview address to the person. Look at show_changes, then push_changes to save the work on
dev; propose_release when the person wants it in production.

The preview is private: its address opens for the person signed in to Pono. To show it to someone
else (a client, a friend), share_preview gives a link that lasts the hours chosen. Before a risky
step (a migration, a large rewrite, deleting files), call backup_server: a restore point the person
can return to from the console. You never restore yourself. When run_command answers blocked, the
server's network is limited: tell the person which domain is needed and that they add it in the
project's Network card (get_network shows what is allowed).`;

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

function json(value: unknown): Text {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** The console's address, for the links an agent gives the person (set once, at start). */
let publicBase = '';

async function guard(work: () => Promise<unknown>): Promise<Text> {
  try {
    return json(await work());
  } catch (error) {
    if (error instanceof AppError) {
      // A refusal for a missing service carries the link to connect it (D-029).
      const kind = MISSING_BY_CODE[error.code];
      const detail = kind
        ? {
            ...(error.detail ?? {}),
            connectUrl: connectUrl(publicBase, kind),
            say: `Tell the person, in plain words, to connect this service at ${connectUrl(publicBase, kind)}, then continue.`,
          }
        : error.detail;
      return { ...json(errorBody(error.code, error.message, detail)), isError: true };
    }
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
  publicBase = deps.publicUrl;
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
        name: z
          .string()
          .describe('Lowercase words joined by hyphens, as in the Agent Skills standard.'),
        family: z.enum(['opinion', 'design']),
        description: z
          .string()
          .describe('What it does and when to use it, at most 1024 characters.'),
        body: z.string().describe('The instructions (the body of SKILL.md), under 500 lines.'),
        files: z
          .record(z.string(), z.string())
          .optional()
          .describe('Other files by path: references/…, scripts/…, assets/…'),
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
            'A name in kebab-case, a description, a body, and files under references/, scripts/ or assets/.',
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

  /** The project's active skills, written on its server as SKILL.md folders (D-028). */
  async function installSkills(projectId: string) {
    const manifest = await manifestView(deps, actor, projectId);
    const known = (await catalog()).skills;
    const skills = manifest.skills
      .filter((s) => s.active)
      .flatMap((s) => known.filter((k) => k.name === s.name))
      .map((s) => ({ name: s.name, text: renderSkillFile(s), files: s.files ?? {} }));
    return codeOn(deps, actor, projectId, { op: 'skills', skills });
  }

  server.registerTool(
    'start_dev',
    {
      description:
        "Starts (or restarts) the project's dev server on its Pono server: repository fetched on `dev`, installed, run, its port published. Answers the preview address; it reloads by itself as files change.",
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) =>
      acting(async () => {
        const started = await startDev(deps, actor, projectId);
        const skills = await installSkills(projectId).catch(() => null);
        return { ...started, skills: skills?.installed ?? [] };
      }),
  );

  server.registerTool(
    'dev_status',
    {
      description:
        "The dev server: phase (installing, running…), what its port answers, branch and commit, changed files, the preview address and the logs' last lines. Show the preview address to the person.",
      inputSchema: { projectId: z.string(), lines: z.number().int().min(1).max(200).default(20) },
      annotations: read,
    },
    async ({ projectId, lines }) => guard(() => devStatus(deps, actor, projectId, lines)),
  );

  server.registerTool(
    'stop_dev',
    {
      description: "Stops the project's dev server; the files stay.",
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) =>
      acting(async () => {
        await stopDev(deps, actor, projectId);
        return { stopped: true };
      }),
  );

  server.registerTool(
    'pull_changes',
    {
      description:
        'Takes onto the server what was pushed to `dev` elsewhere (for example from your own machine); the dev server reloads.',
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) => acting(() => pullChanges(deps, actor, projectId)),
  );

  server.registerTool(
    'push_changes',
    {
      description:
        "Commits what changed on the server and pushes it to `dev`, after Pono's secrets check: a finding stops the push. Production is reached only by a proposal, under the project's release rule.",
      inputSchema: { projectId: z.string(), message: z.string().min(1).max(200) },
      annotations: act,
    },
    async ({ projectId, message }) => acting(() => pushChanges(deps, actor, projectId, message)),
  );

  const project = {
    projectId: z.string().describe('The project, from list_projects or find_project.'),
  };

  server.registerTool(
    'put_online',
    {
      description:
        "Creates the project's production site at the connected hosting (Netlify), linked to its repository: it builds now, then on every merge to the default branch. Call what_is_missing with goal publish first. Production still changes only through proposals, under the project's release rule. Give the person the production address.",
      inputSchema: project,
      annotations: act,
    },
    async ({ projectId }) => acting(() => putOnline(deps, actor, projectId)),
  );

  server.registerTool(
    'preview_screenshot',
    {
      description:
        "A capture of a page of the project's preview, taken by the browser on its server, as an image you can look at, with the page's HTTP answer and its console errors. Use it after a visible change to check what the person will see (device mobile for a phone).",
      inputSchema: {
        ...project,
        path: z.string().max(300).default('/'),
        device: z.enum(['desktop', 'mobile']).default('desktop'),
      },
      annotations: read,
    },
    async ({ projectId, path, device }) => {
      try {
        const shot = await previewShot(deps, actor, projectId, { path, device });
        return {
          content: [
            { type: 'image' as const, data: shot.image, mimeType: 'image/jpeg' },
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  path: shot.path,
                  device: shot.device,
                  status: shot.status,
                  consoleErrors: shot.errors,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return guard(() => Promise.reject(error));
      }
    },
  );

  server.registerTool(
    'share_preview',
    {
      description:
        "A link to the project's preview that someone without a Pono account can open, valid for the hours chosen (1 to 168), then closed by itself. Give it only to whom the person named.",
      inputSchema: { ...project, hours: z.number().int().min(1).max(168).default(24) },
      annotations: act,
    },
    async ({ projectId, hours }) => acting(() => previewLink(deps, actor, projectId, hours)),
  );

  server.registerTool(
    'get_network',
    {
      description:
        "Where the project's server may connect: open (anywhere) or limited (the registries, the code host, the connected services and the domains the person added). Only the person changes it, in the console.",
      inputSchema: project,
      annotations: read,
    },
    async ({ projectId }) =>
      guard(async () => ({
        ...(await networkView(deps, actor, projectId)),
        changeAt: `${deps.publicUrl}/projects/${projectId}`,
      })),
  );

  async function serverIdOf(projectId: string): Promise<string> {
    const status = (await projectStatus(deps, actor, projectId)) as { server_id: string | null };
    if (!status.server_id)
      throw new AppError('dev.no_server', 409, 'Give this project a server first.');
    return status.server_id;
  }

  server.registerTool(
    'list_backups',
    {
      description:
        "The server's restore points, newest first: the last seven nights and the last one taken on demand. Restoring is the person's decision, in the console.",
      inputSchema: project,
      annotations: read,
    },
    async ({ projectId }) =>
      guard(async () => ({
        ...(await listBackups(deps, actor, await serverIdOf(projectId))),
        restoreAt: `${deps.publicUrl}/projects/${projectId}`,
      })),
  );

  server.registerTool(
    'backup_server',
    {
      description:
        'Saves a restore point of the whole server now (files, installed packages, local data), without stopping it. Call it before a risky step. One every 15 minutes; it replaces the previous one taken on demand.',
      inputSchema: project,
      annotations: act,
    },
    async ({ projectId }) =>
      acting(async () => backupServer(deps, actor, await serverIdOf(projectId))),
  );

  server.registerTool(
    'list_files',
    {
      description:
        "The repository's files on the project's server (tracked and new, never ignored ones such as node_modules). Narrow with a folder and a glob such as src/**/*.tsx.",
      inputSchema: {
        ...project,
        path: z.string().optional().describe('A folder, relative to the repository.'),
        pattern: z.string().optional().describe('A glob on the path or the file name.'),
      },
      annotations: read,
    },
    async ({ projectId, path, pattern }) =>
      guard(() =>
        codeOn(deps, actor, projectId, {
          op: 'list',
          path: path ?? null,
          pattern: pattern ?? null,
        }),
      ),
  );

  server.registerTool(
    'read_file',
    {
      description: `A file of the repository on the project's server, its lines numbered. Long files: read them by ranges with offset and limit (at most ${LIMITS.readLines} lines).`,
      inputSchema: {
        ...project,
        path: z.string(),
        offset: z.number().int().min(1).default(1).describe('The first line, from 1.'),
        limit: z.number().int().min(1).max(LIMITS.readLines).default(LIMITS.readLines),
      },
      annotations: read,
    },
    async ({ projectId, path, offset, limit }) =>
      guard(() => codeOn(deps, actor, projectId, { op: 'read', path, offset, limit })),
  );

  server.registerTool(
    'search_code',
    {
      description:
        'Lines that match a regular expression in the repository, with file and line number. Narrow with a folder or a glob.',
      inputSchema: {
        ...project,
        pattern: z.string().min(1).max(500),
        path: z.string().optional(),
        glob: z.string().optional(),
        ignoreCase: z.boolean().default(false),
      },
      annotations: read,
    },
    async ({ projectId, pattern, path, glob, ignoreCase }) =>
      guard(() =>
        codeOn(deps, actor, projectId, {
          op: 'search',
          pattern,
          path: path ?? null,
          glob: glob ?? null,
          ignoreCase,
        }),
      ),
  );

  server.registerTool(
    'edit_file',
    {
      description:
        'Changes a file by exact replacements: each old_text must appear exactly once (or set replace_all), spaces and indentation included. All edits apply, or none. Answers the diff; dry_run shows it without writing.',
      inputSchema: {
        ...project,
        path: z.string(),
        edits: z
          .array(
            z.object({
              old_text: z.string().min(1),
              new_text: z.string(),
              replace_all: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(50),
        dry_run: z.boolean().default(false),
      },
      annotations: act,
    },
    async ({ projectId, path, edits, dry_run }) =>
      acting(() =>
        codeOn(deps, actor, projectId, {
          op: 'edit',
          path,
          dryRun: dry_run,
          edits: edits.map((e) => ({ old: e.old_text, new: e.new_text, all: e.replace_all })),
        }),
      ),
  );

  server.registerTool(
    'write_file',
    {
      description:
        'Creates a file, or replaces it whole (its folders are created). Prefer edit_file to change part of an existing file. Answers the diff.',
      inputSchema: { ...project, path: z.string(), content: z.string().max(LIMITS.writeChars) },
      annotations: act,
    },
    async ({ projectId, path, content }) =>
      acting(() => codeOn(deps, actor, projectId, { op: 'write', path, content })),
  );

  server.registerTool(
    'move_file',
    {
      description: 'Moves or renames a file; refused when the destination exists.',
      inputSchema: { ...project, path: z.string(), to: z.string() },
      annotations: act,
    },
    async ({ projectId, path, to }) =>
      acting(() => codeOn(deps, actor, projectId, { op: 'move', path, to })),
  );

  server.registerTool(
    'delete_file',
    {
      description: 'Deletes one file of the repository on the server (git keeps its history).',
      inputSchema: { ...project, path: z.string() },
      annotations: { ...act, destructiveHint: true },
    },
    async ({ projectId, path }) =>
      acting(() => codeOn(deps, actor, projectId, { op: 'delete', path })),
  );

  server.registerTool(
    'project_map',
    {
      description:
        'A map of the repository: each file with its line count and its top-level names (functions, classes, components). Read it first in a project you do not know, then read_file what matters. Narrow with a folder.',
      inputSchema: { ...project, path: z.string().optional() },
      annotations: read,
    },
    async ({ projectId, path }) =>
      guard(() => codeOn(deps, actor, projectId, { op: 'map', path: path ?? null })),
  );

  server.registerTool(
    'apply_patch',
    {
      description:
        'Changes several files at once, all or nothing, in the apply_patch format: *** Begin Patch, then *** Add File: <path> (lines starting with +), *** Delete File: <path>, or *** Update File: <path> (optionally *** Move to: <path>) with @@ chunks of context lines (space), removed lines (-) and added lines (+), then *** End Patch. Answers the diff.',
      inputSchema: { ...project, patch: z.string().min(1).max(LIMITS.writeChars) },
      annotations: act,
    },
    async ({ projectId, patch }) =>
      acting(() => codeOn(deps, actor, projectId, { op: 'patch', patch })),
  );

  server.registerTool(
    'undo_edit',
    {
      description:
        'Puts a file back as it was before its last change by Pono (edit, write, patch, move or delete); up to 10 steps back per file.',
      inputSchema: { ...project, path: z.string() },
      annotations: act,
    },
    async ({ projectId, path }) =>
      acting(() => codeOn(deps, actor, projectId, { op: 'undo', path })),
  );

  server.registerTool(
    'show_changes',
    {
      description:
        'What changed on the server since the last push: the files and the diff. Look at it before push_changes.',
      inputSchema: project,
      annotations: read,
    },
    async ({ projectId }) => guard(() => codeOn(deps, actor, projectId, { op: 'changes' })),
  );

  server.registerTool(
    'run_command',
    {
      description: `Runs a shell command in the repository on the project's server: install a package, run the tests, build, lint. At most ${LIMITS.seconds} seconds; its output's end is kept. With background, it answers a job at once: read it with command_output. The dev server itself is start_dev's.`,
      inputSchema: {
        ...project,
        command: z.string().min(1).max(4000),
        timeout_seconds: z.number().int().min(1).max(LIMITS.seconds).default(120),
        background: z.boolean().default(false),
      },
      annotations: act,
    },
    async ({ projectId, command, timeout_seconds, background }) =>
      acting(() => runOn(deps, actor, projectId, command, timeout_seconds, background)),
  );

  server.registerTool(
    'command_output',
    {
      description:
        "A background command's output so far, and its exit code once it ended (124: its time ran out).",
      inputSchema: { ...project, job: z.string() },
      annotations: read,
    },
    async ({ projectId, job }) => guard(() => jobOutput(deps, actor, projectId, job)),
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
        'The templates a project can start from, by category (presence, commerce, services, tools, software, free); a variant (parent set) is made for a narrower case. Each says what it will ask to connect (needs) and what it brought so far (value: launched, live). Suggest the variant closest to what the person described.',
      annotations: read,
    },
    async () =>
      guard(async () =>
        (await templateGallery(deps.pool, (await catalog()).templates)).map((t) => ({
          id: t.id,
          category: t.category,
          ...(t.parent ? { parent: t.parent } : {}),
          name: t.name,
          description: t.description,
          stack: t.stack,
          skills: t.skills,
          needs: t.needs ?? [],
          value: t.value,
          scope: t.scope,
        })),
      ),
  );

  server.registerTool(
    'what_is_missing',
    {
      description:
        'Before an action, what the person must still connect: for code, preview, publish (put online), database, visits or ai. When something is missing, tell the person in plain words what it is for, give the link, wait, then continue. Never ask for a key in the chat.',
      inputSchema: {
        goal: z.enum(['code', 'preview', 'publish', 'database', 'visits', 'ai']),
      },
      annotations: read,
    },
    async ({ goal }) =>
      guard(() =>
        whatIsMissing(
          { pool: deps.pool, connectable: deps.connectable, publicUrl: deps.publicUrl },
          actor,
          goal,
        ),
      ),
  );

  server.registerTool(
    'list_skills',
    {
      description:
        "Every skill this organization can use (Pono's, the operator's, its own): name, family and when to use it. Read one with get_skill only when its description fits the task.",
      annotations: read,
    },
    async () =>
      guard(async () => ({
        skills: (await catalog()).skills.map((s) => ({
          name: s.name,
          family: s.family,
          description: s.description,
          scope: s.scope,
          files: Object.keys(s.files ?? {}),
        })),
      })),
  );

  server.registerTool(
    'get_skill',
    {
      description:
        'A skill: its instructions (SKILL.md) and the list of its other files (references, scripts, assets). Read those with get_skill_file only when the instructions point to them.',
      inputSchema: { name: z.string() },
      annotations: read,
    },
    async ({ name }) =>
      guard(async () => {
        const skill = (await catalog()).skills.find((s) => s.name === name);
        if (!skill) throw new AppError('skill.not_found', 404, 'No such skill.');
        const { files, ...rest } = skill;
        return { ...rest, files: Object.keys(files ?? {}) };
      }),
  );

  server.registerTool(
    'get_skill_file',
    {
      description: "One of a skill's files (a reference, a script, an asset), as its text.",
      inputSchema: { name: z.string(), path: z.string() },
      annotations: read,
    },
    async ({ name, path }) =>
      guard(async () => {
        const skill = (await catalog()).skills.find((s) => s.name === name);
        const content = skill?.files?.[path];
        if (content === undefined)
          throw new AppError('skill.file_not_found', 404, 'No such file in this skill.', {
            files: Object.keys(skill?.files ?? {}),
          });
        return { name, path, content };
      }),
  );

  server.registerTool(
    'install_skills',
    {
      description:
        "Writes the project's active skills, as SKILL.md folders, on its server (.claude/skills and .agents/skills, kept out of git), where coding agents read them natively. start_dev does it too.",
      inputSchema: { projectId: z.string() },
      annotations: act,
    },
    async ({ projectId }) => acting(() => installSkills(projectId)),
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
