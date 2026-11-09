import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: { "/*": ["./data/**", "./.env*"] },
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*.sql", "./drizzle/meta/_journal.json"] },
  poweredByHeader: false,
};

export default config;
