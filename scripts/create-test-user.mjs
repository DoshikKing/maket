import 'dotenv/config';
import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify, parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';

const help = `Создать тестового пользователя с подтверждённой почтой.

npm run user:create-test -- --email test@example.com --name "Тестовый пользователь"

Пароль: переменная TEST_USER_PASSWORD или стандартный ввод с --password-stdin.
Минимум 10, максимум 128 символов. Пароль не выводится в журнал.
Email по умолчанию: test@example.com; можно задать TEST_USER_EMAIL.
Имя по умолчанию: Тестовый пользователь; можно задать TEST_USER_NAME.
Используется DATABASE_URL из окружения или .env.
Существующий аккаунт не изменяется, включая пароль и статус подтверждения.`;

let db;
try {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(help);
  } else {
    let password = process.env.TEST_USER_PASSWORD;
    if (values['password-stdin']) {
      if (process.stdin.isTTY) throw new Error('Передайте пароль через pipe в стандартный ввод.');
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 1024) throw new Error('Слишком длинный пароль в стандартном вводе.');
        chunks.push(chunk);
      }
      password = Buffer.concat(chunks)
        .toString('utf8')
        .replace(/\r?\n$/, '');
    }
    const input = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(10).max(128),
      })
      .safeParse({
        email: values.email ?? process.env.TEST_USER_EMAIL ?? 'test@example.com',
        name: values.name ?? process.env.TEST_USER_NAME ?? 'Тестовый пользователь',
        password,
      });
    if (!input.success) {
      throw new Error(
        'Проверьте email, имя (1–100 символов) и пароль (10–128 символов). Задайте TEST_USER_PASSWORD или --password-stdin.',
      );
    }
    if (!process.env.DATABASE_URL) throw new Error('Задайте DATABASE_URL в окружении или .env.');
    const salt = randomBytes(16).toString('hex');
    // Same scrypt parameters and salt:hash format as src/lib/auth.ts.
    const hash = await promisify(scryptCallback)(input.data.password, salt, 64);
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    const id = randomUUID();
    const user = await db.user.upsert({
      where: { email: input.data.email },
      create: {
        id,
        email: input.data.email,
        name: input.data.name,
        passwordHash: `${salt}:${hash.toString('hex')}`,
        emailVerified: true,
      },
      update: {},
      select: { id: true, email: true },
    });
    console.log(
      user.id === id
        ? `Создан пользователь ${user.email}. Почта подтверждена; можно войти с заданным паролем.`
        : `Пользователь ${user.email} уже существует. Пароль, имя и статус подтверждения не изменены.`,
    );
  }
} catch (error) {
  // Prisma errors may include connection details. Never log those or the supplied password.
  console.error(
    error instanceof z.ZodError || (error && 'clientVersion' in error)
      ? 'Не удалось создать пользователя. Проверьте подключение к БД, миграции и сгенерированный Prisma Client.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
