import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  Injector,
  Signal,
  effect,
  inject,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { FONT_PAIRINGS, PALETTE_TOKENS, WorldTheme, WorldThemePalette } from '@hexly/domain';
import { DesignToken, isDesignToken } from '@hexly/web-styles';
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
 * One layer of the chain: any subset of a Theme's fields. Partial Palettes, because the Instance
 * default may brand a deployment with far fewer values than an Owner authors.
 */
export interface WorldThemeLayer {
  readonly solar?: Partial<WorldThemePalette>;
  readonly astral?: Partial<WorldThemePalette>;
  readonly radii?: WorldTheme['radii'];
  readonly fontPairing?: WorldTheme['fontPairing'];
  readonly overrides?: WorldTheme['overrides'];
}

/**
 * The chain's first layer — an operator's own branding, authored in `hexly.yml` (ADR-0036) and served
 * on the client config channel (#372). `null` for a deployment that set none, which is what ships.
 */
export const INSTANCE_THEME = new InjectionToken<WorldThemeLayer | null>('hexly.instanceTheme', {
  providedIn: 'root',
  factory: () => null,
});

/**
 * Settled before the applier constructs, so {@link INSTANCE_THEME} is resolvable by the time it is
 * read. Angular starts every app initializer in registration order but awaits them *together*, so a
 * default fetched over HTTP (#372) would read as absent however its provider is ordered. A build
 * whose layer needs no fetch waits on the default, which is already settled.
 */
export const INSTANCE_THEME_READY = new InjectionToken<Promise<unknown>>('hexly.instanceThemeReady', {
  providedIn: 'root',
  factory: () => Promise.resolve(),
});

/** What one ColorScheme resolves to: token name → value, exactly as the applier writes it. */
export type ThemeDeclarations = Readonly<Partial<Record<DesignToken, string>>>;

/** Both Palettes at once, so a ColorScheme toggle re-writes rather than re-resolves. */
export type ThemeDeclarationSet = Readonly<Record<ColorScheme, ThemeDeclarations>>;

/** Pinned: `index.html`'s pre-paint replay reads this key by hand. */
export const WORLD_THEME_CACHE_KEY = 'hexly-world-theme';

/** How many Worlds' Themes the cache keeps, most recently applied first. */
const CACHE_MAX = 8;

const NOTHING: ThemeDeclarationSet = { solar: {}, astral: {} };

/** The two route families a World is reached through; a Public Link visitor never learns a World id. */
const SCOPE_PATH = /^\/(public\/w|w)\/([^/]+)/;

/**
 * The World scope a URL names, or `null` outside one — the base62 code alone (ADR-0042), so a rename
 * still hits the cache. `index.html`'s pre-paint replay mirrors this; it is the one caller that cannot
 * import it, which is also why the code is taken by hand rather than decoded: a legacy bare-UUID URL
 * therefore misses, and flashes once before the guard's self-heal rewrites it to the canonical form.
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

/** One World's own last-applied Theme, cached resolved so the pre-paint replay carries no logic. */
interface CachedScope {
  readonly scope: string;
  readonly solar: ThemeDeclarations;
  readonly astral: ThemeDeclarations;
}

/** Keep only what the manifest declares: the pre-paint replay writes the cache back unchecked. */
function declaredOnly(value: unknown): ThemeDeclarations {
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
      solar: declaredOnly((entry as Partial<CachedScope>).solar),
      astral: declaredOnly((entry as Partial<CachedScope>).astral),
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
  private declarations: ThemeDeclarationSet = NOTHING;
  /** What the last write put on the root, so the next one takes back what it no longer sets. */
  private written: readonly string[] = [];
  private readonly _revision = signal(0);

  /**
   * Bumped on every write. A Canvas renderer reads its colours through `getComputedStyle` (ADR-0003),
   * which no signal tracks, so this is the cue to re-read them — a live Theme edit repaints the map.
   */
  readonly revision: Signal<number> = this._revision.asReadonly();

  constructor() {
    // The World is a URL fact (ADR-0028), so the scope resolves before routing does. `index.html` has
    // already replayed this entry; repeating it makes the applier the owner of what sits on the root,
    // so a later scope change can take it back.
    this.restore(worldThemeScope(location.pathname));

    // A Theme and the reader's ColorScheme are orthogonal (ADR-0006): a toggle swaps Palette, no more.
    effect(() => {
      this.colorScheme.colorScheme();
      this.write();
    });
  }

  /**
   * Point the document at a World scope; `null` leaves the World scope for the Instance default alone.
   *
   * An omitted `theme` means the World has not been read yet, so the cached one applies — that is what
   * makes a reload, or a hop back into a World already seen, flash-free. A `theme` given (`null`
   * included) is authoritative: it applies, and it replaces what was cached.
   */
  scope(worldScope: WorldScope | null, theme?: WorldTheme | null): void {
    const key = worldScope === null ? null : scopeOf(worldScope);
    if (theme === undefined) return this.restore(key);

    this.paint(key, resolveWorldTheme([this.instance, theme]));
    // Cached without the Instance layer, which is this build's and not this World's: folding it in
    // would have the pre-paint replay serve an operator's *previous* branding after they changed it.
    if (key !== null) this.cache(key, theme ? resolveWorldTheme([theme]) : null);
  }

  /**
   * Paint `scope` from the cache — all that is known of it before its World read resolves. Re-entering
   * a scope already painted is skipped: it would roll an authoritative Theme back to a cached one.
   */
  private restore(scope: string | null): void {
    if (scope === this.current) return;
    const instance = resolveWorldTheme([this.instance]);
    const cached = scope === null ? undefined : readCache().find((entry) => entry.scope === scope);
    this.paint(
      scope,
      cached
        ? { solar: { ...instance.solar, ...cached.solar }, astral: { ...instance.astral, ...cached.astral } }
        : instance,
    );
  }

  private paint(scope: string | null, declarations: ThemeDeclarationSet): void {
    this.current = scope;
    this.declarations = declarations;
    this.write();
  }

  /** Write the active Palette on the root, taking back whatever the last write set and this one doesn't. */
  private write(): void {
    const next = this.declarations[this.colorScheme.colorScheme()];
    const style = document.documentElement.style;
    for (const name of this.written) if (!(name in next)) style.removeProperty(name);
    for (const [name, value] of Object.entries(next)) style.setProperty(name, value);
    this.written = Object.keys(next);
    this._revision.update((n) => n + 1);
  }

  /**
   * Remember this World's own resolved Theme, most recent first. Unscoped by account like the
   * ColorScheme and for its reason — the script that replays it cannot know the user hash — and a Theme
   * is served to anonymous Public Link holders anyway.
   */
  private cache(scope: string, declarations: ThemeDeclarationSet | null): void {
    const others = readCache().filter((entry) => entry.scope !== scope);
    const next = declarations ? [{ scope, ...declarations }, ...others] : others;
    safeStorageSet(WORLD_THEME_CACHE_KEY, JSON.stringify(next.slice(0, CACHE_MAX)));
  }
}

/**
 * Instantiate {@link WorldThemeApplier} during bootstrap, before the app renders anything — and after
 * {@link INSTANCE_THEME_READY}, so the chain's first layer is in place rather than arriving late.
 */
export function provideWorldTheme(): EnvironmentProviders {
  return provideAppInitializer(() => {
    // Taken eagerly: the injection context ends when this returns, and the construction is deferred.
    const injector = inject(Injector);
    return inject(INSTANCE_THEME_READY).then(() => void injector.get(WorldThemeApplier));
  });
}
