/** @type {import('pm2').StartOptions} */
// NAME and PORT are set by post_deploy.sh from app.config
module.exports = {
  apps: [
    {
      name: process.env.NAME || "default-app",
      script: "node",
      args: "--import tsx/esm server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        // GCS_BACKUP_CREDENTIALS: process.env.GCS_BACKUP_CREDENTIALS,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        // GCS_BACKUP_CREDENTIALS: process.env.GCS_BACKUP_CREDENTIALS,
      },
      // VPS: set DATABASE_PATH if you want DB outside app dir, e.g. /var/lib/<name>/data/app.db
      // env: { DATABASE_PATH: "/var/lib/default-app/data/app.db" },
    },
  ],
};
