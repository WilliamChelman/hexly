import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FONT_PAIRINGS,
  FontPairingId,
  InstanceTheme,
  OVERRIDABLE_TOKENS,
  WorldTheme,
  WorldThemePalette,
} from '@hexly/domain';
import { PublicDesignToken, isSettableToken } from '@hexly/web-styles';
import { ColorSchemeService } from './color-scheme.service';
import {
  INSTANCE_THEME,
  INSTANCE_THEME_READY,
  WORLD_THEME_CACHE_KEY,
  WorldThemeApplier,
  WorldThemeLayer,
  provideWorldTheme,
  resolveWorldTheme,
  worldThemeScope,
} from './world-theme.applier';
import { segment } from '../utils/pretty-id';

const WORLD_ID = '11111111-1111-4111-8111-111111111111';
const WORLD_SEG = segment(WORLD_ID, 'Aldermoor');

function palette(over: Partial<WorldThemePalette> = {}): WorldThemePalette {
  return {
    page: 'oklch(0.9 0.05 90)',
    ink: 'oklch(0.2 0.03 80)',
    inkQuiet: 'oklch(0.45 0.04 80)',
    accent: 'oklch(0.55 0.14 40)',
    danger: 'oklch(0.5 0.15 25)',
    success: 'oklch(0.5 0.12 140)',
    canvas: 'oklch(0.88 0.05 90)',
    soot: 'oklch(0.25 0.03 70)',
    polarity: 1,
    lineAlpha: 0.371,
    veil: 0.12,
    ...over,
  };
}

function theme(over: Partial<WorldTheme> = {}): WorldTheme {
  return { version: 1, solar: palette(), astral: palette({ polarity: -1 }), ...over } as WorldTheme;
}

describe('the World Theme resolution chain (ADR-0076)', () => {
  it('writes the named ColorScheme’s anchors and knobs as their tier-1 tokens', () => {
    const declarations = resolveWorldTheme([theme()]);

    expect(declarations.solar['--palette-accent']).toBe('oklch(0.55 0.14 40)');
    expect(declarations.solar['--palette-ink-quiet']).toBe('oklch(0.45 0.04 80)');
    expect(declarations.solar['--palette-polarity']).toBe('1');
    expect(declarations.astral['--palette-polarity']).toBe('-1');
    expect(declarations.solar['--palette-line-alpha']).toBe('0.371');
  });

  it('lets the World Theme win over the Instance default, field by field', () => {
    const instance: WorldThemeLayer = { solar: { accent: 'oklch(0.6 0.2 300)', canvas: 'oklch(0.7 0.01 300)' } };

    const declarations = resolveWorldTheme([instance, theme()]);

    expect(declarations.solar['--palette-accent']).toBe('oklch(0.55 0.14 40)');
  });

  it('keeps an Instance-default value the World Theme does not carry', () => {
    const instance: WorldThemeLayer = { radii: { '--radius-md': '2px' }, solar: { accent: 'oklch(0.6 0.2 300)' } };

    // A layer with no palette of its own: an Owner may brand only their radii.
    const declarations = resolveWorldTheme([instance, { radii: { '--radius-sm': '1px' } }]);

    expect(declarations.solar['--palette-accent']).toBe('oklch(0.6 0.2 300)');
    expect(declarations.solar['--radius-md']).toBe('2px');
    expect(declarations.solar['--radius-sm']).toBe('1px');
  });

  it('resolves a font pairing into the four font tokens it writes', () => {
    const declarations = resolveWorldTheme([theme({ fontPairing: 'codex' })]);

    expect(declarations.solar['--font-display']).toContain('Marcellus');
    expect(declarations.astral['--font-mono']).toContain('JetBrains Mono');
  });

  it('writes whatever the curated table names, so a pairing added to it needs no change here (#375)', () => {
    // The evidence for "adding a second pairing requires no applier change": an entry that did not
    // exist when this function was written resolves through it, stacks and all.
    const table = FONT_PAIRINGS as Record<string, Readonly<Partial<Record<PublicDesignToken, string>>>>;
    table['grimoire'] = { '--font-display': "'Cinzel Decorative', serif", '--font-body': "'Marcellus', serif" };
    try {
      const declarations = resolveWorldTheme([theme({ fontPairing: 'grimoire' as FontPairingId })]);

      expect(declarations.solar['--font-display']).toBe("'Cinzel Decorative', serif");
      // Scheme-independent, like the radii: a pairing is one decision, not one per ColorScheme.
      expect(declarations.astral['--font-body']).toBe("'Marcellus', serif");
    } finally {
      delete table['grimoire'];
    }
  });

  it('applies a tier-2 override per ColorScheme, over the anchors it opts out of', () => {
    const declarations = resolveWorldTheme([
      theme({ overrides: { solar: { '--color-ink': 'oklch(0 0 0)' }, astral: {} } }),
    ]);

    expect(declarations.solar['--color-ink']).toBe('oklch(0 0 0)');
    expect(declarations.astral['--color-ink']).toBeUndefined();
  });

  it('resolves to nothing at all when every layer is empty — the Hexly default', () => {
    expect(resolveWorldTheme([null, undefined])).toEqual({ solar: {}, astral: {} });
  });

  it('resolves only tokens the fences admit, so nothing it writes survives a reload half-applied', () => {
    // `declaredOnly` and the pre-paint replay both fence on `isSettableToken`; a token the chain writes
    // but the fence drops would paint once and vanish on the next restore (ADR-0076).
    const overrides = Object.fromEntries(OVERRIDABLE_TOKENS.map((decl) => [decl.name, decl.initial]));
    const declarations = resolveWorldTheme([
      theme({
        fontPairing: 'codex',
        radii: { '--radius-sm': '1px', '--radius-md': '2px', '--radius-lg': '3px' },
        overrides: { solar: overrides, astral: overrides },
      } as Partial<WorldTheme>),
    ]);

    const written = [...Object.keys(declarations.solar), ...Object.keys(declarations.astral)];
    expect(written.filter((name) => !isSettableToken(name))).toEqual([]);
  });
});

describe('the World scope a URL names (ADR-0076)', () => {
  it('keys on the base62 code, so a rename still hits the cache', () => {
    expect(worldThemeScope(`/w/${WORLD_SEG}/entities/x`)).toBe(`w/${segment(WORLD_ID)}`);
    expect(worldThemeScope(`/w/${segment(WORLD_ID, 'Renamed')}`)).toBe(`w/${segment(WORLD_ID)}`);
  });

  it('scopes a World Public Link by its token — the visitor has no World id', () => {
    expect(worldThemeScope('/public/w/tok3n/e/abc')).toBe('public/w/tok3n');
  });

  it('names no scope outside a World', () => {
    expect(worldThemeScope('/')).toBeNull();
    expect(worldThemeScope('/settings')).toBeNull();
    expect(worldThemeScope('/public/e/tok3n')).toBeNull();
  });
});

describe('WorldThemeApplier (ADR-0076)', () => {
  const root = document.documentElement;
  const read = (name: string) => root.style.getPropertyValue(name);

  function at(pathname: string): void {
    window.history.replaceState({}, '', pathname);
  }

  beforeEach(() => {
    localStorage.clear();
    at('/');
    root.dataset['colorScheme'] = 'solar';
  });

  afterEach(() => {
    root.removeAttribute('style');
    localStorage.clear();
    at('/');
  });

  it('writes the active ColorScheme’s anchors on the document root, through the CSSOM', () => {
    TestBed.inject(WorldThemeApplier).scope({ worldId: WORLD_ID }, theme());

    expect(read('--palette-accent')).toBe('oklch(0.55 0.14 40)');
    expect(read('--palette-polarity')).toBe('1');
  });

  it('rewrites to the other Palette on a ColorScheme toggle, and keeps the reader’s choice', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme({ astral: palette({ accent: 'oklch(0.8 0.14 40)', polarity: -1 }) }));

    TestBed.inject(ColorSchemeService).toggle();
    TestBed.flushEffects();

    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('astral');
    expect(read('--palette-accent')).toBe('oklch(0.8 0.14 40)');
  });

  it('restores the Hexly default when the reader leaves for a World with no Theme', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.scope({ worldId: '22222222-2222-4222-8222-222222222222' }, null);

    expect(read('--palette-accent')).toBe('');
  });

  it('restores the Hexly default when the reader leaves the World scope entirely', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.scope(null);

    expect(read('--palette-accent')).toBe('');
  });

  it('re-applies a live Theme edit without a reload', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.scope({ worldId: WORLD_ID }, theme({ solar: palette({ accent: 'oklch(0.5 0.2 300)' }) }));

    expect(read('--palette-accent')).toBe('oklch(0.5 0.2 300)');
  });

  it('paints a reload into a known World from the cache, before the World read resolves', () => {
    TestBed.inject(WorldThemeApplier).scope({ worldId: WORLD_ID }, theme());
    root.removeAttribute('style');

    // A reload: a fresh applier, the same URL, and nothing fetched yet.
    at(`/w/${WORLD_SEG}/entities`);
    TestBed.resetTestingModule();
    TestBed.inject(WorldThemeApplier);

    expect(read('--palette-accent')).toBe('oklch(0.55 0.14 40)');
  });

  it('leaves the cache for another World alone — a reload there is its own scope', () => {
    TestBed.inject(WorldThemeApplier).scope({ worldId: WORLD_ID }, theme());
    root.removeAttribute('style');

    at('/w/somewhere-else/entities');
    TestBed.resetTestingModule();
    TestBed.inject(WorldThemeApplier);

    expect(read('--palette-accent')).toBe('');
  });

  it('caches both Palettes under one key, which the pre-paint bootstrap replays', () => {
    TestBed.inject(WorldThemeApplier).scope({ worldId: WORLD_ID }, theme());

    const cached = JSON.parse(localStorage.getItem(WORLD_THEME_CACHE_KEY) ?? '[]');
    expect(cached).toHaveLength(1);
    expect(cached[0].scope).toBe(`w/${segment(WORLD_ID)}`);
    expect(cached[0].solar['--palette-accent']).toBe('oklch(0.55 0.14 40)');
    expect(cached[0].astral['--palette-polarity']).toBe('-1');
  });

  it('drops a World’s cache entry once it carries no Theme, so the stale one cannot come back', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.scope({ worldId: WORLD_ID }, null);

    expect(JSON.parse(localStorage.getItem(WORLD_THEME_CACHE_KEY) ?? '[]')).toEqual([]);
  });

  it('keeps a World Theme out of the Instance layer in the cache, so an operator can change theirs', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: INSTANCE_THEME, useValue: { solar: { canvas: 'oklch(0.6 0.2 300)' } } }],
    });
    TestBed.inject(WorldThemeApplier).scope({ worldId: WORLD_ID }, theme());

    const cached = JSON.parse(localStorage.getItem(WORLD_THEME_CACHE_KEY) ?? '[]');
    expect(cached[0].solar['--palette-canvas']).toBe('oklch(0.88 0.05 90)');
    expect(cached[0].solar['--palette-accent']).toBe('oklch(0.55 0.14 40)');
  });

  it('bumps a revision on every write — the cue a Canvas renderer re-reads its colours on', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    const before = applier.revision();

    applier.scope({ worldId: WORLD_ID }, theme());

    expect(applier.revision()).toBeGreaterThan(before);
  });

  it('applies the Instance default outside every World, and under a World that has none', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: INSTANCE_THEME, useValue: { solar: { accent: 'oklch(0.6 0.2 300)' } } }],
    });
    const applier = TestBed.inject(WorldThemeApplier);

    applier.scope(null);
    expect(read('--palette-accent')).toBe('oklch(0.6 0.2 300)');

    applier.scope({ worldId: WORLD_ID }, null);
    expect(read('--palette-accent')).toBe('oklch(0.6 0.2 300)');
  });

  it('paints an unsaved draft over the stored Theme, and takes it back when the editor closes', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.preview({ solar: { accent: 'oklch(0.5 0.2 300)' } });
    expect(read('--palette-accent')).toBe('oklch(0.5 0.2 300)');

    applier.preview(undefined);
    expect(read('--palette-accent')).toBe('oklch(0.55 0.14 40)');
  });

  it('previews the Hexly default, so a staged reset shows what saving it would give', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.preview(null);

    expect(read('--palette-accent')).toBe('');
  });

  it('never caches a preview — a draft abandoned by a reload must not come back painted', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());

    applier.preview({ solar: { accent: 'oklch(0.5 0.2 300)' } });

    expect(localStorage.getItem(WORLD_THEME_CACHE_KEY)).not.toContain('oklch(0.5 0.2 300)');
  });

  it('keeps the preview on top when the World read lands under it', () => {
    const applier = TestBed.inject(WorldThemeApplier);
    applier.scope({ worldId: WORLD_ID }, theme());
    applier.preview({ solar: { accent: 'oklch(0.5 0.2 300)' } });

    // The live-follow refetch a save triggers (ADR-0044) arrives while the Owner is still editing.
    applier.scope({ worldId: WORLD_ID }, theme({ solar: palette({ accent: 'oklch(0.7 0.1 200)' }) }));

    expect(read('--palette-accent')).toBe('oklch(0.5 0.2 300)');
  });

  it('ignores a cache entry that is not a set of declared design tokens', () => {
    localStorage.setItem(
      WORLD_THEME_CACHE_KEY,
      JSON.stringify([{ scope: `w/${segment(WORLD_ID)}`, solar: { '--not-a-token': 'x' }, astral: {} }]),
    );

    at(`/w/${WORLD_SEG}`);
    TestBed.inject(WorldThemeApplier);

    expect(read('--not-a-token')).toBe('');
  });

  it('ignores a cached token no Theme may set, whatever the manifest declares it', () => {
    // The gradient is declared but not public, and unregistered — no `@property` type would discard a
    // `url()` in it, and the server's choke point already refuses the key (ADR-0076).
    localStorage.setItem(
      WORLD_THEME_CACHE_KEY,
      JSON.stringify([
        {
          scope: `w/${segment(WORLD_ID)}`,
          solar: { '--gradient-accent-sheen': 'url(https://example.invalid/pixel.png)', '--dur-fast': '9s' },
          astral: {},
        },
      ]),
    );

    at(`/w/${WORLD_SEG}`);
    TestBed.inject(WorldThemeApplier);

    expect(read('--gradient-accent-sheen')).toBe('');
    expect(read('--dur-fast')).toBe('');
  });
});

describe('the Instance default’s arrival (ADR-0076, #372)', () => {
  const root = document.documentElement;
  const read = (name: string) => root.style.getPropertyValue(name);

  afterEach(() => root.removeAttribute('style'));

  it('holds the applier back until the operator’s layer has arrived', async () => {
    // The hazard the readiness token exists for: Angular starts every app initializer in order but
    // awaits them together, so an Instance default fetched over HTTP is not there yet when a *sync*
    // initializer would have constructed the applier — and it would silently never be applied.
    let arrive!: () => void;
    const fetched = new Promise<void>((resolve) => (arrive = resolve));
    const layer = signal<WorldThemeLayer | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideWorldTheme(),
        { provide: INSTANCE_THEME_READY, useValue: fetched },
        { provide: INSTANCE_THEME, useFactory: () => layer() },
      ],
    });

    // Injecting anything makes TestBed run the initializers, exactly as bootstrap would.
    const boot = TestBed.inject(ApplicationInitStatus);
    expect(read('--palette-accent')).toBe('');

    layer.set({ solar: { accent: 'oklch(0.6 0.2 300)' } });
    arrive();
    await boot.donePromise;

    expect(read('--palette-accent')).toBe('oklch(0.6 0.2 300)');
  });

  it('takes a loaded Instance default as a layer of the chain, with no shape of its own', () => {
    // A compile-time check as much as a runtime one: what `hexly.yml` parses to is what the applier
    // resolves, so the two cannot drift into two shapes of the same thing.
    const loaded: InstanceTheme = { version: 1, solar: { accent: 'oklch(0.6 0.2 300)' } };
    const layer: WorldThemeLayer = loaded;

    expect(resolveWorldTheme([layer]).solar['--palette-accent']).toBe('oklch(0.6 0.2 300)');
  });
});
