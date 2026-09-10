/** Optional PM2 file for a generic VPS. Not the www.mylumera.in path.
 *  Production is Firebase Hosting → Cloud Run (docs/FIREBASE_CLOUD_RUN_DEPLOY.md).
 *  Do not put secrets here.
 */
module.exports = {
  apps: [
    {
      name: "lumera",
      script: "dist/server.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
