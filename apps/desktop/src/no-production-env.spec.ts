describe('the production-NODE_ENV guard', () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('clears an inherited production value, so the session cookie is not `secure` over loopback', async () => {
    process.env.NODE_ENV = 'production';

    vi.resetModules();
    await import('./no-production-env');

    expect(process.env.NODE_ENV).toBeUndefined();
  });

  it('leaves any other value alone', async () => {
    process.env.NODE_ENV = 'development';

    vi.resetModules();
    await import('./no-production-env');

    expect(process.env.NODE_ENV).toBe('development');
  });
});
