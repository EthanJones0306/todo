const isProd = process.env.NODE_ENV === 'production'
const MS_LOGIN = 'https://login.microsoftonline.com'
const MS_GRAPH = 'https://graph.microsoft.com'

// Pages may only talk to this site, Microsoft sign-in and Microsoft Graph, so injected
// code couldn't send work tokens or tasks anywhere else. Dev keeps eval for hot reload.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${MS_GRAPH} ${MS_LOGIN}${isProd ? '' : ' ws:'}`,
  `frame-src 'self' ${MS_LOGIN}`,
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${MS_LOGIN}`,
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The sign-in bridge briefly holds auth codes in its URL; never cache it.
        source: '/redirect',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

module.exports = nextConfig
