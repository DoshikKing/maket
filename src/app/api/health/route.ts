import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: 'ok' },
      {
        headers: {
          'Cache-Control': 'no-store',
          ...(process.env.MAKET_STARTUP_ID &&
          request.headers.get('X-Maket-Startup') === process.env.MAKET_STARTUP_ID
            ? { 'X-Maket-Startup': process.env.MAKET_STARTUP_ID }
            : {}),
        },
      },
    );
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
