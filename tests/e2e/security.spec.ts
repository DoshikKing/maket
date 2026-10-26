import 'dotenv/config';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { databaseConfig } from '../../scripts/database-config.mjs';
const { connectionString, schema } = databaseConfig();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
const users: string[] = [];
const limits: string[] = [];
async function login(client: APIRequestContext) {
  const email = `security-${randomUUID()}@example.com`;
  const password = 'Security-test-password-42',
    salt = randomBytes(16).toString('hex');
  const user = await db.user.create({
    data: {
      email,
      name: 'Security test',
      emailVerified: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    },
  });
  users.push(user.id);
  limits.push(`login:${email}`);
  const address = '192.0.2.205';
  limits.push(`login:address:${address}`);
  expect(
    (
      await client.post('/api/auth/login', {
        data: { email, password },
        headers: { 'X-Forwarded-For': address },
      })
    ).status(),
  ).toBe(200);
  return user;
}
async function call(
  client: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  status = 200,
) {
  const r = await client.fetch(`/api/${path}`, { method, data });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
}
test.afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.rateLimit.deleteMany({ where: { key: { in: limits } } });
  await db.$disconnect();
});

test('share capabilities are only visible to authorized publishers and links respect revocation', async ({
  playwright,
}) => {
  const owner = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const viewer = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const stranger = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(owner);
    const guest = await login(viewer);
    const outsider = await login(stranger);
    const area = (await call(owner, 'workspaces'))[0];
    const scope = { 'X-Maket-Workspace': area.id };
    const member = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      storageState: await viewer.storageState(),
      extraHTTPHeaders: scope,
    });
    const foreign = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      storageState: await stranger.storageState(),
      extraHTTPHeaders: scope,
    });
    try {
      await call(owner, 'collaboration/members', 'POST', { email: guest.email, role: 'viewer' });
      const object = await call(
        owner,
        'objects',
        'POST',
        { name: 'Shared', attributes: { shareToken: 'ordinary attribute' } },
        201,
      );
      let d = await call(owner, 'diagrams', 'POST', { name: 'Shared diagram' }, 201);
      d = await call(
        owner,
        `diagrams/${d.id}/representations`,
        'POST',
        {
          revision: d.revision,
          bindingId: d.document.bindings[0].id,
          objectId: object.id,
          typeId: 'process',
          position: { x: 0, y: 0 },
        },
        201,
      );
      const sharing = await call(owner, `diagrams/${d.id}/share`, 'POST', { enabled: true });
      const os = await call(owner, `objects/${object.id}/share`, 'POST', { enabled: true });
      expect(sharing.path).toContain('/view/');
      expect(os.path).toContain(`/view/object/${object.id}/`);
      const token = sharing.path.split('/').at(-1),
        objectToken = os.path.split('/').at(-1);
      for (const path of [`diagrams/${d.id}/share`, `objects/${object.id}/share`])
        await call(member, path, 'GET', undefined, 403);
      const list = await call(member, 'diagrams');
      const detail = await call(member, `diagrams/${d.id}`);
      const history = await call(member, `diagrams/${d.id}/history?number=${d.revision}`);
      for (const payload of [list, detail, history]) {
        expect(JSON.stringify(payload)).not.toContain(token);
        expect(JSON.stringify(payload)).not.toContain(objectToken);
      }
      expect(detail).not.toHaveProperty('shareToken');
      expect(
        detail.document.objects.find((o: { id: string }) => o.id === object.id).attributes
          .shareToken,
      ).toBe('ordinary attribute');
      await call(foreign, `diagrams/${d.id}`, 'GET', undefined, 404);
      await call(foreign, `objects/${object.id}`, 'GET', undefined, 404);
      await call(foreign, 'model', 'GET', undefined, 404);
      expect(outsider.id).not.toBe(guest.id);
      // An editor cannot recover the token from a write response either.
      await call(owner, 'collaboration/members', 'PATCH', { email: guest.email, role: 'editor' });
      const renamed = await call(member, `diagrams/${d.id}`, 'PATCH', { name: 'Renamed' });
      expect(renamed).not.toHaveProperty('shareToken');
      expect(JSON.stringify(renamed)).not.toContain(token);
      const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const pub = await call(anonymous, `public/${token}`);
        expect(pub.document.modelSpaceId).toBe('public');
        expect(pub).not.toHaveProperty('ownerId');
        expect(
          (await call(anonymous, `public-objects/${object.id}/${objectToken}`)).attributes
            .shareToken,
        ).toBe('ordinary attribute');
        await call(anonymous, `public/${token}`, 'POST', {}, 405);
        const rotated = await call(owner, `diagrams/${d.id}/share`, 'POST', {
          enabled: true,
          rotate: true,
        });
        expect(rotated.path).not.toBe(sharing.path);
        await call(anonymous, `public/${token}`, 'GET', undefined, 404);
        await call(owner, `objects/${object.id}/share`, 'POST', { enabled: false });
        await call(anonymous, `public-objects/${object.id}/${objectToken}`, 'GET', undefined, 404);
      } finally {
        await anonymous.dispose();
      }
    } finally {
      await member.dispose();
      await foreign.dispose();
    }
  } finally {
    await owner.dispose();
    await viewer.dispose();
    await stranger.dispose();
  }
});

test('custom membership and role managers cannot escalate privileges or modify superior roles', async ({
  playwright,
}) => {
  const own = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const manager = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(own);
    const user = await login(manager);
    const area = (await call(own, 'workspaces'))[0];
    const scoped = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      storageState: await manager.storageState(),
      extraHTTPHeaders: { 'X-Maket-Workspace': area.id },
    });
    try {
      const memberRole = await call(own, 'collaboration/roles', 'POST', {
        name: 'Member manager',
        actions: ['read', 'members'],
      });
      const roleManager = await call(own, 'collaboration/roles', 'POST', {
        name: 'Role manager',
        actions: ['read', 'roles'],
      });
      const superior = await call(own, 'collaboration/roles', 'POST', {
        name: 'Superior',
        actions: ['read', 'edit', 'delete'],
      });
      await call(own, 'collaboration/members', 'POST', { email: user.email, role: memberRole.id });
      await call(
        scoped,
        'collaboration/members',
        'PATCH',
        { email: user.email, role: 'admin' },
        403,
      );
      await call(
        scoped,
        'collaboration/members',
        'PATCH',
        { email: user.email, role: superior.id },
        403,
      );
      expect((await call(scoped, 'collaboration')).access.actions).toEqual(['read', 'members']);
      await call(own, 'collaboration/members', 'PATCH', {
        email: user.email,
        role: roleManager.id,
      });
      await call(
        scoped,
        'collaboration/roles',
        'POST',
        { name: 'Escalated', actions: ['read', 'roles', 'members', 'edit'] },
        403,
      );
      await call(
        scoped,
        `collaboration/roles/${roleManager.id}`,
        'PATCH',
        {
          name: 'Escalated self',
          revision: roleManager.revision,
          actions: ['read', 'roles', 'edit'],
        },
        403,
      );
      await call(
        scoped,
        `collaboration/roles/${superior.id}`,
        'PATCH',
        { name: 'Downgrade superior', revision: superior.revision, actions: ['read'] },
        403,
      );
      await call(scoped, `collaboration/roles/${superior.id}`, 'DELETE', undefined, 403);
      await call(scoped, 'collaboration/roles', 'POST', {
        name: 'Allowed viewer',
        actions: ['read'],
      });
      expect((await call(scoped, 'collaboration')).access.actions).toEqual(['read', 'roles']);
    } finally {
      await scoped.dispose();
    }
  } finally {
    await own.dispose();
    await manager.dispose();
  }
});

test('history and diagram deletion cannot bypass element permissions or edit leases', async ({
  playwright,
}) => {
  const own = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'X-Maket-Client': randomUUID() },
  });
  const editor = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(own);
    const user = await login(editor);
    const area = (await call(own, 'workspaces'))[0];
    const member = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      storageState: await editor.storageState(),
      extraHTTPHeaders: { 'X-Maket-Workspace': area.id, 'X-Maket-Client': randomUUID() },
    });
    try {
      await call(own, 'collaboration/members', 'POST', { email: user.email, role: 'editor' });
      const a = await call(own, 'objects', 'POST', { name: 'A' }, 201);
      const b = await call(own, 'objects', 'POST', { name: 'B' }, 201);
      const c = await call(own, 'objects', 'POST', { name: 'C' }, 201);
      const r = await call(
        own,
        'relations',
        'POST',
        { name: 'Historical endpoints', sourceId: a.id, targetId: b.id },
        201,
      );
      const current = await call(own, `relations/${r.id}`, 'PATCH', {
        revision: r.revision,
        targetId: c.id,
      });
      await call(own, `collaboration/locks/${b.id}`, 'POST', {});
      await call(
        member,
        `relations/${r.id}/restore`,
        'POST',
        { revision: current.revision, number: 1 },
        423,
      );
      await call(own, `collaboration/locks/${b.id}`, 'DELETE', {});
      const role = await call(own, 'collaboration/roles', 'POST', {
        name: 'Restricted restore',
        actions: ['read', 'edit'],
        elementIds: [r.id, a.id, c.id],
      });
      await call(own, 'collaboration/members', 'PATCH', { email: user.email, role: role.id });
      await call(
        member,
        `relations/${r.id}/restore`,
        'POST',
        { revision: current.revision, number: 1 },
        403,
      );
      expect((await call(own, `relations/${r.id}`)).targetId).toBe(c.id);
      const parent = await call(own, 'objects', 'POST', { name: 'Parent' }, 201);
      const child = await call(own, 'objects', 'POST', { name: 'Child', parentId: parent.id }, 201);
      const moved = await call(own, `objects/${child.id}`, 'PATCH', {
        revision: child.revision,
        parentId: null,
      });
      await call(own, 'collaboration/members', 'PATCH', { email: user.email, role: 'editor' });
      await call(own, `collaboration/locks/${parent.id}`, 'POST', {});
      await call(
        member,
        `objects/${child.id}/restore`,
        'POST',
        { revision: moved.revision, number: 1 },
        423,
      );
      await call(own, `collaboration/locks/${parent.id}`, 'DELETE', {});
      // Restoring a hidden historical ancestor is creation even when all canvas objects still exist.
      const hidden = await call(own, 'objects', 'POST', { name: 'Historical ancestor' }, 201);
      const visible = await call(
        own,
        'objects',
        'POST',
        { name: 'Still present', parentId: hidden.id },
        201,
      );
      let historical = await call(own, 'diagrams', 'POST', { name: 'History with ancestor' }, 201);
      historical = await call(
        own,
        `diagrams/${historical.id}/representations`,
        'POST',
        {
          revision: historical.revision,
          objectId: visible.id,
          bindingId: historical.document.bindings[0].id,
          typeId: 'process',
          position: { x: 0, y: 0 },
        },
        201,
      );
      await call(own, `objects/${visible.id}`, 'PATCH', {
        revision: visible.revision,
        parentId: null,
      });
      await call(own, `objects/${hidden.id}`, 'DELETE', { revision: hidden.revision });
      const editOnly = await call(own, 'collaboration/roles', 'POST', {
        name: 'No creation',
        actions: ['read', 'edit'],
      });
      await call(own, 'collaboration/members', 'PATCH', { email: user.email, role: editOnly.id });
      await call(
        member,
        `diagrams/${historical.id}/restore`,
        'POST',
        { revision: historical.revision, number: historical.revision },
        403,
      );
      expect(await db.modelObject.count({ where: { id: hidden.id } })).toBe(0);
      const d = await call(own, 'diagrams', 'POST', { name: 'Decomposed' }, 201);
      const link = await call(
        own,
        'context-links',
        'POST',
        { entityId: a.id, targetDiagramId: d.id, kind: 'decomposition' },
        201,
      );
      await call(own, 'collaboration/members', 'PATCH', { email: user.email, role: 'moderator' });
      await call(own, `collaboration/locks/${link.id}`, 'POST', {});
      await call(member, `diagrams/${d.id}`, 'DELETE', undefined, 423);
      await call(own, `collaboration/locks/${link.id}`, 'DELETE', {});
      const deletion = await call(own, 'collaboration/roles', 'POST', {
        name: 'Delete diagram only',
        actions: ['read', 'delete'],
        elementIds: [d.id, d.entityId],
      });
      await call(own, 'collaboration/members', 'PATCH', { email: user.email, role: deletion.id });
      await call(member, `diagrams/${d.id}`, 'DELETE', undefined, 403);
      expect(await db.modelRelation.count({ where: { id: link.id } })).toBe(1);
    } finally {
      await member.dispose();
    }
  } finally {
    await own.dispose();
    await editor.dispose();
  }
});

test('API rejects cross-site changes, oversized and deeply nested bodies and bounds login attempts by address', async ({
  playwright,
}) => {
  const client = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(client);
    expect(
      (
        await client.post('/api/objects', {
          data: { name: 'CSRF' },
          headers: { Origin: 'https://attacker.invalid' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.post('/api/objects', {
          data: { name: 'CSRF' },
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.post('/api/objects', {
          data: JSON.stringify({ name: 'CSRF' }),
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status(),
    ).toBe(415);
    expect(
      (
        await client.post('/api/objects', {
          data: '{"name":"' + 'x'.repeat(2_000_000) + '"}',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status(),
    ).toBe(413);
    expect(
      (
        await client.post('/api/objects', {
          data: '['.repeat(10000) + '0' + ']'.repeat(10000),
          headers: { 'Content-Type': 'application/json' },
        })
      ).status(),
    ).toBe(400);
    const address = '192.0.2.204';
    const key = `login:address:${address}`;
    limits.push(key);
    await db.rateLimit.upsert({
      where: { key },
      create: { key, count: 60, expiresAt: new Date(Date.now() + 60000) },
      update: { count: 60, expiresAt: new Date(Date.now() + 60000) },
    });
    expect(
      (
        await client.post('/api/auth/login', {
          data: { email: `security-${randomUUID()}@example.com`, password: 'Unknown-password-123' },
          headers: { 'X-Forwarded-For': address },
        })
      ).status(),
    ).toBe(429);
    const health = await client.get('/api/health');
    expect(health.status()).toBe(200);
    expect(health.headers()['content-security-policy']).toContain("object-src 'none'");
  } finally {
    await client.dispose();
  }
});

test('public viewers render untrusted names and properties as text and preserve image export', async ({
  playwright,
  page,
}) => {
  test.setTimeout(90000);
  const own = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    await login(own);
    const payload = '<img src=x onerror="window.securityXss=1">';
    const object = await call(
      own,
      'objects',
      'POST',
      { name: payload, attributes: { payload } },
      201,
    );
    const share = await call(own, `objects/${object.id}/share`, 'POST', { enabled: true });
    await page.goto(share.path);
    await expect(page.getByRole('heading', { name: payload, exact: true })).toBeVisible();
    await expect(page.locator('.public-object-attributes')).toContainText(payload);
    expect(
      await page.evaluate(() => (window as unknown as { securityXss?: number }).securityXss),
    ).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    let d = await call(own, 'diagrams', 'POST', { name: 'Export security check' }, 201);
    d = await call(
      own,
      `diagrams/${d.id}/representations`,
      'POST',
      {
        revision: d.revision,
        objectId: object.id,
        bindingId: d.document.bindings[0].id,
        typeId: 'process',
        position: { x: 0, y: 0 },
      },
      201,
    );
    const ds = await call(own, `diagrams/${d.id}/share`, 'POST', { enabled: true });
    await page.goto(ds.path);
    const svg = page.locator('.viewer-canvas svg').first();
    await expect(svg).toBeVisible();
    await expect(svg).toContainText(payload);
    expect(
      await page.evaluate(() => (window as unknown as { securityXss?: number }).securityXss),
    ).toBeUndefined();
    await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
    const exporting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    const file = await exporting;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await file.failure()).toBeNull();
  } finally {
    await own.dispose();
  }
});

test('password changes revoke previous recovery links and other sessions', async ({
  playwright,
}) => {
  const own = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const other = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const user = await login(own);
    const password = 'Security-test-password-42';
    expect(
      (await other.post('/api/auth/login', { data: { email: user.email, password } })).status(),
    ).toBe(200);
    const token = randomBytes(32).toString('hex');
    await db.authToken.create({
      data: {
        id: createHash('sha256').update(token).digest('hex'),
        userId: user.id,
        kind: 'reset',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await call(own, 'password', 'POST', {
      currentPassword: password,
      password: 'Changed-security-password-43',
    });
    await call(own, 'auth/me');
    await call(other, 'auth/me', 'GET', undefined, 401);
    await call(other, 'auth/reset', 'POST', { token, password: 'Attacker-password-44' }, 400);
    expect(await db.authToken.count({ where: { userId: user.id, kind: 'reset' } })).toBe(0);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  } finally {
    await own.dispose();
    await other.dispose();
  }
});

test('a login already checking the old password cannot issue a session after a concurrent password reset', async ({
  playwright,
}) => {
  const client = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const user = await login(client);
    const before = await db.session.count({ where: { userId: user.id } });
    let ready!: () => void, release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync('Concurrent-reset-password-43', salt, 64).toString('hex')}`;
    const transaction = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
        ready();
        await gate;
        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      },
      { timeout: 15000 },
    );
    await acquired;
    const attempt = client.post('/api/auth/login', {
      data: { email: user.email, password: 'Security-test-password-42' },
    });
    try {
      await expect
        .poll(
          async () => {
            const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock'
            AND query LIKE '%SELECT "passwordHash" FROM "User"%') AS waiting`;
            return row.waiting;
          },
          { timeout: 5000, intervals: [50, 100, 200] },
        )
        .toBe(true);
    } finally {
      release();
      await transaction;
    }
    expect((await attempt).status()).toBe(401);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(before);
  } finally {
    await client.dispose();
  }
});
