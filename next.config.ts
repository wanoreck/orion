import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Single self-contained server bundle for the Docker image (D16).
  output: 'standalone',
  poweredByHeader: false,
  // Carbon's Sass triggers deprecation warnings that aren't ours to fix.
  sassOptions: { quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'if-function'] },
};

export default nextConfig;
