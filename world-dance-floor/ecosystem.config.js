module.exports = {
  apps: [
    {
      name: 'WDF',
      script: './src/server.js',
      exec_mode: 'fork',
      instances: 1,
      watch: true,
      ignore_watch: ["node_modules/", "logs", "src/data/"],
      out_file: '/dev/null', // use /dev/null to disable
      error_file: '/dev/null', // use /dev/null to disable
    },
  ],
};
