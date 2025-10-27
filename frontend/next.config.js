/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true
  },
  trailingSlash: false,  // 改为 false，避免重定向问题
  skipTrailingSlashRedirect: true,
}

module.exports = nextConfig
