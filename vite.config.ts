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
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
