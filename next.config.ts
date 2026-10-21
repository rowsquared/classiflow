import type { NextConfig } from 'next'

// Report-only for now: browsers log violations to the console without blocking.
// The browser journeys (tests/e2e) fail on any report, so once production shows
// none, rename the header to Content-Security-Policy to enforce it.
// 'unsafe-inline' scripts: Next's hydration data and the sidebar init script in
// app/layout.tsx are inline; replacing it needs per-request nonces.
const contentSecurityPolicy = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"frame-ancestors 'self'",
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// Enable standalone output for Docker deployments
	output: 'standalone',
	// Lint runs in CI (blocking), not in the image build
	eslint: {
		ignoreDuringBuilds: true,
	},
	// Security headers
	async headers() {
		return [
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
					},
					{
						key: 'Content-Security-Policy-Report-Only',
						value: contentSecurityPolicy
					},
				],
			},
		]
	},
}

export default nextConfig

