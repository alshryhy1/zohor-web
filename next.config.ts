import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: { root: __dirname } as unknown as NextConfig["turbopack"],
  async headers() {
    const csp =
      "default-src 'self'; " +
      "base-uri 'self'; " +
      "object-src 'none'; " +
      "frame-ancestors 'self'; " +
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https:; " +
      "worker-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https:; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data: https:; " +
      "media-src 'self' blob: https:; " +
      "connect-src 'self' https: wss: blob:; ";

    const headers = [{ key: "Content-Security-Policy", value: csp }];

    return [
      { source: "/live", headers },
      { source: "/live/:path*", headers },
    ];
  },
};

export default nextConfig;
