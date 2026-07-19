import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  LucideAnchor,
  LucideCrown,
  LucideDices,
  LucideFootprints,
  LucideGauge,
  LucideHeart,
  LucideRuler,
  LucideShieldAlert,
  LucideShieldCheck,
  LucideSwords,
  LucideZap,
} from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIconFont, provideIcons } from '@hexly/web-ui';
import { PLUGIN_ID, DS_STAT_BLOCK, DS_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-draw-steel';
import { DS_TRANSLATIONS } from './i18n/draw-steel-translations';
import { DS_TYPE_DEFINITIONS, DS_VIEW_STAT_BLOCK } from './draw-steel-types';
import { DS_FONT, DS_FONT_GLYPHS } from './ds-glyphs';

/**
 * The Draw Steel plugin's one entry point into the app (ADR-0048), the sibling of `providePluginDnd`.
 *
 * The stat block is deferred because this provider runs in the root injector, where naming the class
 * would pull the view body onto the initial bundle. Its id and label still register at startup, so the
 * header can draw the view toggle; only the body waits for the first monster.
 */
export function providePluginDrawSteel(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // A bundled plugin dresses its types in glyphs web-ui's core vocabulary omits by registering them
    // here, not by editing web-ui (ADR-0007): the `swords`/`dices` glyphs the monster type and read-view
    // roller wear (#242, #252) and the `ds-*` Lucide glyphs the read card labels its spec-sheet stats and
    // immunity/weakness chips with, plus the `ds-*` symbols the bundled Draw Steel font draws (the
    // ability/tier/characteristic marks) — the font itself loaded through `provideIconFont`.
    provideIconFont(DS_FONT),
    provideIcons([
      lucideGlyph('swords', LucideSwords),
      lucideGlyph('dices', LucideDices),
      lucideGlyph('ds-size', LucideRuler),
      lucideGlyph('ds-speed', LucideGauge),
      lucideGlyph('ds-stamina', LucideHeart),
      lucideGlyph('ds-stability', LucideAnchor),
      lucideGlyph('ds-free-strike', LucideZap),
      lucideGlyph('ds-movement', LucideFootprints),
      lucideGlyph('ds-captain', LucideCrown),
      lucideGlyph('ds-immunity', LucideShieldCheck),
      lucideGlyph('ds-weakness', LucideShieldAlert),
      ...DS_FONT_GLYPHS,
    ]),
    providePlugin({
      id: PLUGIN_ID,
      types: DS_TYPE_DEFINITIONS,
      // The `draw-steel.stat-block` structured Field (ADR-0054); the prose `core.content` it also
      // references is the content plugin's.
      fields: [DS_STAT_BLOCK_FIELD],
      views: [
        {
          id: DS_VIEW_STAT_BLOCK,
          // The `draw-steel.stat-block` data-type's View, not the `draw-steel.monster` type's (ADR-0055):
          // it renders whichever stat-block Field placed it and takes its toggle label from that Field —
          // so no toggle copy of its own, mirroring the map View (ADR-0050).
          dataType: DS_STAT_BLOCK,
          // The copy naming the *kind* where a World Owner picks it, in the World Types editor (#201).
          dataTypeLabelKey: 'drawSteel.statBlock.dataType',
          loadComponent: () => import('./components/stat-block-view.component').then((m) => m.StatBlockViewComponent),
        },
      ],
      dataTypes: [STAT_BLOCK_DATA_TYPE],
      translations: DS_TRANSLATIONS,
    }),
  ]);
}
