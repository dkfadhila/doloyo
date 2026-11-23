import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// VITE_BASE: public base path of the deployment, e.g. "/" (default) or "/doloyo/" (GitHub Pages project site).
function normBase(raw: string): string {
  // Git Bash on Windows rewrites VITE_BASE=/foo/ into C:/Program Files/Git/foo/; fail loudly instead of building a broken site
  if (/^[A-Za-z]:[\/]/.test(raw)) throw new Error(`VITE_BASE looks like a Windows path (${raw}). In Git Bash run: MSYS_NO_PATHCONV=1 VITE_BASE=/name/ npm run build`);
  return norm(raw);
}
const norm = (b: string) => (b.startsWith('/') || /^https?:\/\//.test(b) ? b : '/' + b).replace(/\/*$/, '/');

export default defineConfig({
  base: normBase(process.env.VITE_BASE || '/'),
  // hashed bundles go to /bundle (cache forever); public/assets, examples and mediapipe keep stable names and are cached shorter
  build: { assetsDir: 'bundle' },
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], exclude: ['mcp/**', 'node_modules/**'] },
});
