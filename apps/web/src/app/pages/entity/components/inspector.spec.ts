import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { EntityDetail, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../../../core/services/entities.client';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { HexMapStore } from '../services/hexmap-store';
import { Inspector } from './inspector';

/** A minimal EntitySummary the Entity Link picker can list (issue #76). */
function summary(id: string, name: string): EntitySummary {
  return {
    id,
    ownerId: 'me',
    name,
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** The owner's entities the stubbed client returns; set per test before render. */
let stubEntities: EntitySummary[] = [];

/** Records each `create(name, type)` the Entity Link control made (issue #77). */
let createdCalls: Array<{ name: string; type: EntityType }> = [];

/** The id the stubbed `create` mints for the next created Entity. */
let nextCreatedId = 'created-1';

/** Providers every Inspector spec needs now that it embeds the Entity Link control. */
function inspectorProviders() {
  return [
    provideRouter([]),
    {
      provide: EntitiesClient,
      useValue: {
        // Mirror the server's envelope + filters (ADR-0025): `ids` selects, `q`
        // matches names case-insensitively, so the picker's calls resolve as in prod.
        list: (opts: { ids?: string[]; q?: string } = {}) => {
          let items = stubEntities;
          if (opts.ids) items = items.filter((e) => opts.ids!.includes(e.id));
          if (opts.q)
            items = items.filter((e) =>
              e.name.toLowerCase().includes(opts.q!.toLowerCase()),
            );
          return of({ items, nextCursor: null });
        },
        create: (name: string, type: EntityType) => {
          createdCalls.push({ name, type });
          const detail: EntityDetail = {
            ...summary(nextCreatedId, name),
            type,
            document: { type } as EntityDetail['document'],
          };
          return of(detail);
        },
      },
    },
  ];
}

describe('Inspector label editing', () => {
  beforeEach(async () => {
    stubEntities = [];
    await TestBed.configureTestingModule({
      imports: [Inspector, provideTranslocoTesting()],
      providers: inspectorProviders(),
    }).compileComponents();
  });

  /** Create the inspector with a label already selected, and return both. */
  function withSelectedLabel(text = 'The Whisperwood') {
    const store = TestBed.inject(HexMapStore);
    const id = store.addLabel(text, { x: 40, y: -20 });
    store.selectLabel(id);
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return { store, id, fixture };
  }

  function field(fixture: ReturnType<typeof TestBed.createComponent>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLInputElement;
  }

  it('shows the selected label\'s text', () => {
    const { fixture } = withSelectedLabel('Open Sea');

    expect(field(fixture, 'label-text').value).toBe('Open Sea');
  });

  it('renders the label editor’s field labels and Delete in French', () => {
    const { fixture } = withSelectedLabel('Open Sea');
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('header')?.textContent).toContain('Étiquette sélectionnée');
    expect(el.textContent).toContain('Texte');
    expect(el.textContent).toContain('Taille');
    expect(el.querySelector('[data-testid=label-delete]')?.textContent).toContain(
      'Supprimer l’étiquette',
    );
    // The user's label text is content — left exactly as typed.
    expect(field(fixture, 'label-text').value).toBe('Open Sea');
  });

  it('renders the empty-state hint in French when nothing is selected', () => {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('header')?.textContent).toContain('Inspecteur');
    expect(el.querySelector('.muted')?.textContent).toContain('Choisissez l’outil');
  });

  it('edits the label text when the text field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-text');
    input.value = 'The Drowned Coast';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.text).toBe('The Drowned Coast');
  });

  it('resizes the label when the size field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-size');
    input.value = '48';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.size).toBe(48);
  });

  it('rotates the label when the rotation field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-rotation');
    input.value = '45';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.rotation).toBe(45);
  });

  it('moves the label when an X position field changes', () => {
    const { store, id, fixture } = withSelectedLabel();

    const input = field(fixture, 'label-x');
    input.value = '300';
    input.dispatchEvent(new Event('change'));

    expect(store.document().labels.find((l) => l.id === id)?.position.x).toBe(300);
  });

  it('deletes the selected label when Delete is clicked', () => {
    const { store, id, fixture } = withSelectedLabel();

    (
      fixture.nativeElement.querySelector('[data-testid=label-delete]') as HTMLButtonElement
    ).click();

    expect(store.document().labels.find((l) => l.id === id)).toBeUndefined();
  });

  it('shows no label editor when nothing is selected', () => {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid=label-text]')).toBeNull();
  });
});

describe('Inspector hex and feature selection', () => {
  beforeEach(async () => {
    stubEntities = [];
    await TestBed.configureTestingModule({
      imports: [Inspector, provideTranslocoTesting()],
      providers: inspectorProviders(),
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a selected Hex\'s coordinate and terrain, with no label editor', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 2, r: -1 }, 'ocean');
    store.select({ q: 2, r: -1 }, null);

    const el = render().nativeElement;

    // Assert q and r land in their own fields, so a q/r transposition fails too.
    const coord = el.querySelector('[data-testid=entity-coord]').textContent;
    expect(coord).toContain('q 2');
    expect(coord).toContain('r -1');
    expect(el.querySelector('[data-testid=entity-detail]').textContent).toContain('Ocean');
    expect(el.querySelector('[data-testid=label-text]')).toBeNull();
  });

  it('deletes a selected Hex when its Delete action is clicked, clearing the selection', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null);

    const del = render().nativeElement.querySelector(
      '[data-testid=entity-delete]',
    ) as HTMLButtonElement;
    // The affordance must be live, not the disabled placeholder it used to render
    // — a programmatic click fires even on a disabled button, so assert it first.
    expect(del.disabled).toBe(false);
    del.click();

    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.selection()).toBeNull();
  });

  it('deletes a selected Feature by clearing only its feature when Delete is clicked', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 1, r: 1 }, 'forest');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null); // the Feature

    (
      render().nativeElement.querySelector(
        '[data-testid=entity-delete]',
      ) as HTMLButtonElement
    ).click();

    expect(store.document().hexes['1,1']).toEqual({ terrain: 'forest' });
    expect(store.selection()).toBeNull();
  });

  it('shows a selected Feature\'s identity, labelled as a feature', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 1, r: 1 }, 'grass');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null);

    const el = render().nativeElement;

    expect(el.querySelector('header').textContent).toContain('feature');
    expect(el.querySelector('[data-testid=entity-detail]').textContent).toContain(
      'Settlement',
    );
    expect(el.querySelector('[data-testid=entity-delete]').textContent).toContain(
      'feature',
    );
  });

  it('renders a selected Feature in French — built-in label keyed by id, chrome translated', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 1, r: 1 }, 'ocean');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null);

    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The built-in Feature label renders via domain.feature.settlement → Colonie,
    // not the English domain label.
    expect(el.querySelector('[data-testid=entity-detail]')?.textContent).toContain(
      'Colonie',
    );
    expect(el.querySelector('[data-testid=entity-detail]')?.textContent).not.toContain(
      'Settlement',
    );
    // The selected-kind eyebrow and the Delete action translate too.
    expect(el.querySelector('header')?.textContent).toContain(
      'Caractéristique sélectionnée',
    );
    expect(el.querySelector('[data-testid=entity-delete]')?.textContent).toContain(
      'Supprimer la caractéristique',
    );
  });

  it('renders a selected Hex’s terrain in French, keyed by its id', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'ocean');
    store.select({ q: 0, r: 0 }, null);

    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-detail]')?.textContent,
    ).toContain('Océan');
  });

  it('shows no membership direction toggle for a Hex selection', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'grass');
    store.select({ q: 0, r: 0 }, null);

    // The toggle lives only inside the Region editor branch (it arms a Region tool),
    // so a Hex/Feature selection must not render it — clicking it would arm a Region
    // with no inspected Region behind it.
    const el = render().nativeElement;
    expect(el.querySelector('[data-testid=region-add]')).toBeNull();
    expect(el.querySelector('[data-testid=region-remove]')).toBeNull();
  });

  it('prefills the name field with a selected Hex\'s current name', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.editHexName({ q: 0, r: 0 }, 'Riverbend');
    store.select({ q: 0, r: 0 }, null);

    const input = render().nativeElement.querySelector(
      '[data-testid=entity-name]',
    ) as HTMLInputElement;

    expect(input.value).toBe('Riverbend');
  });

  it('commits a rename when the name field changes', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);

    const input = render().nativeElement.querySelector(
      '[data-testid=entity-name]',
    ) as HTMLInputElement;
    input.value = 'Riverbend';
    input.dispatchEvent(new Event('change'));

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest', name: 'Riverbend' });
  });

  it('offers the name field for a selected Feature too', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 1, r: 1 }, 'forest');
    store.placeFeatureAt({ q: 1, r: 1 }, 'settlement');
    store.select({ q: 1, r: 1 }, null);

    const input = render().nativeElement.querySelector(
      '[data-testid=entity-name]',
    ) as HTMLInputElement;
    input.value = 'Riverbend';
    input.dispatchEvent(new Event('change'));

    expect(store.document().hexes['1,1']).toEqual({
      terrain: 'forest',
      feature: { ref: 'settlement' },
      name: 'Riverbend',
    });
  });
});

describe('Inspector multi-selection', () => {
  beforeEach(async () => {
    stubEntities = [];
    await TestBed.configureTestingModule({
      imports: [Inspector, provideTranslocoTesting()],
      providers: inspectorProviders(),
    }).compileComponents();
  });

  /** Select two Hexes and a Label, returning the store and the rendered fixture. */
  function withThreeSelected() {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.paintAt({ q: 1, r: 0 }, 'ocean');
    const labelId = store.addLabel('Open Sea', { x: 5, y: 5 });
    store.select({ q: 0, r: 0 }, null);
    store.select({ q: 1, r: 0 }, null, 'toggle-top');
    store.select({ q: 0, r: 0 }, labelId, 'toggle-top');
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return { store, fixture, labelId };
  }

  it('shows the selection count instead of a single-entity editor when 2+ are selected', () => {
    const { fixture } = withThreeSelected();
    const el = fixture.nativeElement as HTMLElement;

    // The count reflects the whole set, and no single-entity editor is shown.
    expect(el.querySelector('[data-testid=selection-count]')?.textContent).toContain('3');
    expect(el.querySelector('[data-testid=label-text]')).toBeNull();
    expect(el.querySelector('[data-testid=entity-coord]')).toBeNull();
  });

  it('breaks the selection down by kind', () => {
    const { fixture } = withThreeSelected();
    // Collapse the inter-token whitespace the multi-line template leaves between
    // the count and its word, so the kind-bound substrings match.
    const breakdown = ((fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid=selection-breakdown]',
    )?.textContent ?? '').replace(/\s+/g, ' ').trim();

    // Two hexes and one label, each count bound to its kind — and the count-1 row
    // reads the singular "label", not "1 labels" (the \b stops "1 label" matching
    // a stray "1 labels").
    expect(breakdown).toContain('2 hexes');
    expect(breakdown).toMatch(/\b1 label\b/);
  });

  it('deletes the whole set in one step when Delete all is clicked', () => {
    const { store, fixture } = withThreeSelected();
    const del = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid=selection-delete-all]',
    ) as HTMLButtonElement;
    expect(del.disabled).toBe(false);

    del.click();

    expect(store.document().hexes).toEqual({});
    expect(store.document().labels).toEqual([]);
    expect(store.selections()).toEqual([]);
  });

  it('renders the multi-selection chrome in French', () => {
    const { fixture } = withThreeSelected();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid=selection-delete-all]')?.textContent).toContain(
      'Tout supprimer',
    );
  });
});

describe('Inspector region editing', () => {
  beforeEach(async () => {
    stubEntities = [];
    await TestBed.configureTestingModule({
      imports: [Inspector, provideTranslocoTesting()],
      providers: inspectorProviders(),
    }).compileComponents();
  });

  /** Create the inspector with a Region selected, and return both. The member is a
   * Void coordinate so the Region is the only selection candidate there. */
  function withSelectedRegion(name = 'Region 3', color = '#b08a4e') {
    const store = TestBed.inject(HexMapStore);
    const id = store.createRegion(name, color);
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return { store, id, fixture };
  }

  function field(fixture: ReturnType<typeof TestBed.createComponent>, testid: string) {
    return fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLInputElement;
  }

  it('renders the region editor for a selected Region, with no hex/label panels', () => {
    const { fixture } = withSelectedRegion('The Whisperwood');

    expect(field(fixture, 'region-name').value).toBe('The Whisperwood');
    expect(fixture.nativeElement.querySelector('[data-testid=label-text]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=entity-coord]')).toBeNull();
  });

  it('translates the region editor’s chrome in French, but never the user’s name', () => {
    // Name the Region "Add" — colliding with the Membership control's label — to
    // prove the user's content is left verbatim while the chrome translates.
    const { fixture } = withSelectedRegion('Add', '#b08a4e');
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('header')?.textContent).toContain('Région sélectionnée');
    // Field labels (region-fields + Inspector) and the direction toggle translate.
    expect(el.textContent).toContain('Nom');
    expect(el.textContent).toContain('Couleur');
    expect(el.textContent).toContain('Appartenance');
    expect(
      (el.querySelector('[data-testid=region-add]') as HTMLElement).textContent,
    ).toContain('Ajouter');
    expect(
      (el.querySelector('[data-testid=region-remove]') as HTMLElement).textContent,
    ).toContain('Retirer');
    expect(el.querySelector('[data-testid=region-delete]')?.textContent).toContain(
      'Supprimer la région',
    );
    // The user's Region name stays their word, not swapped for the French "Ajouter".
    expect(field(fixture, 'region-name').value).toBe('Add');
  });

  it('renames the region when the name field changes (e.g. "Region 3" → "The Whisperwood")', () => {
    const { store, id, fixture } = withSelectedRegion('Region 3');

    const input = field(fixture, 'region-name');
    input.value = 'The Whisperwood';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].name).toBe('The Whisperwood');
    // The edit is reflected live through the same selection the inspector binds to.
    expect(store.selectedRegion()?.name).toBe('The Whisperwood');
    expect(id).toBe(store.document().regions[0].id);
  });

  it('recolors the region when the color field changes, updating its border color', () => {
    const { store, fixture } = withSelectedRegion('Avalon', '#b08a4e');

    const input = field(fixture, 'region-color');
    input.value = '#6f7fae';
    input.dispatchEvent(new Event('change'));

    expect(store.document().regions[0].color).toBe('#6f7fae');
    expect(store.selectedRegion()?.color).toBe('#6f7fae');
  });

  it('shows an Add ⇄ Remove direction toggle with Add reflected as the current direction', () => {
    const { fixture } = withSelectedRegion();

    const add = fixture.nativeElement.querySelector('[data-testid=region-add]') as HTMLButtonElement;
    const remove = fixture.nativeElement.querySelector('[data-testid=region-remove]') as HTMLButtonElement;
    expect(add).not.toBeNull();
    expect(remove).not.toBeNull();
    // The store cold-starts the direction at Add, so the toggle reflects it.
    expect(add.getAttribute('aria-pressed')).toBe('true');
    expect(remove.getAttribute('aria-pressed')).toBe('false');
  });

  it('arms the Region tool on the inspected Region in Add when the Add control is clicked', () => {
    const { store, id, fixture } = withSelectedRegion();

    (fixture.nativeElement.querySelector('[data-testid=region-add]') as HTMLButtonElement).click();

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id, mode: 'add' });
  });

  it('arms the Region tool on the inspected Region in Remove when the Remove control is clicked', () => {
    const { store, id, fixture } = withSelectedRegion();

    (fixture.nativeElement.querySelector('[data-testid=region-remove]') as HTMLButtonElement).click();

    expect(store.tool()).toBe('region');
    expect(store.region()).toEqual({ id, mode: 'remove' });
  });

  it('reflects the chosen direction in the toggle after Remove is engaged', () => {
    const { fixture } = withSelectedRegion();

    (fixture.nativeElement.querySelector('[data-testid=region-remove]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const add = fixture.nativeElement.querySelector('[data-testid=region-add]') as HTMLButtonElement;
    const remove = fixture.nativeElement.querySelector('[data-testid=region-remove]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-pressed')).toBe('true');
    expect(add.getAttribute('aria-pressed')).toBe('false');
  });

  it('deletes the region when its Delete button is clicked, clearing the selection', () => {
    const { store, fixture } = withSelectedRegion();

    const del = field(fixture, 'region-delete') as unknown as HTMLButtonElement;
    // A programmatic click fires even on a disabled button, so assert it is live.
    expect(del.disabled).toBe(false);
    del.click();

    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();
  });

  it('deletes the region as one undoable step, restoring it and the selection on undo', () => {
    // The Inspector's Delete uses a different store path (deleteRegion direct)
    // than the keyboard Delete (deleteSelected); both must honour ADR-0011's
    // "each one undoable step". This pins the Inspector-button path.
    const { store, id, fixture } = withSelectedRegion('Avalon', '#b08a4e');

    (field(fixture, 'region-delete') as unknown as HTMLButtonElement).click();
    expect(store.document().regions).toEqual([]);
    expect(store.selection()).toBeNull();

    // A single undo fully restores the Region — name, membership, and selection.
    // Were the deletion two steps, one undo would leave it half-restored.
    store.undo();
    expect(store.document().regions[0].hexes).toEqual({ '0,0': true });
    expect(store.selectedRegion()?.name).toBe('Avalon');
    expect(store.selection()).toEqual({ kind: 'region', id });
  });
});

describe('Inspector Entity Link control', () => {
  beforeEach(async () => {
    stubEntities = [];
    createdCalls = [];
    nextCreatedId = 'created-1';
    await TestBed.configureTestingModule({
      imports: [Inspector, provideTranslocoTesting()],
      providers: inspectorProviders(),
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Inspector);
    fixture.detectChanges();
    return fixture;
  }

  function byId(el: HTMLElement, testid: string) {
    return el.querySelector(`[data-testid=${testid}]`) as HTMLElement | null;
  }

  it('opens the picker on a selected Hex and links the chosen Entity', () => {
    stubEntities = [summary('n1', 'Riverbend'), summary('n2', 'North Reach')];
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    // Unlinked: a pick affordance, no picker open yet.
    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The picker lists the owner's entities; choosing one links the Hex.
    (byId(el, 'entity-link-option-n2') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(store.document().hexes['0,0'].entityId).toBe('n2');
    expect(byId(el, 'entity-link-name')?.textContent).toContain('North Reach');
  });

  it('filters the picker by a case-insensitive name search', () => {
    stubEntities = [summary('n1', 'Riverbend'), summary('n2', 'North Reach')];
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    const search = byId(el, 'entity-link-search') as HTMLInputElement;
    search.value = 'river';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(byId(el, 'entity-link-option-n1')).not.toBeNull();
    expect(byId(el, 'entity-link-option-n2')).toBeNull();
  });

  it('removes the link from a selected Hex without deleting the Hex', () => {
    stubEntities = [summary('n1', 'Riverbend')];
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    store.linkEntity('n1');
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-remove') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
    expect(byId(el, 'entity-link-pick')).not.toBeNull();
  });

  it('shows the Entity Link control for a selected Region', () => {
    const store = TestBed.inject(HexMapStore);
    const id = store.createRegion('Avalon', '#b08a4e');
    store.addHexToRegion(id, { q: 0, r: 0 });
    store.select({ q: 0, r: 0 }, null);

    expect(byId(render().nativeElement, 'entity-link-pick')).not.toBeNull();
  });

  it('shows no Entity Link control for a selected Label (Labels carry none)', () => {
    const store = TestBed.inject(HexMapStore);
    const id = store.addLabel('Open Sea', { x: 0, y: 0 });
    store.selectLabel(id);

    const el = render().nativeElement as HTMLElement;
    expect(byId(el, 'entity-link-pick')).toBeNull();
    expect(byId(el, 'entity-link-name')).toBeNull();
  });

  it('renders a non-navigable dangling label when the link cannot be resolved', () => {
    // The target is deleted/inaccessible, so ids-resolve comes back empty (#78).
    stubEntities = [];
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    store.linkEntity('ghost');
    const el = render().nativeElement as HTMLElement;

    // Visible but non-navigable — the dangling label, never an anchor.
    expect(byId(el, 'entity-link-name')).toBeNull();
    expect(byId(el, 'entity-link-dangling')).not.toBeNull();
  });

  it('renders the entity name as a real anchor to the linked Entity', () => {
    stubEntities = [summary('n1', 'Riverbend')];
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    store.linkEntity('n1');
    const el = render().nativeElement as HTMLElement;

    // The name itself is the link — a real <a routerLink> so ctrl/cmd-click opens
    // it in a new tab — with no separate Follow control.
    const name = byId(el, 'entity-link-name') as HTMLAnchorElement;
    expect(name.tagName).toBe('A');
    expect(name.getAttribute('href')).toBe('/entities/n1');
    expect(name.textContent).toContain('Riverbend');
    expect(name.textContent).toContain('note'); // type suffix
  });

  it('creates a new note and links the selected Hex to it in one flow', () => {
    nextCreatedId = 'n-new';
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    (byId(el, 'entity-link-create-note') as HTMLButtonElement).click();
    fixture.detectChanges();

    // A note was created and the Hex now links to it; its name resolves locally.
    expect(createdCalls).toEqual([{ name: 'Untitled note', type: 'note' }]);
    expect(store.document().hexes['0,0'].entityId).toBe('n-new');
    expect(byId(el, 'entity-link-name')?.textContent).toContain('Untitled note');
  });

  it('names the created Entity after the typed search query', () => {
    nextCreatedId = 'iron';
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    const search = byId(el, 'entity-link-search') as HTMLInputElement;
    search.value = 'Ironhold';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (byId(el, 'entity-link-create-note') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(createdCalls).toEqual([{ name: 'Ironhold', type: 'note' }]);
    expect(byId(el, 'entity-link-name')?.textContent).toContain('Ironhold');
  });

  it('creates a new Hex Map and links a selected Feature to it (city pin → city map)', () => {
    nextCreatedId = 'city-map';
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.placeFeatureAt({ q: 0, r: 0 }, 'settlement');
    store.select({ q: 0, r: 0 }, null); // resolves to the topmost Feature
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    (byId(el, 'entity-link-create-map') as HTMLButtonElement).click();
    fixture.detectChanges();

    // The Feature's own link points at the new hexmap — independent of the Hex.
    expect(createdCalls).toEqual([{ name: 'Untitled map', type: 'hexmap' }]);
    expect(store.document().hexes['0,0'].feature).toEqual({
      ref: 'settlement',
      entityId: 'city-map',
    });
  });

  it('renders the control chrome in French', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(byId(fixture.nativeElement, 'entity-link-pick')?.textContent).toContain(
      'Lier une entité',
    );
  });

  it('renders the create-and-link row in French', () => {
    const store = TestBed.inject(HexMapStore);
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    (byId(el, 'entity-link-pick') as HTMLButtonElement).click();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect(byId(el, 'entity-link-create-note')?.textContent).toContain('Nouvelle note');
    expect(byId(el, 'entity-link-create-map')?.textContent).toContain('Nouvelle carte');
  });
});
