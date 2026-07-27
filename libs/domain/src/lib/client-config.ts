import { InstanceTheme } from './world-theme';

/** Pinned by the entry point, with no `hexly.yml` key of its own (ADR-0071). */
export const DEPLOYMENT_PROFILES = ['desktop', 'server'] as const;
export type DeploymentProfile = (typeof DEPLOYMENT_PROFILES)[number];

/**
 * The client's view of the Instance Configuration (ADR-0052, Seam 4): the subset served, unauthenticated,
 * by `GET /api/config`. A projection of the server's `HexlyConfig`, not a second store — room for future
 * client knobs, today Plugin enablement, the default create Type, ADR-0073's two Inline Creation knobs,
 * and ADR-0071's two deployment knobs.
 */
export interface ClientConfig {
  /** This Instance's Deployment Profile (ADR-0071). */
  profile: DeploymentProfile;
  /** Whether the Collaboration layer is on (ADR-0071): sharing, World roles, Visibility, Public Links. */
  collaboration: boolean;
  /** Each bundled Plugin, keyed by `PLUGIN_ID`; every bundled Plugin has an entry whether or not `hexly.yml` names it. */
  plugins: Record<string, ClientPluginConfig>;
  entities: {
    /** The Type id the "New" button mints by default; resolved softly, client-side. */
    defaultType: string;
    /** The Type id Inline Creation mints, deliberately not `defaultType` (ADR-0073); resolved softly, client-side. */
    inlineType: string;
    /** The Tag applied to everything created inline (ADR-0073); absent unless the operator names one. */
    inlineTag?: string;
  };
  /**
   * The Instance operator's default Theme (ADR-0076, #372) — the resolution chain's first layer,
   * beneath every World's own. Absent unless the operator authored one; the chain ships empty.
   */
  theme?: InstanceTheme;
}

/** A single Plugin's client-visible config — `enabled`, plus any Plugin-specific client knobs it exposes. */
export interface ClientPluginConfig {
  enabled: boolean;
  /**
   * The Board's Embed transclusion depth cap (ADR-0062, `features.plugin.board.maxEmbedDepth`) — the one
   * Plugin-specific knob crossing to the client today. Present only on the Plugin that declares it.
   */
  maxEmbedDepth?: number;
}
