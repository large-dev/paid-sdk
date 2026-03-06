import { defineConfig } from 'tsup'
import { copyFileSync } from 'fs'

export default defineConfig([
  // Core (framework-agnostic)
  {
    entry: { 'core/index': 'src/core/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['viem'],
  },
  // React bindings
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom', 'viem', 'wagmi', '@wagmi/core', 'framer-motion'],
    banner: { js: '"use client";' },
    onSuccess: () => {
      copyFileSync('src/react/styles/paid.css', 'dist/styles.css')
    },
  },
])
