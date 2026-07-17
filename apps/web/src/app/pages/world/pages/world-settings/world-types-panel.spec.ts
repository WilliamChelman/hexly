import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AvailableType, defineField } from '@hexly/domain';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { CORE_VIEW_FIELDS } from '@hexly/web-entity';
import { CORE_HEX_GRID } from '@hexly/plugin-hexmap';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { TypeRegistry } from '../../../../entity-types/type-registry';
import { WorldTypesPanel } from './world-types-panel';

/**
 * The type-authoring form: a type *references* reusable Fields by id (ADR-0054), so the editor is a
 * checklist over the World's registered Fields (plus a "New field" modal that mints one), never an
 * inline-schema authoring surface.
 */
describe('WorldTypesPanel', () => {
  let worlds: MockWorldsClient;
  let registry: TypeRegistry;
  let fixture: ComponentFixture<WorldTypesPanel>;

  // The World's registered Fields the picker offers, resolved by id through the registry.
  const domainField = defineField({
    id: 'world.domain',
    key: 'domain',
    label: 'Domain',
    dataType: { kind: 'string' },
    facetable: true,
  });
  const battlemapField = defineField({
    id: 'world.battlemap',
    key: 'battlemap',
    label: 'Battlemap',
    dataType: { kind: CORE_HEX_GRID },
  });

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worlds.createType.mockReturnValue(of({ id: 'world.deity', label: 'Deity', fieldRefs: [] }));
    worlds.updateType.mockReturnValue(of({ id: 'world.deity', label: 'Deity', fieldRefs: [] }));
    worlds.fields.mockReturnValue(of([domainField, battlemapField]));
    await TestBed.configureTestingModule({
      imports: [WorldTypesPanel, provideTranslocoTesting()],
      // The map plugin, composed as `app.config.ts` does — its grid data-type reaches the new-Field
      // modal's kind picker (#199), and its Plugin Field the reference checklist.
      providers: [provideRouter([]), providePluginHexmap(), { provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
    registry = TestBed.inject(TypeRegistry);
    // The World's Fields resolve by id (ADR-0054) — projected by WorldFieldsLoader in prod; set here so
    // the reference picker offers them.
    registry.setWorldFields([domainField, battlemapField]);

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

  /** Pick an option in the `<select>` with `data-testid`. */
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

  function checked(testid: string): boolean {
    return (fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLInputElement).checked;
  }

  it('offers the World’s registered Fields as a reference checklist', () => {
    click('type-new');
    expect(fixture.debugElement.query(By.css('[data-testid="field-ref-world.domain"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="field-ref-world.battlemap"]'))).toBeTruthy();
  });

  it('references a Field and posts the type carrying its id, defaulting the generic Field view', () => {
    click('type-new');
    type('type-id-input', 'deity');
    type('type-name-input', 'Deity');
    click('field-ref-checkbox-world.domain');
    submit();

    expect(worlds.createType).toHaveBeenCalledWith('w1', {
      id: 'world.deity',
      label: 'Deity',
      fieldRefs: ['world.domain'],
      // A string Field places no View; a type with no Structured Data Type Field opens on its Fields (ADR-0051).
      views: [CORE_VIEW_FIELDS],
    });
  });

  it('places a referenced Field of a Structured Data Type’s View last, so the type opens on its Fields', () => {
    click('type-new');
    type('type-id-input', 'deity');
    type('type-name-input', 'Deity');
    click('field-ref-checkbox-world.battlemap');
    submit();

    expect(worlds.createType).toHaveBeenCalledWith('w1', {
      id: 'world.deity',
      label: 'Deity',
      fieldRefs: ['world.battlemap'],
      // "Show as a view" defaults on, and the grid's View sits *after* the generic Field view.
      views: [CORE_VIEW_FIELDS, { field: 'battlemap' }],
    });
  });

  it('withholds a structured Field’s View when its toggle is off, keeping the reference', () => {
    click('type-new');
    type('type-id-input', 'deity');
    type('type-name-input', 'Deity');
    click('field-ref-checkbox-world.battlemap');
    expect(checked('field-show-as-view-world.battlemap')).toBe(true);
    click('field-show-as-view-world.battlemap');
    submit();

    const [, req] = worlds.createType.mock.calls[0];
    expect(req.fieldRefs).toEqual(['world.battlemap']);
    expect(req.views).toEqual([CORE_VIEW_FIELDS]);
  });

  it('mints a new World Field from the inline modal, then references it', () => {
    const element = defineField({
      id: 'world.element',
      key: 'world.element',
      label: 'Element',
      dataType: { kind: 'string' },
    });
    worlds.createField.mockReturnValue(of(element));

    click('type-new');
    type('type-id-input', 'deity');
    type('type-name-input', 'Deity');
    click('new-field');
    type('newfield-name', 'Element');
    click('newfield-save');

    // No client-chosen id/key: the label drives the `element` segment, and the server derives
    // `world.element` (ADR-0056).
    expect(worlds.createField).toHaveBeenCalledWith('w1', {
      segment: 'element',
      label: 'Element',
      dataType: { kind: 'string' },
      required: false,
      facetable: false,
    });
  });

  it('offers the map plugin’s data-type on the new-Field modal’s kind picker', () => {
    click('type-new');
    click('new-field');
    const kinds = fixture.debugElement
      .queryAll(By.css('[data-testid="newfield-kind"] option'))
      .map((option) => (option.nativeElement as HTMLOptionElement).value);
    expect(kinds).toEqual(['string', 'number', 'boolean', 'date', 'enum', CORE_HEX_GRID]);
  });

  it('reflects an existing type’s referenced Fields and view order when editing', () => {
    worlds.availableTypes.mockReturnValue(
      of<AvailableType[]>([
        {
          id: 'world.deity',
          label: 'Deity',
          source: 'user',
          fieldRefs: ['world.battlemap'],
          views: [CORE_VIEW_FIELDS],
        },
      ]),
    );
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    click('edit-world.deity');
    // The grid Field is referenced (checked)…
    expect(checked('field-ref-checkbox-world.battlemap')).toBe(true);
    // …but its View is not placed in the stored order, so "Show as a view" reads back off.
    expect(checked('field-show-as-view-world.battlemap')).toBe(false);
  });
});
