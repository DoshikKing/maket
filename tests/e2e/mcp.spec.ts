import 'dotenv/config';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID, scryptSync, createHash } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
import { mcpCapabilities, readOnlyMcpCapabilities } from '../../src/lib/mcp-permissions';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const emails: string[] = [];
const addresses: string[] = [];
async function login(request: APIRequestContext) {
  const email = `mcp-${randomUUID()}@example.com`,
    password = 'Mcp-test-password-42',
    salt = randomBytes(16).toString('hex');
  emails.push(email);
  const address = `mcp-test-${randomUUID()}`;
  addresses.push(address);
  const user = await db.user.create({
    data: {
      email,
      name: 'MCP tester',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      settings: { theme: 'dark', autosave: false, snapToGrid: true },
    },
  });
  expect(
    (
      await request.post('/api/auth/login', {
        data: { email, password },
        headers: { 'X-Forwarded-For': address },
      })
    ).status(),
  ).toBe(200);
  const areas = await (await request.get('/api/workspaces')).json();
  return { user, area: areas[0], password };
}
async function key(
  request: APIRequestContext,
  workspaceId: string,
  capabilities: readonly string[] = mcpCapabilities,
) {
  const response = await request.post('/api/mcp-keys', {
    data: { name: 'Integration test', grants: [{ workspaceId, capabilities }], expiresAt: null },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function connect(secret: string) {
  const client = new Client({ name: 'maket-integration-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost:3000/api/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }),
  );
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return JSON.parse((result.content as { type: string; text: string }[])[0].text);
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.rateLimit.deleteMany({ where: { key: { in: emails.map((e) => `login:${e}`) } } });
  await db.rateLimit.deleteMany({
    where: { key: { in: addresses.map((a) => `login:address:${a}`) } },
  });
  await db.$disconnect();
});

test('MCP SDK creates linked entities, reads properties and exchanges every supported file format', async ({
  request,
}) => {
  test.setTimeout(180000);
  const { area, user } = await login(request),
    k = await key(request, area.id),
    client = await connect(k.secret);
  try {
    const stored = await db.mcpKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(stored.tokenHash).toBe(createHash('sha256').update(k.secret).digest('hex'));
    const listed = await (await request.get('/api/mcp-keys')).text();
    expect(listed).not.toContain(k.secret);
    expect(listed).not.toContain(stored.tokenHash);
    expect((await client.listTools()).tools.length).toBe(11);
    expect((await call(client, 'maket_list_workspaces', {})).workspaces[0].id).toBe(area.id);
    const folder = await call(client, 'maket_create_object', {
      workspaceId: area.id,
      kind: 'folder',
      name: 'API folder',
    });
    const first = await call(client, 'maket_create_object', {
      workspaceId: area.id,
      parentId: folder.id,
      name: 'Сервер',
      attributes: { department: 'ИТ' },
    });
    const second = await call(client, 'maket_create_object', {
      workspaceId: area.id,
      parentId: folder.id,
      name: 'Клиент',
    });
    const relation = await call(client, 'maket_create_relation', {
      workspaceId: area.id,
      name: 'API',
      sourceId: first.id,
      targetId: second.id,
      relationType: 'запрос',
    });
    expect(relation.sourceId).toBe(first.id);
    expect(
      (
        await call(client, 'maket_search_objects', {
          workspaceId: area.id,
          query: first.id.toUpperCase(),
        })
      ).items[0].id,
    ).toBe(first.id);
    const page = await call(client, 'maket_list_objects', {
      workspaceId: area.id,
      parentId: folder.id,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = await call(client, 'maket_list_objects', {
      workspaceId: area.id,
      parentId: folder.id,
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(
      (
        await call(client, 'maket_get_objects', {
          workspaceId: area.id,
          ids: [first.id, relation.id],
        })
      ).items[0].attributes.department,
    ).toBe('ИТ');
    const diagram = await call(client, 'maket_create_diagram', {
      workspaceId: area.id,
      name: 'Диаграмма MCP',
      notationIds: ['builtin', 'builtin-bpmn', 'builtin-uml'],
    });
    expect(diagram.bindings).toHaveLength(3);
    const binding = diagram.bindings[0];
    const placed = await call(client, 'maket_add_representation', {
      workspaceId: area.id,
      diagramId: diagram.id,
      objectId: first.id,
      revision: diagram.revision,
      bindingId: binding.id,
      typeId: binding.nodeTypes[0].id,
      position: { x: 100, y: 100 },
    });
    expect(placed.representations[0].objectId).toBe(first.id);
    expect((await call(client, 'maket_list_diagrams', { workspaceId: area.id })).items[0].id).toBe(
      diagram.id,
    );
    for (const format of ['json', 'drawio', 'png', 'jpeg', 'pdf']) {
      const exported = await client.callTool({
        name: 'maket_export_diagram',
        arguments: { workspaceId: area.id, diagramId: diagram.id, format },
      });
      expect(exported.isError, JSON.stringify(exported)).not.toBe(true);
      const file = (
        exported.content as { type: string; resource: { blob: string; mimeType: string } }[]
      ).find((c) => c.type === 'resource')!.resource;
      const bytes = Buffer.from(file.blob, 'base64');
      expect(bytes.length).toBeGreaterThan(100);
      if (format === 'png') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      if (format === 'jpeg') expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
      if (format === 'pdf') expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
      if (format === 'json' || format === 'drawio') {
        const imported = await call(client, 'maket_import_diagram', {
          workspaceId: area.id,
          format,
          filename: `MCP import.${format}`,
          content: file.blob,
          encoding: 'base64',
        });
        if (format === 'drawio') {
          expect(imported.folder.parentId).toBeNull();
          expect(imported.folder.name).toBe('MCP import');
          expect(imported.diagrams).toHaveLength(1);
        } else expect(imported.diagramId).toBeTruthy();
      }
    }
    expect(
      await db.workspaceEvent.count({
        where: {
          spaceId: area.id,
          userId: user.id,
          userName: { contains: 'MCP: Integration test' },
        },
      }),
    ).toBeGreaterThan(0);
  } finally {
    await client.close();
  }
});

test('MCP capabilities and workspace scopes cannot bypass current membership, leases or revocation', async ({
  request,
}) => {
  const { area, user } = await login(request);
  const other = await db.modelSpace.create({ data: { ownerId: user.id, name: 'Not granted' } });
  const k = await key(request, area.id, readOnlyMcpCapabilities),
    client = await connect(k.secret);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('maket_create_object');
    expect(names).not.toContain('maket_export_diagram');
    const denied = await client.callTool({
      name: 'maket_list_objects',
      arguments: { workspaceId: other.id },
    });
    expect(denied.isError).toBe(true);
    const unknown = await client.callTool({
      name: 'maket_create_object',
      arguments: { workspaceId: area.id, name: 'Forbidden' },
    });
    expect(unknown.isError).toBe(true);
    await request.delete(`/api/mcp-keys/${k.id}`);
    await expect(client.listTools()).rejects.toThrow(/недействителен/);
  } finally {
    await client.close();
  }
  // Cookie sessions and query tokens never authenticate MCP.
  expect(
    (
      await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    ).status(),
  ).toBe(401);
  const writeKey = await key(request, area.id),
    writeClient = await connect(writeKey.secret);
  try {
    const obj = await call(writeClient, 'maket_create_object', {
      workspaceId: area.id,
      name: 'Locked parent',
    });
    await db.workspaceLock.create({
      data: {
        spaceId: area.id,
        userId: user.id,
        userName: 'Browser',
        clientId: 'browser-client',
        leaseId: randomUUID(),
        rootId: obj.id,
        targetId: obj.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const locked = await writeClient.callTool({
      name: 'maket_create_object',
      arguments: { workspaceId: area.id, name: 'Blocked child', parentId: obj.id },
    });
    expect(locked.isError).toBe(true);
    expect(JSON.stringify(locked)).toContain('423');
    await db.workspaceLock.deleteMany({ where: { spaceId: area.id } });
    await db.mcpKey.update({
      where: { id: writeKey.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(writeClient.listTools()).rejects.toThrow(/недействителен/);
  } finally {
    await writeClient.close();
  }
});

test('MCP shared workspace rights follow role changes and membership removal', async ({
  request,
}) => {
  const { user } = await login(request);
  const owner = await db.user.create({
    data: {
      email: `mcp-${randomUUID()}@example.com`,
      name: 'Other owner',
      emailVerified: true,
      passwordHash: 'unusable',
    },
  });
  emails.push(owner.email);
  const shared = await db.modelSpace.create({
    data: { ownerId: owner.id, name: 'Invited workspace' },
  });
  await db.workspaceMember.create({
    data: { spaceId: shared.id, userId: user.id, role: 'editor' },
  });
  const k = await key(request, shared.id),
    client = await connect(k.secret);
  try {
    await call(client, 'maket_create_object', { workspaceId: shared.id, name: 'Shared object' });
    await db.workspaceMember.update({
      where: { spaceId_userId: { spaceId: shared.id, userId: user.id } },
      data: { role: 'viewer' },
    });
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(
      'maket_create_object',
    );
    const denied = await client.callTool({
      name: 'maket_create_object',
      arguments: { workspaceId: shared.id, name: 'Denied' },
    });
    expect(denied.isError).toBe(true);
    await db.workspaceMember.delete({
      where: { spaceId_userId: { spaceId: shared.id, userId: user.id } },
    });
    expect((await client.listTools()).tools).toHaveLength(0);
  } finally {
    await client.close();
  }
});

test('settings creates a scoped key, edits grants and revokes it without exposing the secret again', async ({
  page,
  request,
}) => {
  await login(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto('/settings');
  const section = page.locator('.mcp-settings');
  await section.getByRole('button', { name: 'Создать MCP-ключ' }).click();
  await section.getByLabel('Название ключа', { exact: true }).fill('Desktop model');
  await section.getByLabel('Основная рабочая область', { exact: true }).check();
  await expect(section.getByLabel('Поиск объектов', { exact: true })).toBeChecked();
  await expect(section.getByLabel('Создание связей', { exact: true })).not.toBeChecked();
  await section.getByRole('button', { name: 'Сохранить MCP-ключ' }).click();
  await expect(section.getByLabel('Новый MCP-ключ')).toHaveValue(/^maket_mcp_/);
  await section.getByRole('button', { name: 'Скрыть ключ' }).click();
  await section.getByRole('button', { name: 'Права', exact: true }).click();
  await section.getByLabel('Экспорт PNG', { exact: true }).check();
  await section.getByRole('button', { name: 'Сохранить MCP-ключ' }).click();
  await expect(section.getByLabel('Новый MCP-ключ')).toHaveCount(0);
  await section.getByRole('button', { name: 'Отозвать', exact: true }).click();
  await expect(section.locator('.mcp-key')).toHaveCount(0);
});

test('key edits enforce per-format grants, scoped roles and password revocation on subsequent requests', async ({
  request,
}) => {
  const { user, area, password } = await login(request);
  const k = await key(request, area.id),
    client = await connect(k.secret);
  try {
    const object = await call(client, 'maket_create_object', {
      workspaceId: area.id,
      name: 'Allowed parent',
    });
    const edited = await request.patch(`/api/mcp-keys/${k.id}`, {
      data: {
        name: k.name,
        revision: k.revision,
        grants: [{ workspaceId: area.id, capabilities: ['objects.list', 'diagrams.export.png'] }],
        expiresAt: null,
      },
    });
    expect(edited.status()).toBe(200);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).not.toContain('maket_get_objects');
    expect(
      tools.find((t) => t.name === 'maket_export_diagram')?.inputSchema.properties?.format,
    ).toMatchObject({ enum: ['png'] });
    const denied = await client.callTool({
      name: 'maket_export_diagram',
      arguments: { workspaceId: area.id, diagramId: 'nonexistent', format: 'json' },
    });
    expect(denied.isError).toBe(true);
    expect(
      (
        await request.patch(`/api/mcp-keys/${k.id}`, {
          data: { name: k.name, revision: k.revision, grants: k.grants, expiresAt: null },
        })
      ).status(),
    ).toBe(409);
    // Restrict the current user to one parent in a workspace belonging to another owner.
    const owner = await db.user.create({
      data: {
        email: `mcp-${randomUUID()}@example.com`,
        name: 'Scoped owner',
        passwordHash: 'unusable',
        emailVerified: true,
      },
    });
    emails.push(owner.email);
    await db.modelSpace.update({ where: { id: area.id }, data: { ownerId: owner.id } });
    const role = await db.workspaceRole.create({
      data: {
        spaceId: area.id,
        name: 'Scoped creator',
        actions: ['read', 'create'],
        elementIds: [object.id],
      },
    });
    await db.workspaceMember.create({ data: { spaceId: area.id, userId: user.id, role: role.id } });
    const scoped = await key(request, area.id, ['objects.create', 'diagrams.import.json']),
      scopedClient = await connect(scoped.secret);
    try {
      await call(scopedClient, 'maket_create_object', {
        workspaceId: area.id,
        name: 'Allowed child',
        parentId: object.id,
      });
      expect(
        (
          await scopedClient.callTool({
            name: 'maket_create_object',
            arguments: { workspaceId: area.id, name: 'Forbidden root' },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await scopedClient.callTool({
            name: 'maket_import_diagram',
            arguments: { workspaceId: area.id, format: 'json', filename: 'x.json', content: '{}' },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await scopedClient.close();
    }
    expect(
      (
        await request.post('/api/password', {
          data: { currentPassword: password, password: 'New-mcp-password-42' },
        })
      ).status(),
    ).toBe(200);
    expect(await db.mcpKey.count({ where: { ownerId: user.id } })).toBe(0);
    await expect(client.listTools()).rejects.toThrow(/недействителен/);
  } finally {
    await client.close();
  }
});

test('MCP transport rejects cross-site, oversized, deeply nested and batched requests', async ({
  request,
}) => {
  const { area } = await login(request),
    k = await key(request, area.id, readOnlyMcpCapabilities);
  const headers = {
    Authorization: `Bearer ${k.secret}`,
    Accept: 'application/json, text/event-stream',
  };
  const message = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  expect(
    (
      await request.post('/api/mcp', {
        headers: { ...headers, Origin: 'https://untrusted.example' },
        data: message,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/mcp', {
        headers: { ...headers, 'Content-Type': 'text/plain' },
        data: 'invalid',
      })
    ).status(),
  ).toBe(415);
  expect(
    (await request.post('/api/mcp', { headers, data: { huge: 'x'.repeat(2_000_001) } })).status(),
  ).toBe(413);
  let nested: unknown = 1;
  for (let i = 0; i < 40; i++) nested = { a: nested };
  expect((await request.post('/api/mcp', { headers, data: nested })).status()).toBe(400);
  expect((await request.post('/api/mcp', { headers, data: [message] })).status()).toBe(400);
});
