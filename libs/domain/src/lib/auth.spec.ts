import { loginRequestSchema } from './auth';

describe('loginRequestSchema', () => {
  it('accepts a well-formed email and password', () => {
    const body = { email: 'ada@hexly.test', password: 'correct horse' };

    expect(loginRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects a body that is missing the password', () => {
    expect(() => loginRequestSchema.parse({ email: 'ada@hexly.test' })).toThrow();
  });

  it('rejects an empty email', () => {
    expect(() =>
      loginRequestSchema.parse({ email: '', password: 'correct horse' }),
    ).toThrow();
  });
});
