/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The sign-in bridge briefly holds auth codes in its URL; never cache it.
        source: '/redirect',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

module.exports = nextConfig
