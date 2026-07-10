import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  type LucideIconData,
  LucideChevronsRight,
  LucideLayoutDashboard,
  LucideX,
  LucideEllipsisVertical,
  LucideListTree,
  LucideEraser,
  LucideMaximize,
  LucideType,
  LucideLibrary,
  LucidePalette,
  LucideSquareDashed,
  LucideMinus,
  LucideMoon,
  LucidePlus,
  LucideRedo2,
  LucideMousePointer2,
  LucideSettings,
  LucideShare2,
  LucideSun,
  LucideHexagon,
  LucideUndo2,
  LucideUpload,
  LucideDownload,
  LucideUser,
  LucideGlobe,
} from '@lucide/angular';
import { featureLibrary } from '@hexly/domain';
import { IconHost } from './icon-host';

/** The settlement marker art, shared with the canvas via `featureLibrary` (ADR-0006). */
const SETTLEMENT_PATH =
  featureLibrary.find((f) => f.id === 'settlement')?.path ?? '';

/** The `<svg>` root attrs Lucide glyphs are drawn with (its house stroke, lightened to 1.6). */
const LUCIDE_ATTRS =
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

/**
 * Serialize a Lucide icon's node list (`[tag, attrs]` pairs) to SVG inner markup.
 * `key` is React-reconciliation metadata Lucide ships in the data — dropped here.
 */
function lucideBody(data: LucideIconData): string {
  return data.node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${a} />`;
    })
    .join('');
}

/**
 * The three bespoke glyphs that aren't Lucide: the app's hexagon `logo`, the
 * `settlement` marker (domain art from `featureLibrary`, shared with the canvas),
 * and the organic `region` blob. Each is the `<svg>` inner markup plus the root
 * attrs that vary per glyph (ADR-0007). Everything else is Lucide — see {@link LUCIDE}.
 */
const CUSTOM = {
  logo: {
    attrs: '',
    body: '<path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z" fill="currentColor" opacity=".5" />',
  },
  region: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="3 2.5"',
    body: '<path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />',
  },
  settlement: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: `<path d="${SETTLEMENT_PATH}" />`,
  },
} as const;

/**
 * Our stable, domain-facing glyph name → the Lucide icon data it renders. We read
 * the icon's `node` data (not Lucide's `<svg lucideIcon>` directive) and draw it
 * ourselves — the same trusted-inline-SVG path the bespoke glyphs use — so the
 * dependency is honest and tree-shaken while call sites keep our vocabulary.
 */
const LUCIDE: Record<string, LucideIconData> = {
  chevrons: LucideChevronsRight.icon,
  close: LucideX.icon,
  dashboard: LucideLayoutDashboard.icon,
  more: LucideEllipsisVertical.icon,
  outline: LucideListTree.icon,
  erase: LucideEraser.icon,
  fit: LucideMaximize.icon,
  label: LucideType.icon,
  library: LucideLibrary.icon,
  palette: LucidePalette.icon,
  marquee: LucideSquareDashed.icon,
  minus: LucideMinus.icon,
  moon: LucideMoon.icon,
  plus: LucidePlus.icon,
  redo: LucideRedo2.icon,
  select: LucideMousePointer2.icon,
  settings: LucideSettings.icon,
  share: LucideShare2.icon,
  sun: LucideSun.icon,
  terrain: LucideHexagon.icon,
  undo: LucideUndo2.icon,
  upload: LucideUpload.icon,
  download: LucideDownload.icon,
  user: LucideUser.icon,
  globe: LucideGlobe.icon,
};

export type IconName = keyof typeof CUSTOM | keyof typeof LUCIDE;

/**
 * One built-in glyph, picked by `name` and drawn in `currentColor` at `size`
 * (ADR-0007). Standard glyphs come from Lucide's icon data ({@link LUCIDE}); a few
 * bespoke ones ({@link CUSTOM}) are authored inline. Either way the markup is trusted
 * and injected verbatim — `bypassSecurityTrustHtml` skips the sanitizer that would
 * strip the `<svg>`. For a runtime/arbitrary path, use {@link IconPath}.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHost],
  host: { '[innerHTML]': 'svg()' },
  template: '',
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<IconName>();
  readonly size = input(24);

  protected readonly svg = computed(() => {
    const name = this.name();
    const custom = (CUSTOM as Record<string, { attrs: string; body: string }>)[
      name
    ];
    const { attrs, body } = custom ?? {
      attrs: LUCIDE_ATTRS,
      body: lucideBody(LUCIDE[name]),
    };
    const s = this.size();
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" ${attrs}>${body}</svg>`,
    );
  });
}
