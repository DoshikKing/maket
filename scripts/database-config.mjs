/** @param {Record<string, string | undefined>} env */
export function databaseConfig(env = process.env) {
  const schema =
    env.POSTGRES_SCHEMA ||
    (env.DATABASE_URL ? new URL(env.DATABASE_URL).searchParams.get('schema') : '') ||
    'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw new Error(
      'POSTGRES_SCHEMA: use lowercase letters, digits and underscores (max 63 characters)',
    );
  let url;
  if (env.DATABASE_URL) {
    // Compatibility for existing installations; new configuration uses separate fields.
    url = new URL(env.DATABASE_URL);
  } else {
    let host = env.POSTGRES_HOST || 'localhost';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    const port = env.POSTGRES_PORT || '5432';
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new Error('Invalid POSTGRES_PORT');
    url = new URL(
      `postgresql://${encodeURIComponent(env.POSTGRES_USER || 'maket')}:${encodeURIComponent(env.POSTGRES_PASSWORD || '')}@${host}:${port}/${encodeURIComponent(env.POSTGRES_DB || 'maket')}`,
    );
  }
  url.searchParams.set('schema', schema);
  // Raw SQL and Prisma's adapter must use the same schema.
  const options = url.searchParams.get('options') || '';
  url.searchParams.set('options', `${options} -c search_path=${schema},public`.trim());
  return { connectionString: url.toString(), schema };
}
