// Forwarded headers must be overwritten by the trusted reverse proxy (see deploy/nginx).
export function requestOrigin(request: { headers: Headers; url: string }) {
  const fallback = new URL(request.url);
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    fallback.host;
  const protocol =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    fallback.protocol.slice(0, -1);
  if (!['http', 'https'].includes(protocol)) throw new Error('Invalid forwarded protocol');
  return new URL(`${protocol}://${host}`).origin;
}
