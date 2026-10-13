import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const apiDirectory = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const nestCli = resolve(apiDirectory, 'node_modules/.bin/nest');
const apiPort = Number(process.env.M1_TEST_PORT ?? 3107);
const apiUrl = `http://localhost:${apiPort}/api/v1`;
const mailpitUrl = 'http://localhost:8025';
const testPrefix = `m1-${randomUUID()}`;
const testEmails: string[] = [];
const testUserIds: string[] = [];
const prisma = new PrismaClient();

interface TestAgent {
  cookie?: string;
}

interface MailpitMessage {
  ID: string;
  To?: Array<{ Address: string }>;
}

let apiProcess: ReturnType<typeof spawn> | undefined;
let apiLogs = '';

async function apiCall<T = unknown>(
  agent: TestAgent,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(agent.cookie ? { cookie: agent.cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) agent.cookie = cookie.split(';', 1)[0];
  const envelope = (await response.json().catch(() => ({}))) as { data?: T };
  return { status: response.status, body: envelope.data as T };
}

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (apiProcess?.exitCode !== null && apiProcess?.exitCode !== undefined) {
      throw new Error(`API exited before becoming ready. ${apiLogs}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health/ready`);
      if (response.ok) return;
    } catch {
      // The API is still compiling or starting.
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
  }
  throw new Error(`API did not become ready within 30 seconds. ${apiLogs}`);
}

async function messageIdsFor(email: string): Promise<Set<string>> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`);
  if (!response.ok) throw new Error('Mailpit is unavailable');
  const result = (await response.json()) as { messages?: MailpitMessage[] };
  return new Set(
    (result.messages ?? [])
      .filter((message) =>
        message.To?.some((recipient) => recipient.Address.toLowerCase() === email),
      )
      .map((message) => message.ID),
  );
}

async function waitForMailCode(email: string, excludeIds = new Set<string>()): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`);
    const result = (await response.json()) as { messages?: MailpitMessage[] };
    const message = (result.messages ?? []).find(
      (candidate) =>
        !excludeIds.has(candidate.ID) &&
        candidate.To?.some((recipient) => recipient.Address.toLowerCase() === email),
    );
    if (message) {
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as { Text?: string };
      const code = detail.Text?.match(/code is (\d{6})/i)?.[1];
      if (code) return code;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
  }
  throw new Error(`No verification message arrived for ${email}`);
}

async function registerAndVerify(agent: TestAgent, email: string) {
  testEmails.push(email);
  const registration = await apiCall(agent, '/auth/register', 'POST', {
    name: 'M1 Test User',
    email,
    password: 'UrbanSpoon-Test-123!',
  });
  expect(registration.status).toBe(202);

  const code = await waitForMailCode(email);
  const invalidCode = code === '000000' ? '000001' : '000000';
  expect((await apiCall(agent, '/auth/verify', 'POST', { email, code: invalidCode })).status).toBe(
    400,
  );
  const verification = await apiCall<Record<string, unknown>>(agent, '/auth/verify', 'POST', {
    email,
    code,
  });
  expect(verification.status).toBe(200);
  expect(verification.body.user).toMatchObject({ email });
  expect(verification.body.user).not.toHaveProperty('passwordHash');

  const profile = await apiCall<Record<string, unknown>>(agent, '/me');
  expect(profile.status).toBe(200);
  testUserIds.push(String(profile.body.id));
  return profile.body;
}

describe('M1 identity API', () => {
  beforeAll(async () => {
    const serverProcess = spawn(nestCli, ['start'], {
      cwd: apiDirectory,
      env: { ...process.env, PORT: String(apiPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiProcess = serverProcess;
    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      apiLogs = `${apiLogs}${chunk.toString()}`.slice(-5000);
    });
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      apiLogs = `${apiLogs}${chunk.toString()}`.slice(-5000);
    });
    await waitForApi();
  });

  afterAll(async () => {
    if (testUserIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: testUserIds } } });
    }
    if (testEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    }
    await prisma.$disconnect();
    if (apiProcess && apiProcess.exitCode === null) {
      await new Promise<void>((resolveExit) => {
        apiProcess!.once('exit', () => resolveExit());
        apiProcess!.kill('SIGTERM');
      });
    }
  });

  it('registers, verifies, issues a session, and isolates addresses by owner', async () => {
    const firstEmail = `${testPrefix}-first@example.test`;
    const firstAgent: TestAgent = {};
    const profile = await registerAndVerify(firstAgent, firstEmail);
    expect(profile.roles).toContainEqual(
      expect.objectContaining({ role: 'customer', scopeType: 'PLATFORM' }),
    );

    const createdAddress = await apiCall<Record<string, unknown>>(
      firstAgent,
      '/addresses',
      'POST',
      {
        label: 'Home',
        line1: '12 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
      },
    );
    expect(createdAddress.status).toBe(201);
    expect(createdAddress.body.isDefault).toBe(true);
    const secondAddress = await apiCall<Record<string, unknown>>(firstAgent, '/addresses', 'POST', {
      label: 'Work',
      line1: '90 Central Avenue',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560002',
    });
    expect(secondAddress.body.isDefault).toBe(false);
    expect(
      (
        await apiCall(firstAgent, `/addresses/${String(secondAddress.body.id)}`, 'PATCH', {
          isDefault: true,
        })
      ).status,
    ).toBe(200);
    const firstAddresses = await apiCall<Array<Record<string, unknown>>>(firstAgent, '/addresses');
    expect(firstAddresses.body.filter((address) => address.isDefault)).toHaveLength(1);

    const secondEmail = `${testPrefix}-second@example.test`;
    const secondAgent: TestAgent = {};
    await registerAndVerify(secondAgent, secondEmail);
    const secondAddresses = await apiCall<unknown[]>(secondAgent, '/addresses');
    expect(secondAddresses.status).toBe(200);
    expect(secondAddresses.body).toEqual([]);

    const crossAccountUpdate = await apiCall(
      secondAgent,
      `/addresses/${String(createdAddress.body.id)}`,
      'PATCH',
      { label: 'Hijacked' },
    );
    expect(crossAccountUpdate.status).toBe(404);

    expect((await apiCall(firstAgent, '/auth/logout', 'POST')).status).toBe(200);
    expect((await apiCall(firstAgent, '/me')).status).toBe(401);
  });

  it('requires verified email for login and revokes sessions after password reset', async () => {
    const email = `${testPrefix}-recovery@example.test`;
    testEmails.push(email);
    const agent: TestAgent = {};
    expect(
      (
        await apiCall(agent, '/auth/register', 'POST', {
          name: 'Recovery User',
          email,
          password: 'UrbanSpoon-Test-123!',
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await apiCall(agent, '/auth/login', 'POST', {
          email,
          password: 'UrbanSpoon-Test-123!',
        })
      ).status,
    ).toBe(401);

    const verificationCode = await waitForMailCode(email);
    expect(
      (await apiCall(agent, '/auth/verify', 'POST', { email, code: verificationCode })).status,
    ).toBe(200);
    const oldSessionCookie = agent.cookie;
    const previousMessages = await messageIdsFor(email);
    expect((await apiCall(agent, '/auth/forgot-password', 'POST', { email })).status).toBe(202);
    const resetCode = await waitForMailCode(email, previousMessages);
    expect(
      (
        await apiCall(agent, '/auth/reset-password', 'POST', {
          email,
          code: resetCode,
          newPassword: 'UrbanSpoon-New-456!',
        })
      ).status,
    ).toBe(200);

    expect((await apiCall({ cookie: oldSessionCookie }, '/me')).status).toBe(401);
    const newSession: TestAgent = {};
    expect(
      (
        await apiCall(newSession, '/auth/login', 'POST', {
          email,
          password: 'UrbanSpoon-Test-123!',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await apiCall(newSession, '/auth/login', 'POST', {
          email,
          password: 'UrbanSpoon-New-456!',
        })
      ).status,
    ).toBe(200);
  });

  it('locks a verification code after five failures and accepts a resent code', async () => {
    const email = `${testPrefix}-attempt-limit@example.test`;
    const agent: TestAgent = {};
    testEmails.push(email);
    expect(
      (
        await apiCall(agent, '/auth/register', 'POST', {
          name: 'Attempt Limit User',
          email,
          password: 'UrbanSpoon-Test-123!',
        })
      ).status,
    ).toBe(202);

    const firstCode = await waitForMailCode(email);
    const invalidCode = firstCode === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await apiCall(agent, '/auth/verify', 'POST', { email, code: invalidCode })).status,
      ).toBe(400);
    }
    expect((await apiCall(agent, '/auth/verify', 'POST', { email, code: firstCode })).status).toBe(
      400,
    );

    const oldMessages = await messageIdsFor(email);
    expect((await apiCall(agent, '/auth/verify/resend', 'POST', { email })).status).toBe(202);
    const resentCode = await waitForMailCode(email, oldMessages);
    expect((await apiCall(agent, '/auth/verify', 'POST', { email, code: resentCode })).status).toBe(
      200,
    );
    const profile = await apiCall<Record<string, unknown>>(agent, '/me');
    expect(profile.status).toBe(200);
    testUserIds.push(String(profile.body.id));
  });

  it('denies customer role grants and audits a super-admin role grant', async () => {
    const customerEmail = `${testPrefix}-customer@example.test`;
    const customerAgent: TestAgent = {};
    const customer = await registerAndVerify(customerAgent, customerEmail);
    const customerId = String(customer.id);
    expect(
      (
        await apiCall(customerAgent, `/admin/users/${customerId}/roles`, 'POST', {
          role: 'restaurant_owner',
          scopeType: 'RESTAURANT',
          scopeId: 'restaurant-1',
        })
      ).status,
    ).toBe(403);

    const adminEmail = `${testPrefix}-admin@example.test`;
    const adminAgent: TestAgent = {};
    const admin = await registerAndVerify(adminAgent, adminEmail);
    const superAdminAssignment = await prisma.userRole.create({
      data: { userId: String(admin.id), role: 'super_admin', scopeType: 'PLATFORM' },
    });
    expect(
      (
        await apiCall(
          adminAgent,
          `/admin/users/${String(admin.id)}/roles/${superAdminAssignment.id}`,
          'DELETE',
        )
      ).status,
    ).toBe(409);

    const grant = await apiCall<Record<string, unknown>>(
      adminAgent,
      `/admin/users/${customerId}/roles`,
      'POST',
      { role: 'restaurant_owner', scopeType: 'RESTAURANT', scopeId: 'restaurant-1' },
    );
    expect(grant.status).toBe(201);
    expect(grant.body.role).toBe('restaurant_owner');

    const revoked = await apiCall<Record<string, unknown>>(
      adminAgent,
      `/admin/users/${customerId}/roles/${String(grant.body.id)}`,
      'DELETE',
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('REVOKED');
    const updatedCustomer = await apiCall<Record<string, unknown>>(customerAgent, '/me');
    expect(updatedCustomer.body.roles).not.toContainEqual(
      expect.objectContaining({ role: 'restaurant_owner' }),
    );

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: String(grant.body.id), action: 'ROLE_GRANTED' },
    });
    expect(audit?.permission).toBe('admin.roles.manage');
    const revokeAudit = await prisma.auditLog.findFirst({
      where: { entityId: String(grant.body.id), action: 'ROLE_REVOKED' },
    });
    expect(revokeAudit?.permission).toBe('admin.roles.manage');
  });
});
