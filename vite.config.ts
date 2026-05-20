import path from "path"
import { readFileSync } from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig(() => {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
  ) as { version?: string };

  return {
    base: '/',
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version || '0.0.0'),
    },
    plugins: [react()],
    server: {
      port: 3000,
      strictPort: true,
      host: '127.0.0.1',
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/ShellMigratedApp.tsx',
          './src/shell/components/LandingPage.tsx',
          './src/shell/components/layout/SidebarNavigation.tsx',
          './src/shell/components/ToastSystem.tsx',
        ],
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3100',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              const normalizedId = id.split(path.sep).join('/');
              if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons-vendor';
              if (normalizedId.includes('/node_modules/framer-motion/')) return 'motion-vendor';
              if (
                normalizedId.includes('/node_modules/@radix-ui/')
                || normalizedId.includes('/node_modules/cmdk/')
                || normalizedId.includes('/node_modules/vaul/')
              ) return 'ui-vendor';
              if (normalizedId.includes('/node_modules/jszip/')) return 'zip-vendor';
              if (
                normalizedId.includes('/node_modules/react/')
                || normalizedId.includes('/node_modules/react-dom/')
                || normalizedId.includes('/node_modules/scheduler/')
                || normalizedId.includes('/node_modules/use-sync-external-store/')
              ) return 'react-vendor';
              return 'vendor';
            }

            if (id.includes('/shell/modules/AgentCenter/') || id.includes('/modules/AgentCenter/')) return 'agent-center-module';
            if (id.includes('/shell/modules/OneClick/') || id.includes('/modules/OneClick/')) return 'one-click-module';
            if (id.includes('/shell/modules/Video/') || id.includes('/modules/Video/')) return 'video-module';
            if (id.includes('/shell/modules/Translation/') || id.includes('/modules/Translation/')) return 'translation-module';
            if (id.includes('/shell/modules/Account/') || id.includes('/modules/Account/')) return 'account-module';
          },
        },
      },
    },
  };
});
