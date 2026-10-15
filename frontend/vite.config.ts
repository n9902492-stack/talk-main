import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv} from 'vite';
import {createRuntimeAuth} from '../backend/src/runtime-auth.mjs';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendRoot, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const backendEnv = { ...env, ...process.env };
  return {
    root: frontendRoot,
    envDir: projectRoot,
    plugins: [react(), tailwindcss(), {
      name: 'talk-auth',
      configureServer(server) {
        const port = server.config.server.port || 3001;
        const appUrl = new URL(process.env.APP_URL || env.APP_URL || `http://localhost:${port}`);
        const auth = createRuntimeAuth(backendEnv, {
          origins: [appUrl.origin, `http://localhost:${port}`, `http://127.0.0.1:${port}`],
          secureCookies: appUrl.protocol === 'https:',
        });
        server.middlewares.use(auth);
        server.httpServer?.once('close', () => auth.locals.closeAuthDatabase());
      },
    }],
    resolve: {
      alias: {
        '@': frontendRoot,
      },
    },
    server: {
      // The workspace root also contains backend code and private account data.
      // Browser file serving is limited to frontend sources and installed deps.
      fs: { allow: [frontendRoot, path.join(projectRoot, 'node_modules')] },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Referrer-Policy': 'no-referrer-when-downgrade',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
