/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.sscprephub.in" },
      { protocol: "https", hostname: "pub-*.r2.dev" },
    ],
  },
};

export default nextConfig;
