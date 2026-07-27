import { EnvironmentProviders, Injectable, InjectionToken, effect, inject, provideAppInitializer } from '@angular/core';
import { FONT_PAIRING_IDS, PALETTE_TOKENS, WorldTheme, WorldThemePalette } from '@hexly/domain';
import { DESIGN_TOKENS, DesignToken, isDesignToken } from '@hexly/web-styles';
import { ColorScheme, ColorSchemeService } from './color-scheme.service';
import { safeJsonParse, safeStorageGet, safeStorageSet } from '../utils/safe';
import { segment } from '../utils/pretty-id';

/**
 * Applying a World Theme (ADR-0076): the chain **Instance default → World Theme → the reader's
 * ColorScheme**, resolved to custom properties and written on `<html>` through the CSSOM.
 */

/** Which World the document is painted for: one reached by route, or one behind a World Public Link. */
export type WorldScope = { readonly worldId: string } | { readonly publicToken: string };

/**
 * One layer of the resolution chain: any subset of a Theme's fields. A stored {@link WorldTheme} is
 * one; so is the Instance default, which may brand a deployment with far fewer values than an Owner
 * authors — hence the partial Palettes.
 */
export interface WorldThemeLayer {
  readonly solar?: Partial<WorldThemePalette>;
  readonly astral?: Partial<WorldThemePalette>;
  readonly radii?: WorldTheme['radii'];
  readonly fontPairing?: WorldTheme['fontPairing'];
  readonly overrides?: WorldTheme['overrides'];
}

/**
 * The chain's first layer — an operator branding their deployment (ADR-0036 config YAML). Ships empty;
 * #372 provides it from the client config. Everything below it resolves the same either way, which is
 * the point of wiring it now rather than when it has a value.
 */
export const INSTANCE_THEME = new InjectionToken<WorldThemeLayer | null>('hexly.instanceTheme', {
  providedIn: 'root',
  factory: () => null,
});

/** The custom properties a chain resolves to, for one ColorScheme: token name → value. */
export type ThemeDeclarations = Readonly<Partial<Record<DesignToken, string>>>;

/** Both Palettes' declarations. Held together so a ColorScheme toggle needs no re-resolution. */
export type ThemeDeclarationSet = Readonly<Record<ColorScheme, ThemeDeclarations>>;

/** The cache the pre-paint bootstrap in `index.html` replays. Pinned: that script reads it by hand. */
export const WORLD_THEME_CACHE_KEY = 'hexly-world-theme';

/** How many Worlds' Themes the cache keeps, most recently applied first. */
const CACHE_MAX = 8;

const EMPTY: ThemeDeclarationSet = { solar: {}, astral: {} };

/**
 * The curated font pairings (spec §5.4). A pairing writes all four `--font-*` tokens at once, which is
 * why a Theme names one rather than setting the stacks one by one. `codex` is Hexly's own, read off the
 * manifest so the pairing and the default it restates cannot drift apart.
 */
const FONT_PAIRINGS: Readonly<Record<(typeof FONT_PAIRING_IDS)[number], ThemeDeclarations>> = {
  codex: Object.fromEntries(
    DESIGN_TOKENS.filter((decl) => decl.type === 'font-pairing').map((decl) => [decl.name, decl.initial]),
  ),
};

/**
 * The route families a World scope can be reached through. A World Public Link is keyed by its token
 * because the visitor never learns a World id, and both shapes have to be recoverable from the URL
 * alone — that is what lets the cache be found before anything is fetched.
 */
const SCOPE_PATH = /^\/(public\/w|w)\/([^/]+)/;

/**
 * The World scope a URL names, or `null` outside one. The decorative slug is dropped and the base62
 * code kept (ADR-0042), so a rename still hits the cache. `index.html`'s pre-paint bootstrap mirrors
 * this — it is the one place that cannot import it.
 */
export function worldThemeScope(pathname: string): string | null {
  const match = SCOPE_PATH.exec(pathname);
  if (!match) return null;
  const [, route, seg] = match;
  return `${route}/${route === 'w' ? seg.slice(seg.lastIndexOf('-') + 1) : seg}`;
}

/** The same scope, named by what the app holds rather than by what the URL shows. */
function scopeOf(scope: WorldScope): string {
  return 'worldId' in scope ? `w/${segment(scope.worldId)}` : `public/w/${scope.publicToken}`;
}

/** One layer's contribution to a ColorScheme, in application order — tier 1 first, opt-outs last. */
function declarationsFor(layers: readonly (WorldThemeLayer | null | undefined)[], scheme: ColorScheme) {
  const declarations: Partial<Record<DesignToken, string>> = {};

  // Tier 1 carries the identity: the eight anchors and three knobs every tier-2 role derives from
  // (ADR-0075), so writing these eleven re-themes the whole interface.
  const anchors: Partial<WorldThemePalette> = Object.assign({}, ...layers.map((layer) => layer?.[scheme] ?? {}));
  for (const [field, token] of Object.entries(PALETTE_TOKENS)) {
    const value = anchors[field as keyof WorldThemePalette];
    if (value !== undefined) declarations[token] = String(value);
  }

  // Radii are ColorScheme-independent, so one set answers for both Palettes.
  for (const layer of layers) Object.assign(declarations, layer?.radii);
  const pairing = layers.reduce<WorldTheme['fontPairing']>((id, layer) => layer?.fontPairing ?? id, undefined);
  if (pairing) Object.assign(declarations, FONT_PAIRINGS[pairing]);
  // Last, because an override is an opt-out from the role the anchors above would have derived.
  for (const layer of layers) Object.assign(declarations, layer?.overrides?.[scheme]);

  return declarations;
}

/**
 * Resolve the chain into what the applier writes. Later layers win field by field, so the Instance
 * default survives wherever the World Theme is silent. Pure — the seam the editor's preview and the
 * contrast probe read through too.
 */
export function resolveWorldTheme(layers: readonly (WorldThemeLayer | null | undefined)[]): ThemeDeclarationSet {
  return {
    solar: declarationsFor(layers, 'solar'),
    astral: declarationsFor(layers, 'astral'),
  };
}

/** One World's last-applied Theme, as the cache holds it: already resolved, so the replay is dumb. */
interface CachedScope {
  readonly scope: string;
  readonly solar: ThemeDeclarations;
  readonly astral: ThemeDeclarations;
}

/** Keep only what the manifest declares — the cache is replayed by a script that cannot check. */
function declared(value: unknown): ThemeDeclarations {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([name, raw]) => isDesignToken(name) && typeof raw === 'string'),
  );
}

function readCache(): CachedScope[] {
  const raw = safeStorageGet(WORLD_THEME_CACHE_KEY).unwrapOr(null);
  if (!raw) return [];
  const parsed = safeJsonParse<unknown>(raw).unwrapOr(null);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is { scope: string } => typeof (entry as CachedScope)?.scope === 'string')
    .map((entry) => ({
      scope: entry.scope,
      solar: declared((entry as Partial<CachedScope>).solar),
      astral: declared((entry as Partial<CachedScope>).astral),
    }));
}

@Injectable({ providedIn: 'root' })
export class WorldThemeApplier {
  private readonly colorScheme = inject(ColorSchemeService);
  private readonly instance = inject(INSTANCE_THEME);

  /**
   * The scope the document is painted for: `null` outside every World, and `undefined` before the
   * first paint — a sentinel, so the Instance default lands even when the first scope is no World.
   */
  private current: string | null | undefined;
  private declarations: ThemeDeclarationSet = EMPTY;
  /** What the last write put on the root, so the next one takes back what it no longer sets. */
  private written: readonly string[] = [];

  constructor() {
    // The World is a URL fact (ADR-0028), so the scope is known before routing resolves — which is
    // what lets a reload into a known World land its cached Theme ahead of the first paint. The
    // pre-paint script in `index.html` has already replayed the same entry; this makes the applier the
    // owner of what is on the root, so a later scope change can take it back.
    this.restore(worldThemeScope(location.pathname));

    // The reader's day/night choice is theirs, and orthogonal to the Theme (ADR-0006): a toggle
    // rewrites the anchors to the other Palette and changes nothing else.
    effect(() => {
      this.colorScheme.colorScheme();
      this.write();
    });
  }

  /**
   * Point the document at a World scope.
   *
   * `theme` left out means the World has not been read yet: the last Theme cached for this scope
   * applies, so a reload — or a hop back to a World already visited — never flashes the Hexly default
   * on the way in. A given `theme` (or an explicit `null`) is authoritative: it applies and it caches.
   * `scope` of `null` leaves the World scope entirely, back to the Instance default alone.
   */
  scope(scope: WorldScope | null, theme?: WorldTheme | null): void {
    if (scope === null) {
      this.current = null;
      this.declarations = resolveWorldTheme([this.instance]);
      this.write();
      return;
    }

    const key = scopeOf(scope);
    if (theme === undefined) {
      this.restore(key);
      return;
    }

    this.current = key;
    this.declarations = resolveWorldTheme([this.instance, theme]);
    this.write();
    this.cache(key, theme ? this.declarations : null);
  }

  /**
   * Paint `scope` from the cache — everything known about it before its World read resolves. A cache
   * entry is a resolved chain, Instance layer included, so it replaces rather than merges.
   */
  private restore(scope: string | null): void {
    this.current = scope;
    const cached = scope === null ? undefined : readCache().find((entry) => entry.scope === scope);
    this.declarations = cached ? { solar: cached.solar, astral: cached.astral } : resolveWorldTheme([this.instance]);
    this.write();
  }

  /** Write the active Palette on the root, taking back whatever the last write set and this one doesn't. */
  private write(): void {
    const next = this.declarations[this.colorScheme.colorScheme()];
    const style = document.documentElement.style;
    for (const name of this.written) if (!(name in next)) style.removeProperty(name);
    for (const [name, value] of Object.entries(next)) style.setProperty(name, value);
    this.written = Object.keys(next);
  }

  /**
   * Remember this scope's resolved Theme, most recent first, so the pre-paint bootstrap can replay it.
   * Unscoped by account, like the ColorScheme and for the same reason: the script that reads it cannot
   * know the user hash. A Theme is served to anonymous Public Link holders anyway, so it is not the
   * kind of thing an auth-scoped key protects.
   */
  private cache(scope: string, declarations: ThemeDeclarationSet | null): void {
    const others = readCache().filter((entry) => entry.scope !== scope);
    const next = declarations ? [{ scope, ...declarations }, ...others] : others;
    safeStorageSet(WORLD_THEME_CACHE_KEY, JSON.stringify(next.slice(0, CACHE_MAX)));
  }
}

/**
 * Instantiate {@link WorldThemeApplier} during bootstrap, so a reload into a known World has its Theme
 * on the root before the app renders — and so the applier owns what the pre-paint script wrote.
 */
export function provideWorldTheme(): EnvironmentProviders {
  return provideAppInitializer(() => void inject(WorldThemeApplier));
}
