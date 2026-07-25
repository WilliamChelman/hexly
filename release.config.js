module.exports = {
  branches: ['main', { name: 'beta', prerelease: true }],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/github',
      {
        /**
         * Cut as a draft; `ci.yml`'s `publish-release` job undrafts it once every platform's desktop installer
         * is attached (#328). One release is one place, so it becomes visible complete or not at all — a
         * platform whose build failed leaves an unpublished draft rather than a published release missing a
         * download nobody was told to expect. The tag, and the container image tagged with it, are unaffected.
         */
        draftRelease: true,
      },
    ],
  ],
};
