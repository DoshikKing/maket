import type { NextConfig } from 'next';
const desktop = process.env.MAKET_DESKTOP_BUILD === '1';
const basePath = desktop ? '' : process.env.APP_URL || '';
if (basePath && !/^(\/[a-zA-Z0-9_-]+)+$/.test(basePath))
  throw new Error('APP_URL must be empty or a path like /maket without a trailing slash');
const config: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_MAKET_DESKTOP: desktop ? '1' : '0' },
  distDir: desktop ? '.next-desktop' : '.next',
  skipTrailingSlashRedirect: !!basePath,
  output: desktop || process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['@prisma/client', 'jsdom', 'sharp'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Content-Security-Policy',
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
