const readPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  apps: [
    {
      name: 'meiao-internal',
      script: 'server/index.mjs',
      cwd: '/www/wwwroot/meiao-internal',
      instances: 1,
      exec_mode: 'cluster',
      wait_ready: true,
      listen_timeout: readPositiveInteger(process.env.MEIAO_PM2_LISTEN_TIMEOUT_MS, 120000),
      kill_timeout: readPositiveInteger(process.env.MEIAO_PM2_KILL_TIMEOUT_MS, 30000),
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        MEIAO_BIND_HOST: process.env.MEIAO_BIND_HOST || '0.0.0.0',
        MEIAO_RELEASE_ID: process.env.MEIAO_RELEASE_ID || '',
        MEIAO_DB_HOST: '127.0.0.1',
        MEIAO_DB_PORT: '3307',
        MEIAO_DB_USER: process.env.MEIAO_DB_USER || 'root',
        MEIAO_DB_PASSWORD: process.env.MEIAO_DB_PASSWORD || '',
        MEIAO_DB_NAME: process.env.MEIAO_DB_NAME || 'meiao_internal',
        MEIAO_SPIDER_GATEWAY_URL: process.env.MEIAO_SPIDER_GATEWAY_URL || '',
        MEIAO_SPIDER_API_KEY: process.env.MEIAO_SPIDER_API_KEY || '',
        MEIAO_PUBLIC_BASE_URL: process.env.MEIAO_PUBLIC_BASE_URL || '',
        KIE_API_KEY: process.env.KIE_API_KEY || '',
        ARK_API_KEY: process.env.ARK_API_KEY || '',
      },
    },
  ],
};
