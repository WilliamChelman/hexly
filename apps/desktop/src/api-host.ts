import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ASSETS_DIR, AuthService, createApiApp, pinDeployment } from '../../api/src/host';

/** Loopback, never `0.0.0.0`: unreachable from the LAN, and it opens no firewall hole (ADR-0070). */
const LOOPBACK = '127.0.0.1';

/** The API running inside the Electron main process — one process, one origin (ADR-0008, ADR-0070). */
export interface ApiHost {
  /** The single origin serving `/api`, the SPA, and Asset capability URLs. */
  readonly origin: string;
  readonly auth: AuthService;
  /** `ASSETS_DIR` as the running app resolved it (#324), so the folder main offers to move is the one served. */
  readonly assetsDir: string;
  /** The listening server, so main can see what its own event loop is answering (#329). */
  readonly server: Server;
  /** Close the app, running the shutdown hooks that close the SQLite handle (ADR-0027). */
  close(): Promise<void>;
}

/** Boot the API and listen on an ephemeral loopback port, resolving only once the port is known. */
export async function startApiHost(): Promise<ApiHost> {
  // Both knobs pinned here (ADR-0071): `profile` has no `hexly.yml` key, and Collaboration is an override.
  pinDeployment({ profile: 'desktop', collaboration: false });
  // We bind loopback and are the only caller of our own socket, so anything addressing us by another name has
  // been rebound at us (ADR-0070).
  const app = await createApiApp({ loopbackOnly: true });
  await app.listen(0, LOOPBACK);
  const server: Server = app.getHttpServer();
  return {
    origin: `http://${LOOPBACK}:${boundPort(server.address())}`,
    auth: app.get(AuthService),
    assetsDir: app.get<string>(ASSETS_DIR),
    server,
    close: async () => {
      // `server.close()` waits for open connections and a live-follow SSE stream never ends (ADR-0044).
      server.closeAllConnections();
      await app.close();
    },
  };
}

function boundPort(address: AddressInfo | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new Error(`Hexly's API is not listening on a TCP port (address: ${JSON.stringify(address)})`);
  }
  return address.port;
}
