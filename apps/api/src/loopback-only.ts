/**
 * The DNS-rebinding wall in front of the Desktop App's loopback socket — the one attack the absence of
 * CORS does not stop, since an attacker domain resolving to `127.0.0.1` is same-origin (ADR-0070).
 */
import type { IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import type { RequestHandler } from 'express';

/**
 * Rejects callers that did not address the socket by the address it bound; must be installed first of
 * all the middleware.
 */
export function loopbackOnly(): RequestHandler {
  return (req, res, next) => {
    const authority = boundAuthority(req.socket);
    if (addressesSocket(req.headers, authority)) return next();
    // 403, never 401: the client answers a 401 by re-minting a session (#321).
    res.status(403).type('text/plain').send(`Hexly answers only callers that address it as ${authority}.\n`);
  };
}

/** Read off the connection, so `listen(0)`'s ephemeral port needs no bookkeeping. */
function boundAuthority(socket: Pick<Socket, 'localAddress' | 'localPort'>): string {
  const address = socket.localAddress ?? '';
  // A Host header brackets an IPv6 address (RFC 3986); `localAddress` does not.
  return `${address.includes(':') ? `[${address}]` : address}:${socket.localPort ?? ''}`;
}

/**
 * An absent `Origin` passes: same-origin navigations, `<img>` (ADR-0034) and `EventSource` (ADR-0044)
 * send none, while a cross-origin page always sends its own.
 */
function addressesSocket(headers: Pick<IncomingHttpHeaders, 'host' | 'origin'>, authority: string): boolean {
  if (headers.host !== authority) return false;
  return headers.origin === undefined || headers.origin === `http://${authority}`;
}
