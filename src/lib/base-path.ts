// Next.js replaces this public value in browser bundles at build time.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const appPath = (path: string) => `${basePath}${path}`;
