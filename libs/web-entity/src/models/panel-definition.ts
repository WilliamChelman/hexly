import { Type } from '@angular/core';
import { IconName } from '@hexly/web-ui';

/**
 * A **Panel** id — a `core.panel.*`-style namespaced key identifying one togglable side Panel the page's
 * Dock can hold (ADR-0067). Its own keyspace, distinct from View ids (`core.view.*`) and Entity Type ids
 * (`core.type.note`): a Panel and a View are different chrome, and one Entity affords many of each.
 */
export type PanelId = `${string}.panel.${string}`;

/**
 * One Panel's declaration for the page-owned **Dock** (ADR-0067) — the same contract *shape* as a
 * {@link ViewDefinition}, so the Dock's toggle strip is derivable synchronously from the definition
 * before the Panel's lazy body loads. A Panel is contributed either **universally** (References, the
 * Details panel — present on every View) or by a View through its {@link ViewDefinition.panels}.
 *
 * `writeGate` marks a Panel available only when the viewer may edit (ADR-0037): an editing-only Panel
 * leaves the strip for a read-only viewer, where a read affordance (References) stays.
 *
 * `component` vs `loadComponent` follows the same rule as a View: `component` for a body already in the
 * chunk that registers the Panel; `loadComponent` for one that must stay off the initial bundle. Either
 * way the id, icon, and label are known up front, so the strip draws a toggle for a Panel it has not
 * fetched.
 */
export type PanelDefinition = {
  readonly id: PanelId;
  /** The glyph the Dock's toggle strip draws for this Panel (ADR-0014). */
  readonly icon: IconName;
  /** transloco key for the toggle's accessible name / tooltip (ADR-0014). */
  readonly labelKey: string;
  /** When true the Panel is offered only to a viewer who may write (ADR-0037); a read affordance omits it. */
  readonly writeGate?: boolean;
} & (
  | {
      /** The Panel body the Dock outlets — for a body already shipped in the registering chunk. */
      readonly component: Type<unknown>;
      readonly loadComponent?: never;
    }
  | {
      readonly component?: never;
      /** Fetches the Panel body on first open, keeping it off the initial bundle. */
      readonly loadComponent: () => Promise<Type<unknown>>;
    }
);
