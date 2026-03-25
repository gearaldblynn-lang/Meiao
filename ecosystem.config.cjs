module.exports = {
  apps: [
    {
      name: 'meiao-internal',
      script: 'server/index.mjs',
      cwd: '/www/wwwroot/meiao-internal',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        MEIAO_DB_HOST: '127.0.0.1',
        MEIAO_DB_PORT: '3307',
        MEIAO_DB_USER: process.env.MEIAO_DB_USER || 'root',
        MEIAO_DB_PASSWORD: process.env.MEIAO_DB_PASSWORD || '',
        MEIAO_DB_NAME: process.env.MEIAO_DB_NAME || 'meiao_internal',
      },
    },
  ],
};
