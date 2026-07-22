import { InjectionToken } from '@angular/core';
import { PanelDefinition } from '../models/panel-definition';

/** The References Panel's id — the core materialized link index made a Dock Panel (ADR-0046, ADR-0067). */
export const CORE_PANEL_REFERENCES = 'core.panel.references';

/** The Details Panel's id — Types, Fields, and untyped keys made a Dock Panel (ADR-0067). */
export const CORE_PANEL_DETAILS = 'core.panel.details';

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
 * The **universal Panels** the page's Dock offers on every View (ADR-0067), merged with the active
 * View's own {@link ViewDefinition.panels}. A token, not a constant, so a mount can *narrow* the set:
 * a Public Link page drops References, since it needs `GET /entities/:id/references`, which answers an
 * authenticated user an anonymous reader is not — but keeps the read-only Details panel.
 */
export const UNIVERSAL_PANELS = new InjectionToken<readonly PanelDefinition[]>('hexly.dock.universalPanels', {
  factory: (): readonly PanelDefinition[] => [DETAILS_PANEL, REFERENCES_PANEL],
});
