/**
 * The client's view of the Instance Configuration (ADR-0052, Seam 4): the subset served, unauthenticated,
 * by `GET /api/config`. A projection of the server's `HexlyConfig`, not a second store — room for future
 * client knobs, today just Plugin enablement and the default create Type.
 */
export interface ClientConfig {
  /** Each bundled Plugin, keyed by `PLUGIN_ID`; every bundled Plugin has an entry whether or not `hexly.yml` names it. */
  plugins: Record<string, ClientPluginConfig>;
  entities: {
    /** The Type id the "New" button mints by default; resolved softly, client-side. */
    defaultType: string;
  };
}

/** A single Plugin's client-visible config — `enabled` today, room for client knobs later. */
export interface ClientPluginConfig {
  enabled: boolean;
}
