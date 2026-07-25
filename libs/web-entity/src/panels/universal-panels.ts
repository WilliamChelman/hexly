import { InjectionToken } from '@angular/core';
import { PanelDefinition } from '../models/panel-definition';

/** The References Panel's id — the core materialized link index made a Dock Panel (ADR-0046, ADR-0067). */
export const CORE_PANEL_REFERENCES = 'core.panel.references';

/** The Details Panel's id — Types, Fields, and untyped keys made a Dock Panel (ADR-0067). */
export const CORE_PANEL_DETAILS = 'core.panel.details';

/** The Local Graph Panel's id — the World Graph centred on the open Entity (ADR-0072). */
export const CORE_PANEL_LOCAL_GRAPH = 'core.panel.local-graph';

/**
 * **References**, the first universal Panel (ADR-0067) — present on every View, including Assets. Its
 * body is deferred (`loadComponent`) so the panel, its row, and its store stay off whatever eager
 * surface `web-entity` ships, only fetched when the Panel is first opened.
 */
export const REFERENCES_PANEL: PanelDefinition = {
  id: CORE_PANEL_REFERENCES,
  icon: 'link',
  labelKey: 'fields.links.toggle',
  loadComponent: () => import('../components/references-panel.component').then((m) => m.ReferencesPanelComponent),
};

/**
 * **Details**, the second universal Panel (ADR-0067) — present on every View: the Entity's Types,
 * declared Fields (edited in place), and untyped keys. Not write-gated: the panel is always readable,
 * gating each management affordance internally, so a read-only session keeps a read-only Details panel
 * (the Public Link page relies on this). Its body is deferred to stay off the eager surface.
 */
export const DETAILS_PANEL: PanelDefinition = {
  id: CORE_PANEL_DETAILS,
  icon: 'label',
  labelKey: 'fields.details.toggle',
  loadComponent: () => import('../components/details-panel.component').then((m) => m.DetailsPanelComponent),
};

/**
 * **Local Graph**, the third universal Panel (ADR-0072) — present on every View: the World Graph's
 * drawing centred on the open Entity, `depth` hops out. It sits beside References because they answer the
 * same question in two registers — a list of names, and the shape those names make. Deferred like the
 * others, which also keeps cosmos.gl's WebGL renderer off any surface that never opens it.
 */
export const LOCAL_GRAPH_PANEL: PanelDefinition = {
  id: CORE_PANEL_LOCAL_GRAPH,
  icon: 'graph',
  labelKey: 'fields.localGraph.toggle',
  loadComponent: () => import('../components/local-graph-panel.component').then((m) => m.LocalGraphPanelComponent),
};

/**
 * The **universal Panels** the page's Dock offers on every View (ADR-0067), merged with the active
 * View's own {@link ViewDefinition.panels}. A plain constant, not a token: a mount no longer *narrows*
 * this set by substituting its own — it filters the merged availability through {@link PANEL_FILTER}
 * instead, a general mechanism that drops a Panel by identity wherever it came from.
 */
export const UNIVERSAL_PANELS: readonly PanelDefinition[] = [DETAILS_PANEL, REFERENCES_PANEL, LOCAL_GRAPH_PANEL];

/** A page-level predicate deciding whether a Panel is offered at all — see {@link PANEL_FILTER}. */
export type PanelFilter = (panel: PanelDefinition) => boolean;

/**
 * The page's **Panel-availability filter** (ADR-0067): a predicate the Dock runs over the whole merged
 * set (universal ∪ the active View's) before write-gating, so a mount can suppress a Panel by identity
 * regardless of who contributed it. Defaults to offering everything; a Public Link page provides one
 * that drops the two link-index Panels — References and the Local Graph — since each needs a
 * `GET /entities/:id/…` read that answers an authenticated user an anonymous reader is not, while the
 * read-only Details panel stays, showing the same substance the fallback Details View already gives any
 * reader.
 */
export const PANEL_FILTER = new InjectionToken<PanelFilter>('hexly.dock.panelFilter', {
  factory: (): PanelFilter => () => true,
});
