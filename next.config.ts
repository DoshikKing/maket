import type { NextConfig } from 'next';
const basePath = process.env.APP_URL || '';
if (basePath && !/^(\/[a-zA-Z0-9_-]+)+$/.test(basePath))
  throw new Error('APP_URL must be empty or a path like /maket without a trailing slash');
const config: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  skipTrailingSlashRedirect: !!basePath,
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['@prisma/client'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
export default config;
