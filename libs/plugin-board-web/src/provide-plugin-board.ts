import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  LucideArrowDown,
  LucideArrowDownToLine,
  LucideArrowUp,
  LucideArrowUpToLine,
  LucideFrame,
  LucideImage,
  LucideLayers,
  LucideLock,
  LucideLockOpen,
  LucideScaling,
  LucideSquare,
  LucideUnfoldHorizontal,
  LucideUnfoldVertical,
} from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIcons } from '@hexly/web-ui';
import { BOARD_SURFACE_DATA_TYPE, CORE_BOARD_SURFACE, PLUGIN_ID, SURFACE_FIELD } from '@hexly/plugin-board';
import { BOARD_TRANSLATIONS } from './i18n/board-translations';
import { BOARD_INSPECTOR_PANEL, BOARD_TYPE_DEFINITIONS, CORE_VIEW_BOARD } from './board-types';

/**
 * The Board plugin's one entry point into the app (ADR-0048, ADR-0050): `app.config.ts` names this
 * and nothing else.
 *
 * An Instance that omits it still opens existing Boards: `core.type.board` becomes an unregistered type, so
 * the Entity affords its Content and the generic Field view, and the surface stays put as plain
 * EntityDocument (the absent-plugin degradation of ADR-0048).
 *
 * The canvas is deferred because this provider runs in the root injector, where naming the board View
 * eagerly would drag the surface canvas onto the initial bundle. The View's id and label still
 * register at startup, so the header can draw its toggle before the body is fetched.
 */
export function providePluginBoard(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The plugin's own Tool glyphs (Box/Image/Embed), registered here rather than smuggled into web-ui's
    // core vocabulary (ADR-0007, ADR-0050): the Text Tool reuses core `label` (both are "add text"), and
    // the Image placeholder reuses `board-image`. All Lucide, so the palette matches the rest of the app.
    provideIcons([
      lucideGlyph('board-box', LucideSquare),
      lucideGlyph('board-image', LucideImage),
      lucideGlyph('board-embed', LucideFrame),
      // The selection-control glyphs: the resize-menu trigger and its per-axis fits, the Image
      // aspect-ratio lock's on/off faces, and the stacking-order menu trigger with its four moves.
      lucideGlyph('board-resize', LucideScaling),
      lucideGlyph('board-fit-width', LucideUnfoldHorizontal),
      lucideGlyph('board-fit-height', LucideUnfoldVertical),
      lucideGlyph('board-lock-ratio', LucideLock),
      lucideGlyph('board-lock-ratio-open', LucideLockOpen),
      lucideGlyph('board-stack', LucideLayers),
      lucideGlyph('board-to-front', LucideArrowUpToLine),
      lucideGlyph('board-forward', LucideArrowUp),
      lucideGlyph('board-backward', LucideArrowDown),
      lucideGlyph('board-to-back', LucideArrowDownToLine),
    ]),
    providePlugin({
      id: PLUGIN_ID,
      types: BOARD_TYPE_DEFINITIONS,
      // Declares the surface Field (ADR-0054); the prose `core.field.content` it references is the content plugin's.
      fields: [SURFACE_FIELD],
      views: [
        {
          id: CORE_VIEW_BOARD,
          // The `core.datatype.board-surface` data-type's View, not the `core.type.board` type's: it renders whichever
          // surface Field placed it, and takes its toggle's label from that Field — hence no toggle copy
          // of its own (ADR-0050).
          dataType: CORE_BOARD_SURFACE,
          // The copy naming the *kind* where a World Owner picks it, in the World Types editor (#201).
          dataTypeLabelKey: 'board.dataType.surface',
          // The View contributes its Inspector Panel to the page Dock (ADR-0067): declared, so the Dock
          // draws the toggle synchronously before this View's body is fetched, and hosts the Panel with
          // the View's injector so it reaches the View-scoped BoardStore.
          panels: [BOARD_INSPECTOR_PANEL],
          loadComponent: () => import('./components/board-view.component').then((m) => m.BoardViewComponent),
        },
      ],
      dataTypes: [BOARD_SURFACE_DATA_TYPE],
      // Eager: the type's chrome lives in BOARD_TYPE_DEFINITIONS as transloco keys, rendered by the app's
      // header, browser, and command palette — where no pipe of ours is there to trigger the load (ADR-0049).
      translations: BOARD_TRANSLATIONS,
    }),
  ]);
}
