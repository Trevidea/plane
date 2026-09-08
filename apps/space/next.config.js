/** @type {import('next').NextConfig} */

const nextConfig = {
  trailingSlash: true,
  output: "standalone",
  basePath: process.env.NEXT_PUBLIC_SPACE_BASE_PATH || "",
  reactStrictMode: false,
  swcMinify: true,
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }], // clickjacking protection
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    unoptimized: true,
  },
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
      "@plane/types",
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
