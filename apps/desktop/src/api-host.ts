import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ASSETS_DIR, AuthService, createApiApp, pinDeployment } from '../../api/src/host';

/** Loopback, never `0.0.0.0`: unreachable from the LAN, and it opens no firewall hole (ADR-0070). */
const LOOPBACK = '127.0.0.1';

/** The API running inside the Electron main process — one process, one origin (ADR-0008, ADR-0070). */
export interface ApiHost {
  /** `http://127.0.0.1:<port>`: the single origin serving `/api`, the SPA, and Asset capability URLs. */
  readonly origin: string;
  /** How main holds the Sole User's identity — the same service every route resolves sessions through. */
  readonly auth: AuthService;
  /**
   * Where this Instance's Asset bytes are, as `ASSETS_DIR` resolved `assets.dir` (#324). Read off the running
   * app rather than recomputed, so the folder main offers to move is by construction the one being served.
   */
  readonly assetsDir: string;
  /**
   * The listening server, so main can see what its own event loop is answering (#329) — the instrument sits
   * out here rather than as Nest middleware, because the loop being served is main's problem, not the API's.
   */
  readonly server: Server;
  /** Close the app, running the shutdown hooks that close the SQLite handle (ADR-0027). */
  close(): Promise<void>;
}

/**
 * Boot the same Nest `AppModule` the server binary boots and listen on an ephemeral loopback port,
 * resolving once the port is known — so no caller points a window at a socket that is not up yet.
 */
export async function startApiHost(): Promise<ApiHost> {
  // Both knobs pinned by this entry point (ADR-0071): `profile` has no `hexly.yml` key, and Collaboration
  // is an override, so a `features.collaboration: true` in this Instance's file is ignored.
  pinDeployment({ profile: 'desktop', collaboration: false });
  // The Host/Origin wall is this entry point's to ask for: we bind loopback and are the only caller of our
  // own socket, so anything addressing us by another name has been rebound at us (ADR-0070).
  const app = await createApiApp({ loopbackOnly: true });
  // Port 0 makes a visited web page scan ~16k ports to find us: cost, not security. The walls that matter
  // are the session cookie, the absence of CORS, and the Host/Origin rejection above (ADR-0070).
  await app.listen(0, LOOPBACK);
  const server: Server = app.getHttpServer();
  return {
    origin: `http://${LOOPBACK}:${boundPort(server.address())}`,
    auth: app.get(AuthService),
    assetsDir: app.get<string>(ASSETS_DIR),
    server,
    close: async () => {
      // `server.close()` waits for open connections and a live-follow SSE stream never ends (ADR-0044),
      // so quitting with an Entity open would hang. The renderer goes away with us.
      server.closeAllConnections();
      await app.close();
    },
  };
}

/** A listening TCP server always reports an {@link AddressInfo}; anything else means we are not up. */
function boundPort(address: AddressInfo | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new Error(`Hexly's API is not listening on a TCP port (address: ${JSON.stringify(address)})`);
  }
  return address.port;
}
