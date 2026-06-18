module.exports = {
  apps: [
    {
      name: 'file-collect',
      script: 'server.js',
      cwd: '/home/ubuntu/file-collect',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      error_file: '/home/ubuntu/file-collect/logs/err.log',
      out_file: '/home/ubuntu/file-collect/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
