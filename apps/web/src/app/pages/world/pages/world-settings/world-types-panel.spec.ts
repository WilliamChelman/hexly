import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AvailableType, UserDefinedType } from '@hexly/domain';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { WorldTypesPanel } from './world-types-panel';

/**
 * The type-authoring form's draft editing (#191). The Field rows are the crux: every draft edit goes
 * through an immer recipe, and a recipe that *returns* a value (a bare `push(…)`/`Object.assign(…)`)
 * makes immer throw instead of mutating — which silently broke "Add field".
 */
describe('WorldTypesPanel', () => {
  let worlds: MockWorldsClient;
  let fixture: ComponentFixture<WorldTypesPanel>;

  const created: UserDefinedType = { id: 'world.deity', label: 'Deity', fields: [] };

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worlds.createType.mockReturnValue(of(created));
    await TestBed.configureTestingModule({
      imports: [WorldTypesPanel, provideTranslocoTesting()],
      providers: [provideRouter([]), { provide: WorldsClient, useValue: worlds }],
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

    fixture.debugElement
      .query(By.css('[data-testid="type-editor"]'))
      .triggerEventHandler('submit', new Event('submit'));

    expect(worlds.createType).toHaveBeenCalledWith('w1', {
      id: 'world.deity',
      label: 'Deity',
      fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' }, required: false, facetable: true }],
    });
  });
});
