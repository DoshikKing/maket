import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { db } from './db';
const scrypt = promisify(scryptCallback);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export async function currentUser() {
  const value = (await cookies()).get('maket_session')?.value;
  if (!value) return null;
  const session = await db.session.findUnique({
    where: { id: tokenHash(value) },
    include: { user: true },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({
    data: { id: tokenHash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400000) },
  });
  (await cookies()).set('maket_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_URL?.startsWith('https://') ?? false,
    path: '/',
    maxAge: 7 * 86400,
  });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get('maket_session')?.value;
  if (token) await db.session.deleteMany({ where: { id: tokenHash(token) } });
  jar.delete('maket_session');
}
export async function sendAuthEmail(userId: string, email: string, kind: 'verify' | 'reset') {
  const raw = randomBytes(32).toString('hex');
  const id = tokenHash(raw);
  await db.authToken.create({
    data: {
      id,
      userId,
      kind,
      expiresAt: new Date(Date.now() + (kind === 'verify' ? 86400000 : 3600000)),
    },
  });
  const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/${kind}?token=${raw}`;
  if (process.env.MAIL_WEBHOOK_URL) {
    if (!process.env.MAIL_WEBHOOK_URL.startsWith('https://'))
      throw new Error('Mail webhook must use HTTPS');
    const response = await fetch(process.env.MAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN ?? ''}`,
      },
      body: JSON.stringify({
        to: email,
        subject: kind === 'verify' ? 'Подтвердите почту maket' : 'Восстановление пароля maket',
        text: url,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Mail delivery failed');
  } else if (process.env.NODE_ENV !== 'production') {
    console.info(`[maket mail] ${email}: ${url}`);
  } else {
    await db.authToken.delete({ where: { id } });
    throw new Error('Mail delivery is not configured');
  }
}
export async function limited(key: string, max = 8) {
  const now = new Date();
  await db.rateLimit.deleteMany({ where: { key, expiresAt: { lte: now } } });
  const entry = await db.rateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date(Date.now() + 15 * 60000) },
    update: { count: { increment: 1 } },
  });
  return entry.count > max;
}
