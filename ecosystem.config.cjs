/** PM2 process file for a Hostinger VPS / SSH Node host. Do not put secrets here. */
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
