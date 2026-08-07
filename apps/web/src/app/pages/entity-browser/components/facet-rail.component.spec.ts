import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { EntityFacets } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import { mockClientConfigStore } from '@hexly/web-core/testing';
import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { ActiveFacets, FacetRailComponent, QueryOwnedFacets } from './facet-rail.component';

/** The Visibility category is gated on the Collaboration layer (ADR-0071); Type and Tag are not. */
describe('FacetRail — the Visibility category under Collaboration (#316)', () => {
  let collaboration: WritableSignal<boolean>;

  function render(): ComponentFixture<FacetRailComponent> {
    collaboration = signal(true);
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration }) }],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [{ value: 'core.type.note', count: 4 }],
      tag: [{ value: 'deity', count: 2 }],
      visibility: [
        { value: 'private', count: 3 },
        { value: 'shared', count: 1 },
      ],
      fields: [],
    } satisfies EntityFacets);
    fixture.detectChanges();
    return fixture;
  }

  const has = (fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    !!(fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`);

  it('renders the Visibility category with Collaboration on', () => {
    const fixture = render();

    expect(has(fixture, 'facet-heading-visibility')).toBe(true);
    expect(has(fixture, 'facet-visibility-private')).toBe(true);
  });

  it('drops the Visibility category with Collaboration off, keeping Type and Tag', () => {
    const fixture = render();
    collaboration.set(false);
    fixture.detectChanges();

    expect(has(fixture, 'facet-heading-visibility')).toBe(false);
    expect(has(fixture, 'facet-visibility-private')).toBe(false);
    expect(has(fixture, 'facet-visibility-shared')).toBe(false);
    expect(has(fixture, 'facet-heading-type')).toBe(true);
    expect(has(fixture, 'facet-heading-tag')).toBe(true);
  });
});

/** A value the caller has selected is always listed, whatever its count (ADR-0081, #420). */
describe('FacetRail — a selected value is always listed (#420)', () => {
  function render(
    counts: Partial<EntityFacets>,
    active: Partial<ActiveFacets>,
    collaboration = true,
  ): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [
        { provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration: signal(collaboration) }) },
      ],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [],
      tag: [],
      visibility: [],
      fields: [],
      ...counts,
    } satisfies EntityFacets);
    fixture.componentRef.setInput('active', {
      type: [],
      tag: [],
      visibility: [],
      fields: {},
      container: [],
      ...active,
    } satisfies ActiveFacets);
    fixture.detectChanges();
    return fixture;
  }

  const row = (fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`) as HTMLButtonElement | null;

  it('lists a selected value the server dropped, active and clickable off', () => {
    // The tag category came back without `draft` — no entity under the other active filters carries it.
    const fixture = render({ tag: [] }, { tag: ['draft'] });

    const draft = row(fixture, 'facet-tag-draft');
    expect(draft).not.toBeNull();
    expect(draft?.getAttribute('aria-pressed')).toBe('true');

    const toggled = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggled);
    draft?.click();
    expect(toggled).toHaveBeenCalledWith({ category: 'tag', value: 'draft', polarity: 'include' });
  });

  it('shows the merged row its real count — zero — not a fabricated one', () => {
    const fixture = render({ tag: [] }, { tag: ['draft'] });

    expect(row(fixture, 'facet-tag-draft')?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');
  });

  it('keeps an unselected zero-count value hidden — only the selection is merged in', () => {
    const fixture = render({ tag: [{ value: 'deity', count: 2 }] }, { tag: ['draft'] });

    expect(row(fixture, 'facet-tag-draft')).not.toBeNull();
    // Nothing the server didn't send and the caller didn't select appears.
    expect(row(fixture, 'facet-tag-ruined')).toBeNull();
  });

  it('keeps the server’s own values and their order, appending the merged selection', () => {
    const fixture = render(
      {
        tag: [
          { value: 'deity', count: 2 },
          { value: 'ruined', count: 1 },
        ],
      },
      { tag: ['draft', 'deity'] },
    );

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid^="facet-tag-"]'),
      (el) => el.getAttribute('data-testid'),
    );
    // `deity` is already listed, so it is not duplicated; only the missing `draft` is appended.
    expect(labels).toEqual(['facet-tag-deity', 'facet-tag-ruined', 'facet-tag-draft']);
  });

  it('merges a selected Field-facet value the server dropped', () => {
    const fixture = render(
      {
        fields: [
          {
            key: 'alignment',
            label: 'Alignment',
            dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
            values: [{ value: 'lawful-good', count: 1 }],
          },
        ],
      },
      { fields: { alignment: { values: ['chaotic-evil'] } } },
    );

    const dropped = row(fixture, 'facet-field-alignment-chaotic-evil');
    expect(dropped).not.toBeNull();
    expect(dropped?.getAttribute('aria-pressed')).toBe('true');
    expect(dropped?.textContent).toContain('0');
  });

  it('leaves the Visibility category dropped with Collaboration off, selection or not (ADR-0071)', () => {
    const fixture = render({}, { visibility: ['private'] }, false);

    expect(row(fixture, 'facet-visibility-private')).toBeNull();
  });
});

/**
 * The paired include/exclude toggles (ADR-0081, #422): every row carries both, always rendered, and
 * pressing either releases the other — which is what makes the contradictory both-selected state
 * unreachable from the rail rather than resolved by a rule.
 */
describe('FacetRail — the excluding half (#422)', () => {
  function render(
    counts: Partial<EntityFacets>,
    active: Partial<ActiveFacets> = {},
    canExclude = true,
  ): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration: signal(true) }) }],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [],
      tag: [],
      visibility: [],
      fields: [],
      ...counts,
    } satisfies EntityFacets);
    fixture.componentRef.setInput('active', {
      type: [],
      tag: [],
      visibility: [],
      fields: {},
      container: [],
      ...active,
    } satisfies ActiveFacets);
    fixture.componentRef.setInput('canExclude', canExclude);
    fixture.detectChanges();
    return fixture;
  }

  const btn = (fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`) as HTMLButtonElement | null;

  const TAGS = { tag: [{ value: 'draft', count: 2 }] };

  it('renders both toggles on every row, always visible — no hover reveal', () => {
    const fixture = render(TAGS);

    const include = btn(fixture, 'facet-tag-draft');
    const exclude = btn(fixture, 'facet-exclude-tag-draft');
    expect(include).not.toBeNull();
    expect(exclude).not.toBeNull();
    // Nothing gates the exclude control on hover or focus: it is in the DOM, unconditionally styled.
    expect(exclude?.className).not.toMatch(/hidden|invisible|opacity-0|group-hover|hover:opacity/);
  });

  it('renders no exclude control on a browse that does not carry the exclude params', () => {
    const fixture = render(TAGS, {}, false);

    expect(btn(fixture, 'facet-tag-draft')).not.toBeNull();
    // The rail never renders a lit control that is not in force.
    expect(btn(fixture, 'facet-exclude-tag-draft')).toBeNull();
  });

  it('emits the pressed polarity, so the page knows which half a click addressed', () => {
    const fixture = render(TAGS);
    const toggled = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggled);

    btn(fixture, 'facet-tag-draft')?.click();
    expect(toggled).toHaveBeenLastCalledWith({ category: 'tag', value: 'draft', polarity: 'include' });

    btn(fixture, 'facet-exclude-tag-draft')?.click();
    expect(toggled).toHaveBeenLastCalledWith({ category: 'tag', value: 'draft', polarity: 'exclude' });
  });

  /** Two `aria-pressed` buttons say what is true — two independent predicates, not one tri-state. */
  it('exposes include and exclude as two distinct aria-pressed controls with distinct names', () => {
    const fixture = render(TAGS, { excluded: { tag: ['draft'] } });

    const include = btn(fixture, 'facet-tag-draft');
    const exclude = btn(fixture, 'facet-exclude-tag-draft');
    expect(include?.getAttribute('aria-pressed')).toBe('false');
    expect(exclude?.getAttribute('aria-pressed')).toBe('true');
    // Never `mixed`: that claims *partially checked*, a different statement (ADR-0081).
    expect(include?.getAttribute('aria-checked')).toBeNull();
    expect(exclude?.getAttribute('aria-checked')).toBeNull();
    // The exclude control names itself; the include one keeps the row's own label.
    expect(exclude?.getAttribute('aria-label')).toBe('Exclude draft');
    expect(include?.getAttribute('aria-label')).toBeNull();
    expect(include?.textContent).toContain('draft');
  });

  it('names the exclude control in the active Locale', () => {
    const fixture = render(TAGS);
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(btn(fixture, 'facet-exclude-tag-draft')?.getAttribute('aria-label')).toBe('Exclure draft');
  });

  /** Or the exclusion would be a one-way door: no row, nothing to click off (ADR-0081). */
  it('lists an excluded value the server dropped, at its real count, ready to click off', () => {
    const fixture = render({ tag: [] }, { excluded: { tag: ['draft'] } });

    const exclude = btn(fixture, 'facet-exclude-tag-draft');
    expect(exclude?.getAttribute('aria-pressed')).toBe('true');
    expect(btn(fixture, 'facet-tag-draft')?.querySelector('span.tabular-nums')?.textContent?.trim()).toBe('0');
  });

  it('lists an excluded Entity Type the server dropped', () => {
    const fixture = render({ type: [] }, { excluded: { type: ['core.type.hex-map'] } });

    expect(btn(fixture, 'facet-exclude-type-core.type.hex-map')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders one row for a value named in both polarities — a contradiction only a URL can say', () => {
    const fixture = render({ tag: [] }, { tag: ['draft'], excluded: { tag: ['draft'] } });

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="facet-tag-draft"]')).toHaveLength(1);
  });

  describe('Field facets', () => {
    const FIELD = {
      fields: [
        {
          key: 'alignment',
          label: 'Alignment',
          dataType: { kind: 'enum' as const, options: ['lawful-good', 'chaotic-evil'] },
          values: [{ value: 'lawful-good', count: 1 }],
        },
      ],
    };

    it('pairs an exclude toggle with each Field value and emits its polarity', () => {
      const fixture = render(FIELD);
      const toggled = vi.fn();
      fixture.componentInstance.fieldValueToggled.subscribe(toggled);

      btn(fixture, 'facet-exclude-field-alignment-lawful-good')?.click();
      expect(toggled).toHaveBeenLastCalledWith({ key: 'alignment', value: 'lawful-good', polarity: 'exclude' });
    });

    it('lists an excluded Field value the server dropped, lit on its exclude control', () => {
      const fixture = render(FIELD, { fields: { alignment: { excluded: ['chaotic-evil'] } } });

      expect(btn(fixture, 'facet-field-alignment-chaotic-evil')?.textContent).toContain('0');
      expect(btn(fixture, 'facet-exclude-field-alignment-chaotic-evil')?.getAttribute('aria-pressed')).toBe('true');
    });

    /** A range takes no polarity: `-cr:gte:5` is `cr:lte:4` (ADR-0081). */
    it('offers no exclude control on a range facet', () => {
      const fixture = render({
        fields: [
          {
            key: 'cr',
            label: 'CR',
            dataType: { kind: 'number' },
            values: [
              { value: '1', count: 1 },
              { value: '5', count: 1 },
            ],
          },
        ],
      });

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid^="facet-exclude-field-cr"]'),
      ).toBeNull();
      expect(btn(fixture, 'facet-field-cr-gte')).not.toBeNull();
    });
  });
});

/**
 * A harvested facet dimension carries a `labelKey` the rail translates in the active Locale (#235,
 * ADR-0055), while a scalar Field's authored `label` renders as-is. A fixture scope (`fixture/*`) —
 * not the app's own `en`/`fr` catalog — supplies the dimension copy without clobbering the real one.
 */
describe('FacetRail — harvested dimension labels (#235)', () => {
  const CATALOGS = {
    'fixture/en': { threat: 'Threat Level', kind: { image: 'Image file' } },
    'fixture/fr': { threat: 'Niveau de menace', kind: { image: 'Fichier image' } },
  };

  /** A facets payload carrying one harvested-dimension facet (`labelKey`) and one scalar Field facet. */
  function facets(): EntityFacets {
    return {
      type: [],
      tag: [],
      visibility: [],
      fields: [
        {
          key: 'fx_threat',
          // The untranslated fallback; the rail resolves `labelKey` for the visible label.
          label: 'fixture.threat',
          labelKey: 'fixture.threat',
          dataType: { kind: 'number' },
          values: [
            { value: '1', count: 1 },
            { value: '10', count: 1 },
          ],
        },
        {
          // A harvested enum dimension carrying a per-value key prefix (ADR-0055/0065): each value resolves
          // as `<valuesKeyPrefix>.<value>`. `mystery` has no copy — it must fall back to the raw token.
          key: 'fx_kind',
          label: 'fixture.kind',
          labelKey: 'fixture.threat',
          valuesKeyPrefix: 'fixture.kind',
          dataType: { kind: 'enum', options: ['image', 'mystery'] },
          values: [
            { value: 'image', count: 3 },
            { value: 'mystery', count: 1 },
          ],
        },
        {
          key: 'alignment',
          label: 'Alignment',
          dataType: { kind: 'enum', options: ['lawful-good', 'chaotic-evil'] },
          values: [{ value: 'lawful-good', count: 1 }],
        },
      ],
    };
  }

  function render(): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({ imports: [FacetRailComponent, provideTranslocoTesting(CATALOGS)] });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', facets());
    fixture.detectChanges();
    return fixture;
  }

  const heading = (fixture: ComponentFixture<FacetRailComponent>, key: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="facet-field-${key}"] h3`)?.textContent?.trim();

  const valueLabel = (fixture: ComponentFixture<FacetRailComponent>, key: string, value: string) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(`[data-testid="facet-field-${key}-${value}"] span.truncate`)
      ?.textContent?.trim();

  it('renders a harvested dimension label translated in the active Locale, not the raw key', () => {
    const fixture = render();
    expect(heading(fixture, 'fx_threat')).toBe('Threat Level');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(heading(fixture, 'fx_threat')).toBe('Niveau de menace');
  });

  it('renders a scalar Field facet with its authored label, untranslated', () => {
    const fixture = render();
    expect(heading(fixture, 'alignment')).toBe('Alignment');
  });

  it('translates a harvested dimension VALUE via its key prefix in the active Locale (ADR-0055/0065)', () => {
    const fixture = render();
    expect(valueLabel(fixture, 'fx_kind', 'image')).toBe('Image file');

    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    expect(valueLabel(fixture, 'fx_kind', 'image')).toBe('Fichier image');
  });

  it('falls back to the raw token for a dimension value with no copy, and for a scalar Field value', () => {
    const fixture = render();
    // Unknown value under a translated dimension → raw token, never the bare `<prefix>.<value>` key.
    expect(valueLabel(fixture, 'fx_kind', 'mystery')).toBe('mystery');
    // A scalar Field carries no `valuesKeyPrefix`, so its value renders verbatim.
    expect(valueLabel(fixture, 'alignment', 'lawful-good')).toBe('lawful-good');
  });

  it('picks the control from the dimension’s dataType: a numeric dimension renders a range', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    // Numeric dimension → range inputs; the enum scalar → value toggles.
    expect(el.querySelector('[data-testid="facet-field-fx_threat-gte"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="facet-field-alignment-lawful-good"]')).not.toBeNull();
  });
});

/**
 * A value the *text* named renders as query-owned (ADR-0082, #425) — visibly not the same thing as a
 * value clicked into the rail, because clicking it edits the box rather than the rail's own store.
 */
describe('FacetRail — a value the text owns (#425)', () => {
  function render(
    counts: Partial<EntityFacets>,
    active: Partial<ActiveFacets>,
    queryOwned: QueryOwnedFacets,
  ): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration: signal(true) }) }],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [],
      tag: [],
      visibility: [],
      fields: [],
      ...counts,
    } satisfies EntityFacets);
    fixture.componentRef.setInput('active', {
      type: [],
      tag: [],
      visibility: [],
      fields: {},
      container: [],
      ...active,
    } satisfies ActiveFacets);
    fixture.componentRef.setInput('canExclude', true);
    fixture.componentRef.setInput('queryOwned', queryOwned);
    fixture.detectChanges();
    return fixture;
  }

  const btn = (fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`) as HTMLButtonElement | null;

  const TAGS = {
    tag: [
      { value: 'draft', count: 2 },
      { value: 'fantasy', count: 1 },
    ],
  };

  it('tells a typed value from a clicked one, both being in force', () => {
    const fixture = render(TAGS, { tag: ['draft', 'fantasy'] }, { categories: { tag: ['draft'] } });

    const typed = btn(fixture, 'facet-tag-draft');
    const clicked = btn(fixture, 'facet-tag-fantasy');
    expect(typed?.getAttribute('aria-pressed')).toBe('true');
    expect(clicked?.getAttribute('aria-pressed')).toBe('true');
    // Same state, two sources — and the rail says which is which.
    expect(typed?.hasAttribute('data-query-owned')).toBe(true);
    expect(clicked?.hasAttribute('data-query-owned')).toBe(false);
    // Visibly, not only to a test hook: the outline hangs off that same attribute as a variant utility
    // (ADR-0021), so the two cannot drift apart, and the row's own styling survives it — nothing shifts
    // as the text takes a value over. The typed row also carries the dollar it was named with.
    expect(typed?.className).toContain('data-query-owned:border-dashed');
    expect(typed?.className).toContain('rounded-sm');
    expect(typed?.textContent).toContain('$');
    expect(clicked?.textContent).not.toContain('$');
  });

  it('says what clicking a query-owned row does, rather than repeating the row’s label', () => {
    const fixture = render(TAGS, { tag: ['draft'] }, { categories: { tag: ['draft'] } });

    expect(btn(fixture, 'facet-tag-draft')?.getAttribute('aria-label')).toBe('Remove draft from the search box');
    expect(btn(fixture, 'facet-tag-fantasy')?.getAttribute('aria-label')).toBeNull();
  });

  it('names the query-owned row in the active Locale', () => {
    const fixture = render(TAGS, { tag: ['draft'] }, { categories: { tag: ['draft'] } });
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(btn(fixture, 'facet-tag-draft')?.getAttribute('aria-label')).toBe('Retirer draft de la recherche');
  });

  /** A typed exclusion lights the exclude control, so that control has to say query-owned too. */
  it('marks both of a query-owned row’s controls, whichever polarity the text named', () => {
    const fixture = render(TAGS, { excluded: { tag: ['draft'] } }, { categories: { tag: ['draft'] } });

    expect(btn(fixture, 'facet-exclude-tag-draft')?.getAttribute('aria-pressed')).toBe('true');
    expect(btn(fixture, 'facet-exclude-tag-draft')?.hasAttribute('data-query-owned')).toBe(true);
    expect(btn(fixture, 'facet-tag-draft')?.hasAttribute('data-query-owned')).toBe(true);
    expect(btn(fixture, 'facet-exclude-tag-draft')?.getAttribute('aria-label')).toBe(
      'Remove draft from the search box',
    );
  });

  it('marks a Field value the text owns, and leaves the Field’s other values alone', () => {
    const fixture = render(
      {
        fields: [
          {
            key: 'alignment',
            label: 'Alignment',
            dataType: { kind: 'enum' as const, options: ['lawful-good', 'chaotic-evil'] },
            values: [
              { value: 'lawful-good', count: 1 },
              { value: 'chaotic-evil', count: 1 },
            ],
          },
        ],
      },
      { fields: { alignment: { values: ['lawful-good', 'chaotic-evil'] } } },
      { fields: { alignment: ['lawful-good'] } },
    );

    expect(btn(fixture, 'facet-field-alignment-lawful-good')?.hasAttribute('data-query-owned')).toBe(true);
    expect(btn(fixture, 'facet-exclude-field-alignment-lawful-good')?.hasAttribute('data-query-owned')).toBe(true);
    expect(btn(fixture, 'facet-field-alignment-chaotic-evil')?.hasAttribute('data-query-owned')).toBe(false);
  });

  it('emits the ordinary toggle from a query-owned row — what a click means is the page’s to decide', () => {
    const fixture = render(TAGS, { tag: ['draft'] }, { categories: { tag: ['draft'] } });
    const toggled = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggled);

    btn(fixture, 'facet-tag-draft')?.click();

    expect(toggled).toHaveBeenLastCalledWith({ category: 'tag', value: 'draft', polarity: 'include' });
  });

  it('owns nothing where no text named anything — every other rail surface passes none', () => {
    const fixture = render(TAGS, { tag: ['draft'] }, {});

    expect(btn(fixture, 'facet-tag-draft')?.hasAttribute('data-query-owned')).toBe(false);
  });
});

/**
 * A range **bound** the text owns (ADR-0082, #430). The row used to render the typed bound as an
 * ordinary editable input and then refuse the edit, so the box and the input disagreed with nothing on
 * screen saying why. It now reads as query-owned like any other, and is reversed by deleting its token.
 * Ownership is per bound: a Field whose minimum the text names and whose maximum the rail sets is a
 * legitimate state, and both halves have to render legibly.
 */
describe('FacetRail — a range bound the text owns (#430)', () => {
  const CR = {
    fields: [
      {
        key: 'cr',
        label: 'CR',
        dataType: { kind: 'number' as const },
        values: [
          { value: '1', count: 1 },
          { value: '9', count: 1 },
        ],
      },
    ],
  };

  function render(active: Partial<ActiveFacets>, queryOwned: QueryOwnedFacets): ComponentFixture<FacetRailComponent> {
    TestBed.configureTestingModule({
      imports: [FacetRailComponent, provideTranslocoTesting()],
      providers: [{ provide: ClientConfigStore, useValue: mockClientConfigStore({ collaboration: signal(true) }) }],
    });
    const fixture = TestBed.createComponent(FacetRailComponent);
    fixture.componentRef.setInput('facetCounts', {
      type: [],
      tag: [],
      visibility: [],
      ...CR,
    } satisfies EntityFacets);
    fixture.componentRef.setInput('active', {
      type: [],
      tag: [],
      visibility: [],
      fields: {},
      container: [],
      ...active,
    } satisfies ActiveFacets);
    fixture.componentRef.setInput('queryOwned', queryOwned);
    fixture.detectChanges();
    return fixture;
  }

  const el = <T extends HTMLElement>(fixture: ComponentFixture<FacetRailComponent>, tid: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${tid}"]`) as T | null;

  const input = (fixture: ComponentFixture<FacetRailComponent>, tid: string) => el<HTMLInputElement>(fixture, tid);

  it('renders a text-named bound query-owned — outlined, dollared, and readonly', () => {
    const fixture = render({ fields: { cr: { gte: { value: '5', op: 'gte' } } } }, { bounds: { cr: ['gte'] } });

    const min = input(fixture, 'facet-field-cr-gte');
    expect(min?.value).toBe('5');
    expect(min?.hasAttribute('data-query-owned')).toBe(true);
    expect(min?.className).toContain('data-query-owned:border-dashed');
    // Not merely inert: the input says it refuses edits, and says so to a screen reader too.
    expect(min?.readOnly).toBe(true);
    expect(min?.getAttribute('aria-readonly')).toBe('true');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('$');
  });

  /** The row offers two inputs, not four: `>5` fills the minimum, and its strictness rides the wire. */
  it('renders a strictly-named minimum in the same input, unmarked — the row has no control for it', () => {
    const fixture = render({ fields: { cr: { gte: { value: '5', op: 'gt' } } } }, { bounds: { cr: ['gte'] } });

    expect(input(fixture, 'facet-field-cr-gte')?.value).toBe('5');
    expect(input(fixture, 'facet-field-cr-gte')?.readOnly).toBe(true);
  });

  it('leaves the same Field’s other bound the rail’s to edit', () => {
    const fixture = render(
      { fields: { cr: { gte: { value: '5', op: 'gte' }, lte: { value: '9', op: 'lte' } } } },
      { bounds: { cr: ['gte'] } },
    );

    const max = input(fixture, 'facet-field-cr-lte');
    expect(max?.value).toBe('9');
    expect(max?.hasAttribute('data-query-owned')).toBe(false);
    expect(max?.readOnly).toBe(false);
    expect(max?.getAttribute('aria-readonly')).toBeNull();
    // Nothing to delete: the rail owns it, so it is cleared by emptying it.
    expect(el(fixture, 'facet-field-cr-lte-remove')).toBeNull();
  });

  it('offers a delete control on the owned bound alone, naming the token it takes out', () => {
    const fixture = render(
      { fields: { cr: { gte: { value: '5', op: 'gte' }, lte: { value: '9', op: 'lte' } } } },
      { bounds: { cr: ['gte'] } },
    );

    const remove = el<HTMLButtonElement>(fixture, 'facet-field-cr-gte-remove');
    expect(remove?.getAttribute('aria-label')).toBe('Remove the CR minimum 5 from the search box');
  });

  it('names the delete control in the active Locale', () => {
    const fixture = render({ fields: { cr: { lte: { value: '9', op: 'lte' } } } }, { bounds: { cr: ['lte'] } });
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(el(fixture, 'facet-field-cr-lte-remove')?.getAttribute('aria-label')).toBe(
      'Retirer le maximum 9 de CR de la recherche',
    );
  });

  it('clears the bound it names, which is how the page is told to delete the token', () => {
    const fixture = render({ fields: { cr: { gte: { value: '5', op: 'gte' } } } }, { bounds: { cr: ['gte'] } });
    const changed = vi.fn();
    fixture.componentInstance.fieldRangeChanged.subscribe(changed);

    el<HTMLButtonElement>(fixture, 'facet-field-cr-gte-remove')?.click();

    expect(changed).toHaveBeenLastCalledWith({ key: 'cr', bound: 'gte', value: '' });
  });

  it('leaves a rail-owned range wholly editable, with no delete control on either bound', () => {
    const fixture = render({ fields: { cr: { gte: { value: '5', op: 'gte' } } } }, {});

    expect(input(fixture, 'facet-field-cr-gte')?.readOnly).toBe(false);
    expect(input(fixture, 'facet-field-cr-lte')?.readOnly).toBe(false);
    expect(el(fixture, 'facet-field-cr-gte-remove')).toBeNull();
    expect(el(fixture, 'facet-field-cr-lte-remove')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('$');
  });
});
