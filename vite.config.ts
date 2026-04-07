import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
    ) as { version?: string };

    return {
      define: {
        __APP_VERSION__: JSON.stringify(packageJson.version || '0.0.0'),
      },
      server: {
        port: 3000,
        host: '127.0.0.1',
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:3100',
            changeOrigin: true,
          }
        }
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('react') || id.includes('react-dom')) return 'react-vendor';
                if (id.includes('framer-motion')) return 'motion-vendor';
                if (id.includes('lucide-react')) return 'icons-vendor';
                if (id.includes('jszip')) return 'zip-vendor';
                return 'vendor';
              }

              if (id.includes('/modules/Video/')) return 'video-module';
              if (id.includes('/modules/OneClick/')) return 'one-click-module';
              if (id.includes('/modules/AgentCenter/')) return 'agent-center-module';
              if (id.includes('/modules/Translation/')) return 'translation-module';
            },
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
