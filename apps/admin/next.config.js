/** @type {import('next').NextConfig} */

const nextConfig = {
  trailingSlash: true,
  reactStrictMode: false,
  swcMinify: true,
  output: "standalone",
  images: {
    unoptimized: true,
  },
  basePath: process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "",
  experimental: {
    optimizePackageImports: [
      "@plane/constants",
      "@plane/editor",
      "@plane/hooks",
      "@plane/i18n",
      "@plane/logger",
      "@plane/propel",
      "@plane/services",
      "@plane/shared-state",
      "@plane/ui",
      "@plane/utils",
    ],
  },
  async rewrites() {
    const apiProxyUrl = process.env.NEXT_INTERNAL_API_BASE_URL || "";
    if (!apiProxyUrl) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyUrl}/api/:path*/`,
      },
      {
        source: "/auth/:path*",
        destination: `${apiProxyUrl}/auth/:path*/`,
      },
    ];
  },
};

module.exports = nextConfig;
