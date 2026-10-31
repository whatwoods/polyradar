import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@polyradar/db'],
  serverExternalPackages: ['pg'],
  async rewrites() {
    return [{ source: '/e/:slug.md', destination: '/md/e/:slug' }];
  },
};

export default config;
