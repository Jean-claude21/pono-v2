import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recognize, repositoryOf } from '../src/features/agents/index.js';
import { call, signIn, testApp, type TestApp } from './support/app.js';

let t: TestApp;
beforeAll(() => {
  t = testApp();
});
afterAll(async () => t.pool.end());

/** An MCP client speaking to the API in memory, with an agent token. */
async function agent(token: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://pono.test/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) =>
      Promise.resolve(
        t.app.request(String(url).replace('http://pono.test', ''), init as RequestInit),
      ),
  });
  await client.connect(transport);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { error: result.isError === true, body: JSON.parse(result.content[0]!.text) };
}

async function workshop(scope: 'read' | 'act') {
  const cookie = await signIn(t, `m${randomUUID().slice(0, 8)}`);
  await call(t, cookie, '/v1/connections', {
    method: 'POST',
    body: { provider: 'code', fields: { token: 'good' } },
  });
  for (const name of [
    `lectio-${randomUUID().slice(0, 4)}`,
    `boutiqflow-${randomUUID().slice(0, 4)}`,
  ]) {
    t.world.repositories.push({
      fullName: `jc/${name}`,
      name,
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    await call(t, cookie, '/v1/projects', { method: 'POST', body: { repository: `jc/${name}` } });
  }
  const created = await (
    await call(t, cookie, '/v1/agents', { method: 'POST', body: { name: 'Claude Code', scope } })
  ).json();
  return { cookie, token: created.token as string, agentId: created.id as string };
}

describe('recognition (D-008)', () => {
  const projects = [
    {
      id: '1',
      name: 'lectio-reads',
      repository: 'Jean-claude21/lectio-reads',
      lastActivity: new Date('2026-11-10'),
    },
    {
      id: '2',
      name: 'lectio',
      repository: 'kete-africa/lectio',
      lastActivity: new Date('2026-09-01'),
    },
    { id: '3', name: 'nyatefe', repository: 'Jean-claude21/nyatefe', lastActivity: null },
  ];
  it('reads a git remote', () => {
    expect(repositoryOf('git@github.com:Jean-claude21/Lectio-Reads.git')).toBe(
      'jean-claude21/lectio-reads',
    );
    expect(repositoryOf('https://github.com/Jean-claude21/nyatefe/')).toBe('jean-claude21/nyatefe');
    expect(repositoryOf('lectio')).toBeNull();
  });
  it('finds by the folder’s repository first, then by name', () => {
    expect(
      recognize(projects, {
        repository: 'git@github.com:Jean-claude21/nyatefe.git',
        query: 'lectio',
      }),
    ).toMatchObject({ kind: 'found', project: { id: '3' }, by: 'repository' });
    expect(recognize(projects, { query: 'Nyatefé' })).toMatchObject({
      kind: 'found',
      project: { id: '3' },
      by: 'name',
    });
    expect(recognize(projects, { query: 'lectio' })).toMatchObject({
      kind: 'found',
      project: { id: '2' },
      by: 'name',
    });
  });
  it('asks when two projects answer, and offers the recent ones when none does', () => {
    expect(recognize(projects, { query: 'lect' })).toMatchObject({ kind: 'ambiguous' });
    const none = recognize(projects, { query: 'barflow' });
    expect(none).toMatchObject({ kind: 'none' });
    if (none.kind === 'none') expect(none.recent[0]!.id).toBe('1');
  });
});

describe('Pono over MCP (phase 3)', () => {
  it('refuses a call without a valid token', async () => {
    const res = await t.app.request('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer pono_forged', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('shows the token once, keeps only its hash, and lists the agent', async () => {
    const { cookie, token } = await workshop('read');
    expect(token).toMatch(/^pono_/);
    const list = await (await call(t, cookie, '/v1/agents')).text();
    expect(list).toContain('Claude Code');
    expect(list).not.toContain(token.slice(5));
  });

  it('lists its tools with their annotations, and reads the workshop', async () => {
    const { token } = await workshop('read');
    const client = await agent(token);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toEqual(
      expect.arrayContaining(['find_project', 'resume_project', 'launch_project', 'read_usage']),
    );
    expect(tools.find((x) => x.name === 'list_projects')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((x) => x.name === 'launch_project')!.annotations?.readOnlyHint).toBe(false);
    const { body } = await tool(client, 'list_projects');
    expect(body).toHaveLength(2);
    await client.close();
  });

  it('recognizes « on continue lectio » and resumes the project', async () => {
    const { token } = await workshop('read');
    const client = await agent(token);
    const found = (await tool(client, 'find_project', { query: 'lectio' })).body;
    expect(found.kind).toBe('found');
    const resumed = (await tool(client, 'resume_project', { projectId: found.project.id })).body;
    expect(resumed.project.name).toMatch(/^lectio-/);
    expect(resumed.skills.map((s: { name: string }) => s.name)).toContain('pono-basics');
    await client.close();
  });

  it('refuses to act with a read-only token', async () => {
    const { token } = await workshop('read');
    const client = await agent(token);
    const res = await tool(client, 'launch_project', {
      template: 'blank',
      name: `x-${randomUUID().slice(0, 6)}`,
    });
    expect(res.error).toBe(true);
    expect(res.body.error.code).toBe('agent.scope_insufficient');
    await client.close();
  });

  it('launches a project from a conversation, journaled as the agent', async () => {
    const { cookie, token } = await workshop('act');
    const client = await agent(token);
    const name = `rdv-${randomUUID().slice(0, 6)}`;
    const launched = (await tool(client, 'launch_project', { template: 'booking', name })).body;
    expect(launched.server.status).toBe('running');
    const detail = await (await call(t, cookie, `/v1/projects/${launched.projectId}`)).json();
    expect(
      detail.journal.find((j: { action: string }) => j.action === 'project.launched').channel,
    ).toBe('mcp');
    const full = await tool(client, 'launch_project', {
      template: 'blank',
      name: `y-${randomUUID().slice(0, 6)}`,
    });
    expect(full.body.error.code).toBe('servers.limit_reached');
    expect(full.body.error.detail.active[0].projectName).toBe(name);
    await client.close();
  });

  it('adopts a repository in any technology from its folder, and proposes skills in the file', async () => {
    const { token } = await workshop('act');
    const client = await agent(token);
    const name = `go-${randomUUID().slice(0, 6)}`;
    t.world.repositories.push({
      fullName: `jc/${name}`,
      name,
      defaultBranch: 'main',
      url: '',
      private: true,
      pushedAt: null,
    });
    t.world.files.set(`jc/${name}`, { 'go.mod': 'module x\n' });
    const adopted = (await tool(client, 'adopt_project', { repository: `jc/${name}` })).body;
    expect(adopted.manifest.status).toBe('proposed');
    const resumed = (await tool(client, 'resume_project', { projectId: adopted.projectId })).body;
    const names = resumed.skills.map((s: { name: string }) => s.name);
    expect(names).toContain('safe-migrations');
    expect(names).not.toContain('pono-stack');
    expect(resumed.next.join(' ')).toContain('merge');
    const set = await tool(client, 'set_skills', {
      projectId: adopted.projectId,
      use: ['impeccable'],
    });
    expect(set.body.url).toContain('/pull/');
    await client.close();
  });

  it('cannot reach another workshop, and stops working once cut', async () => {
    const a = await workshop('act');
    const b = await workshop('read');
    const client = await agent(b.token);
    const theirs = (await call(t, a.cookie, '/v1/projects').then((r) => r.json())).projects[0].id;
    expect((await tool(client, 'resume_project', { projectId: theirs })).body.error.code).toBe(
      'project.not_found',
    );
    await client.close();
    expect((await call(t, b.cookie, `/v1/agents/${b.agentId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    await expect(agent(b.token)).rejects.toThrow();
  });
});

describe('the person’s level (D-015)', () => {
  it('is asked once, saved by the console or the agent, and guides the agent', async () => {
    const { cookie, token } = await workshop('act');
    expect((await (await call(t, cookie, '/v1/me')).json()).person.level).toBeNull();
    const client = await agent(token);
    const unknown = (await tool(client, 'get_profile')).body;
    expect(unknown.level).toBeNull();
    expect(unknown.guidance).toContain('set_level');
    const saved = (await tool(client, 'set_level', { level: 'guided' })).body;
    expect(saved.guidance).toContain('never about technology');
    expect((await (await call(t, cookie, '/v1/me')).json()).person.level).toBe('guided');
    expect(
      (await call(t, cookie, '/v1/me/level', { method: 'PUT', body: { level: 'expert' } })).status,
    ).toBe(204);
    expect((await tool(client, 'get_profile')).body.level).toBe('expert');
    expect(
      (await call(t, cookie, '/v1/me/level', { method: 'PUT', body: { level: 'boss' } })).status,
    ).toBe(400);
    await client.close();
  });
});
