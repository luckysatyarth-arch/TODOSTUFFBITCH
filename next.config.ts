import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions handle mutations; keep the payload ceiling modest so
    // large audio uploads are forced through the storage path instead.
    serverActions: { bodySizeLimit: '2mb' },
  },
  serverExternalPackages: ['twilio'],
};

export default nextConfig;
