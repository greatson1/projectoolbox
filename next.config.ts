import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Note: for audio uploads > 4.5 MB on Vercel free tier,
  // set BODY_SIZE_LIMIT=25mb in Vercel dashboard environment variables.
  // On Pro+, configure in vercel.json under functions.maxDuration.
};

export default nextConfig;
