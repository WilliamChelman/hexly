import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AvailableType, UserDefinedType } from '@hexly/domain';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { CORE_VIEW_FIELDS } from '@hexly/web-entity';
import { CORE_HEX_GRID } from '@hexly/plugin-hexmap';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { CORE_RICH_CONTENT } from '@hexly/plugin-content';
import { providePluginContent } from '@hexly/plugin-content/web';
import { WorldTypesPanel } from './world-types-panel';

/**
 * The type-authoring form's draft editing. Every draft edit goes through an immer recipe, and a
 * recipe that *returns* a value (a bare `push(…)`/`Object.assign(…)`) makes immer throw instead of
 * mutating.
 */
describe('WorldTypesPanel', () => {
  let worlds: MockWorldsClient;
  let fixture: ComponentFixture<WorldTypesPanel>;

  const created: UserDefinedType = { id: 'world.deity', label: 'Deity', fields: [], fieldRefs: [] };

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worlds.createType.mockReturnValue(of(created));
    worlds.updateType.mockReturnValue(of(created));
    await TestBed.configureTestingModule({
      imports: [WorldTypesPanel, provideTranslocoTesting()],
      // The map plugin, composed as `app.config.ts` does — what puts `core.hex-grid` on the picker,
      // so the panel learns of the grid from a provider rather than by naming it (#199).
      providers: [provideRouter([]), providePluginHexmap(), { provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');

    fixture = TestBed.createComponent(WorldTypesPanel);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
  });

  /** Click the element with `data-testid`. */
  function click(testid: string): void {
    fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement.click();
    fixture.detectChanges();
  }

  /** Type into the input with `data-testid` (a one-way [value] bind + (input) handler). */
  function type(testid: string, value: string): void {
    const input: HTMLInputElement = fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Pick an option in the `<select>` with `data-testid` (same one-way bind as {@link type}). */
  function select(testid: string, value: string): void {
    const el: HTMLSelectElement = fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Submit the open editor form. */
  function submit(): void {
    fixture.debugElement
      .query(By.css('[data-testid="type-editor"]'))
      .triggerEventHandler('submit', new Event('submit'));
  }

  /** The Field rows themselves — by row class, not `data-testid^="field-"` (which the inputs share). */
  function fieldRows(): number {
    return fixture.debugElement.queryAll(By.css('.type-field')).length;
  }

  it('adds a Field row to the draft when Add field is clicked', () => {
    click('type-new');
    expect(fieldRows()).toBe(0);

    click('add-field');
    expect(fieldRows()).toBe(1);

    click('add-field');
    expect(fieldRows()).toBe(2);
  });

  it('removes a Field row', () => {
    click('type-new');
    click('add-field');
    click('add-field');

    fixture.debugElement.queryAll(By.css('[data-testid="field-0"] button'))[0].nativeElement.click();
    fixture.detectChanges();

    expect(fieldRows()).toBe(1);
  });

  it('edits a Field row and posts the authored type, namespacing the id', () => {
    click('type-new');
    type('type-id-input', 'deity');
    type('type-name-input', 'Deity');
    click('add-field');
    type('field-key', 'domain');
    type('field-label', 'Domain');

    // The row's two checkboxes are required, then facetable — tick "filterable".
    const flags = fixture.debugElement.queryAll(By.css('[data-testid="field-0"] input[type="checkbox"]'));
    flags[1].nativeElement.click();
    fixture.detectChanges();

    submit();

    expect(worlds.createType).toHaveBeenCalledWith('w1', {
      id: 'world.deity',
      label: 'Deity',
      fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' }, required: false, facetable: true }],
      fieldRefs: [],
      // A type with no Structured Field affords its generic Field view alone (ADR-0051): prose is a
      // Structured Field now, so a content View comes only from declaring one.
      views: [CORE_VIEW_FIELDS],
    });
  });

  it('hands back a data-type the form cannot author, rather than retyping the Field', () => {
    // A `list` carries an item type and an `entityLink` a target-type constraint; neither has a
    // control here, and both are reachable through the API. Editing the type beside them must not
    // retype them.
    worlds.availableTypes.mockReturnValue(
      of<AvailableType[]>([
        {
          id: 'world.deity',
          label: 'Deity',
          source: 'user',
          fields: [
            {
              key: 'titles',
              label: 'Titles',
              dataType: { kind: 'list', of: { kind: 'string' } },
              required: false,
              facetable: true,
            },
          ],
        },
      ]),
    );
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    click('edit-world.deity');
    // The picker names the kind it cannot offer, rather than leaving the row blank.
    const kind: HTMLSelectElement = fixture.debugElement.query(By.css('[data-testid="field-kind"]')).nativeElement;
    expect(kind.value).toBe('list');

    type('type-name-input', 'God');
    submit();

    expect(worlds.updateType).toHaveBeenCalledWith('w1', 'world.deity', {
      label: 'God',
      // The item type survives — rebuilding the data-type from the kind alone would lose it.
      fields: [
        {
          key: 'titles',
          label: 'Titles',
          dataType: { kind: 'list', of: { kind: 'string' } },
          required: false,
          facetable: true,
        },
      ],
      views: [CORE_VIEW_FIELDS],
    });
  });

  /** A World Owner gives a type they defined a map by picking a data-type, as they pick `enum` (#201). */
  describe('a Structured Field', () => {
    /** The kinds the picker offers, in order — the built-ins, then this build's plugin data-types. */
    function kindOptions(): string[] {
      return fixture.debugElement
        .queryAll(By.css('[data-testid="field-kind"] option'))
        .map((option) => option.nativeElement.value);
    }

    it('offers the map plugin’s data-type beside the built-ins', () => {
      click('type-new');
      click('add-field');

      expect(kindOptions()).toEqual(['string', 'number', 'boolean', 'date', 'enum', CORE_HEX_GRID]);
    });

    it('posts a hex-grid Field and places its View last, so the type still opens on its Fields', () => {
      click('type-new');
      type('type-id-input', 'deity');
      type('type-name-input', 'Deity');
      click('add-field');
      type('field-key', 'battlemap');
      type('field-label', 'Battlemap');
      select('field-kind', CORE_HEX_GRID);

      submit();

      expect(worlds.createType).toHaveBeenCalledWith('w1', {
        id: 'world.deity',
        label: 'Deity',
        fields: [
          {
            key: 'battlemap',
            label: 'Battlemap',
            dataType: { kind: CORE_HEX_GRID },
            // Never required (no form row to collect it), never a facet (nothing to count).
            required: false,
            facetable: false,
          },
        ],
        fieldRefs: [],
        // "Show as a view" defaults on, and the grid's View sits *after* the generic Field view.
        views: [CORE_VIEW_FIELDS, { field: 'battlemap' }],
      });
    });

    it('swaps the required/facetable flags for one "Show as a view" toggle', () => {
      click('type-new');
      click('add-field');
      select('field-kind', CORE_HEX_GRID);

      // A grid is edited on its View, so neither flag is on offer — only where that View sits.
      const flags = fixture.debugElement.queryAll(By.css('[data-testid="field-0"] input[type="checkbox"]'));
      expect(flags).toHaveLength(1);
      expect(flags[0].nativeElement.dataset.testid).toBe('field-show-as-view');
      expect(flags[0].nativeElement.checked).toBe(true);
    });

    it('withholds the Field’s View when the toggle is off, keeping the Field itself', () => {
      click('type-new');
      type('type-id-input', 'deity');
      type('type-name-input', 'Deity');
      click('add-field');
      type('field-key', 'battlemap');
      type('field-label', 'Battlemap');
      select('field-kind', CORE_HEX_GRID);
      click('field-show-as-view');

      submit();

      const [, req] = worlds.createType.mock.calls[0];
      // The Field is declared as ever — the toggle authors the *view* list, never the Field.
      expect(req.fields).toHaveLength(1);
      expect(req.views).toEqual([CORE_VIEW_FIELDS]);
    });

    it('reads the toggle back off an existing type’s view order', () => {
      worlds.availableTypes.mockReturnValue(
        of<AvailableType[]>([
          {
            id: 'world.deity',
            label: 'Deity',
            source: 'user',
            fields: [
              {
                key: 'battlemap',
                label: 'Battlemap',
                dataType: { kind: CORE_HEX_GRID },
                required: false,
                facetable: false,
              },
            ],
            // Authored with the toggle off: the Field is declared, but places no View.
            views: [CORE_VIEW_FIELDS],
          },
        ]),
      );
      fixture.componentInstance.ngOnInit();
      fixture.detectChanges();

      click('edit-world.deity');

      const toggle = fixture.debugElement.query(By.css('[data-testid="field-show-as-view"]'));
      expect(toggle.nativeElement.checked).toBe(false);
    });
  });
});

/**
 * With the content plugin composed, `core.rich-content` is offerable on the kind picker (#210): a World
 * Owner authors prose as a Structured Field like the grid, and two of them coexist as two Fields.
 */
describe('WorldTypesPanel with the content plugin', () => {
  let worlds: MockWorldsClient;
  let fixture: ComponentFixture<WorldTypesPanel>;

  const created: UserDefinedType = { id: 'world.saint', label: 'Saint', fields: [], fieldRefs: [] };

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worlds.createType.mockReturnValue(of(created));
    await TestBed.configureTestingModule({
      imports: [WorldTypesPanel, provideTranslocoTesting()],
      providers: [provideRouter([]), providePluginContent(), { provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');

    fixture = TestBed.createComponent(WorldTypesPanel);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
  });

  function query(testid: string): HTMLElement {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement;
  }
  function click(testid: string): void {
    query(testid).click();
    fixture.detectChanges();
  }
  function type(testid: string, value: string): void {
    const input = query(testid) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function fill(index: number, key: string, label: string): void {
    click('add-field');
    const row = fixture.debugElement.query(By.css(`[data-testid="field-${index}"]`));
    const keyInput = row.query(By.css('[data-testid="field-key"]')).nativeElement as HTMLInputElement;
    const labelInput = row.query(By.css('[data-testid="field-label"]')).nativeElement as HTMLInputElement;
    const kind = row.query(By.css('[data-testid="field-kind"]')).nativeElement as HTMLSelectElement;
    keyInput.value = key;
    keyInput.dispatchEvent(new Event('input'));
    labelInput.value = label;
    labelInput.dispatchEvent(new Event('input'));
    kind.value = CORE_RICH_CONTENT;
    kind.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  function submit(): void {
    fixture.debugElement
      .query(By.css('[data-testid="type-editor"]'))
      .triggerEventHandler('submit', new Event('submit'));
  }

  it('offers prose as a data-type beside the built-ins', () => {
    click('type-new');
    click('add-field');
    const kinds = fixture.debugElement
      .queryAll(By.css('[data-testid="field-kind"] option'))
      .map((option) => (option.nativeElement as HTMLOptionElement).value);
    expect(kinds).toContain(CORE_RICH_CONTENT);
  });

  it('authors two prose Fields, each placing its own View — two prose Fields coexist', () => {
    click('type-new');
    type('type-id-input', 'saint');
    type('type-name-input', 'Saint');
    fill(0, 'content', 'Content');
    fill(1, 'secrets', 'Secrets');
    submit();

    expect(worlds.createType).toHaveBeenCalledWith('w1', {
      id: 'world.saint',
      label: 'Saint',
      fields: [
        { key: 'content', label: 'Content', dataType: { kind: CORE_RICH_CONTENT }, required: false, facetable: false },
        { key: 'secrets', label: 'Secrets', dataType: { kind: CORE_RICH_CONTENT }, required: false, facetable: false },
      ],
      fieldRefs: [],
      // Each prose Field's View is placed after the generic Field view, in declaration order.
      views: [CORE_VIEW_FIELDS, { field: 'content' }, { field: 'secrets' }],
    });
  });
});

/** An Instance that does **not** bundle the map plugin — composed one provider short of the app's. */
describe('WorldTypesPanel without the Hex Map plugin', () => {
  let fixture: ComponentFixture<WorldTypesPanel>;

  beforeEach(async () => {
    const worlds = new MockWorldsClient();
    worlds.availableTypes.mockReturnValue(of<AvailableType[]>([]));
    await TestBed.configureTestingModule({
      imports: [WorldTypesPanel, provideTranslocoTesting()],
      providers: [provideRouter([]), { provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');

    fixture = TestBed.createComponent(WorldTypesPanel);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
  });

  it('offers only the built-in data-types — it never learns the name of a kind it cannot render', () => {
    fixture.debugElement.query(By.css('[data-testid="type-new"]')).nativeElement.click();
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="add-field"]')).nativeElement.click();
    fixture.detectChanges();

    const kinds = fixture.debugElement
      .queryAll(By.css('[data-testid="field-kind"] option'))
      .map((option) => option.nativeElement.value);
    expect(kinds).toEqual(['string', 'number', 'boolean', 'date', 'enum']);
  });
});
