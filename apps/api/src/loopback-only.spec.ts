import type { Request, Response } from 'express';
import { loopbackOnly } from './loopback-only';

/** The socket the Desktop App's window reaches, and the address its requests therefore claim. */
const BOUND = { localAddress: '127.0.0.1', localPort: 54321 };
const ADDRESS = '127.0.0.1:54321';

/**
 * Put a request through the wall, reporting what it did with it: `passed` for a caller handed on to the
 * rest of the stack, a status for one it answered itself.
 */
function through(headers: Record<string, string>, socket = BOUND): { passed: boolean; status?: number; type?: string } {
  const result: { passed: boolean; status?: number; type?: string } = { passed: false };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    type(value: string) {
      result.type = value;
      return res;
    },
    send() {
      return res;
    },
  } as unknown as Response;

  loopbackOnly()({ headers, socket } as unknown as Request, res, () => (result.passed = true));
  return result;
}

describe('loopbackOnly (#321)', () => {
  it('passes the app’s own window, whose Host is the address main bound', () => {
    // No Origin: navigations, Asset `src` and the live-follow stream all send none.
    expect(through({ host: ADDRESS })).toEqual({ passed: true });
    // And a same-origin fetch, which names that same address.
    expect(through({ host: ADDRESS, origin: `http://${ADDRESS}` })).toEqual({ passed: true });
  });

  it('reads an IPv6 loopback socket as a Host header writes it', () => {
    expect(through({ host: '[::1]:7' }, { localAddress: '::1', localPort: 7 })).toEqual({ passed: true });
  });

  it('rejects a rebound name, which is the whole point (ADR-0070)', () => {
    // 403, not 401: a 401 is the one status the client answers by re-minting a session.
    expect(through({ host: 'hexly.evil.example' })).toEqual({ passed: false, status: 403, type: 'text/plain' });
    expect(through({ host: 'hexly.evil.example:54321' }).status).toBe(403);
  });

  it('rejects loopback named at a port we did not bind, and a request with no Host at all', () => {
    expect(through({ host: '127.0.0.1:1234' }).status).toBe(403);
    expect(through({}).status).toBe(403);
  });

  it('rejects a cross-origin caller once its Host is right, as a rebound page’s fetch would be', () => {
    expect(through({ host: ADDRESS, origin: 'https://evil.example' }).status).toBe(403);
    expect(through({ host: ADDRESS, origin: `https://${ADDRESS}` }).status).toBe(403);
    // An opaque origin is not this window either.
    expect(through({ host: ADDRESS, origin: 'null' }).status).toBe(403);
  });
});
