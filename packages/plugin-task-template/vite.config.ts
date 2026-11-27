import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: PACKAGE_DIR,
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/client/index.tsx',
      formats: ['iife'],
      name: 'NxkvPluginTaskTemplate',
      fileName: () => 'client.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'NxkvReact',
          'react-dom': 'NxkvReactDOM',
          'react/jsx-runtime': 'NxkvJsxRuntime',
        },
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
      },
    },
  },
});
