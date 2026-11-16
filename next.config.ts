import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Enable standalone output for Docker deployments
  output: 'standalone',
  // React Compiler (babel-plugin-react-compiler) memoizes components and hooks.
  reactCompiler: true,
  experimental: {
    // Allow multipart headers and fields around a 50 MiB CSV file.
    proxyClientMaxBodySize: '51mb'
  },
  // Security headers. The Content-Security-Policy needs a per-request nonce,
  // so proxy.ts sets it.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }]
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ]
  }
}

export default nextConfig
