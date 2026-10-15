import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {createRuntimeAuth} from './server/runtime-auth.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendEnv = { ...env, ...process.env };
  return {
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
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
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
