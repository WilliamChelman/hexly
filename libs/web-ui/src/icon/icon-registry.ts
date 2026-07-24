import { Injectable, inject } from '@angular/core';
import {
  LucideCheck,
  LucideChevronsRight,
  LucideChevronDown,
  LucideLayoutDashboard,
  LucideLoaderCircle,
  LucidePencil,
  LucideX,
  LucideEllipsisVertical,
  LucideListTree,
  LucideLink2,
  LucideEraser,
  LucideExternalLink,
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
  LucideWaypoints,
} from '@lucide/angular';
import { ICON_GLYPHS, IconGlyph, lucideGlyph } from './icon-glyph';

/**
 * The two bespoke glyphs that aren't Lucide: the app's hexagon `logo` and the organic `region`
 * blob. Each is the `<svg>` inner markup plus the root attrs that vary per glyph (ADR-0007).
 * Everything else is Lucide — see {@link LUCIDE_SOURCES}.
 */
const CUSTOM = {
  logo: {
    attrs: '',
    body: '<path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z" fill="currentColor" opacity=".5" />',
  },
  region: {
    attrs: 'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="3 2.5"',
    body: '<path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />',
  },
} as const;

/**
 * Our stable, domain-facing glyph name → the Lucide icon it renders. We read the icon's `node` data
 * (not Lucide's `<svg lucideIcon>` directive) and draw it ourselves, on the same trusted-inline-SVG
 * path the bespoke glyphs use. A plugin adds to this vocabulary at runtime via `provideIcons`, so a
 * type's glyph is no longer smuggled in here (ADR-0007, #192).
 */
const LUCIDE_SOURCES = {
  check: LucideCheck,
  chevrons: LucideChevronsRight,
  /** A menu trigger's arrowhead — the split "New" button's, and any dropdown's. */
  'chevron-down': LucideChevronDown,
  close: LucideX,
  dashboard: LucideLayoutDashboard,
  /** Pending edits — the autosave chip's dirty glyph. */
  pencil: LucidePencil,
  /** Work in flight; spun by the caller (`animate-spin`). */
  spinner: LucideLoaderCircle,
  more: LucideEllipsisVertical,
  outline: LucideListTree,
  link: LucideLink2,
  'external-link': LucideExternalLink,
  erase: LucideEraser,
  fit: LucideMaximize,
  graph: LucideWaypoints,
  label: LucideType,
  library: LucideLibrary,
  palette: LucidePalette,
  marquee: LucideSquareDashed,
  minus: LucideMinus,
  moon: LucideMoon,
  plus: LucidePlus,
  redo: LucideRedo2,
  select: LucideMousePointer2,
  settings: LucideSettings,
  share: LucideShare2,
  sun: LucideSun,
  terrain: LucideHexagon,
  undo: LucideUndo2,
  upload: LucideUpload,
  download: LucideDownload,
  user: LucideUser,
  globe: LucideGlobe,
} as const;

/** The built-in glyph names web-ui ships — autocompleted where {@link IconName} is required. */
export type CoreIconName = keyof typeof CUSTOM | keyof typeof LUCIDE_SOURCES;

/**
 * A glyph name `<app-icon>` can draw: a built-in {@link CoreIconName} (autocompleted) or any name a
 * plugin registers via `provideIcons` (ADR-0007). The `(string & {})` arm keeps the literal
 * suggestions while admitting arbitrary runtime names — icons are now registry-, not union-, gated.
 */
export type IconName = CoreIconName | (string & {});

/**
 * Root vocabulary the `<app-icon>` dispatcher reads (ADR-0007): web-ui's built-in glyphs, seeded
 * eagerly, plus any a plugin contributes through {@link provideIcons}. One place resolves a name to
 * the SVG markup that draws it, so a plugin extends the vocabulary without editing web-ui.
 */
@Injectable({ providedIn: 'root' })
export class IconRegistry {
  private readonly glyphs = new Map<string, IconGlyph>();

  constructor() {
    for (const [name, glyph] of Object.entries(CUSTOM)) this.glyphs.set(name, { name, ...glyph });
    for (const [name, source] of Object.entries(LUCIDE_SOURCES)) this.glyphs.set(name, lucideGlyph(name, source));
    // Plugin contributions register last, so one may deliberately override a core glyph by name.
    for (const glyph of inject(ICON_GLYPHS, { optional: true }) ?? []) this.glyphs.set(glyph.name, glyph);
  }

  /** The glyph for `name`, or `undefined` for an unregistered one — e.g. a disabled plugin's. */
  get(name: string): IconGlyph | undefined {
    return this.glyphs.get(name);
  }
}
