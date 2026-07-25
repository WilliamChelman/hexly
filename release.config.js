module.exports = {
  branches: ['main', { name: 'beta', prerelease: true }],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/github',
      {
        /**
         * Cut as a draft; `ci.yml`'s `publish-release` undrafts it once every platform's installer is attached
         * (#328), so a release becomes visible complete or not at all.
         */
        draftRelease: true,
      },
    ],
  ],
};
