const nextConfig = {
  output: 'export',
  distDir: '.next-release',
  experimental: { cpus: 1 },
  images: { unoptimized: true },
  poweredByHeader: false,
};
export default nextConfig;
