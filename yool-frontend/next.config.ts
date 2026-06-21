import type { NextConfig } from "next";

// Allow self-signed TLS certs when proxying to the local backend in development.
// Remove this before deploying to production.
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nextConfig: NextConfig = {
  // Required for Docker: produces a self-contained server.js bundle
  // in .next/standalone/ with only the runtime files needed to serve the app.
  output: 'standalone',

  async rewrites() {
    const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'https://localhost';
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
