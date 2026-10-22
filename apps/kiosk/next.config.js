const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ['@xpos/types'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  webpack: (config, { dev }) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    if (dev) {
      config.cache = false; // Disable pack file disk caching on Windows to prevent ArrayBuffer OOM
    }
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'wss://xpos-printing-cloud.onrender.com',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://riseupsolutions.in',
    NEXT_PUBLIC_KIOSK_ID: process.env.NEXT_PUBLIC_KIOSK_ID || 'XPOS-001',
  },
};

module.exports = nextConfig;
