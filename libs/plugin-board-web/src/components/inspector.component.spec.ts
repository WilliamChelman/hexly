import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { ENTITY_VIEW_CHOICES, EntityViewChoice } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardStore } from '../services/board-store';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';
import { InspectorComponent } from './inspector.component';

function render() {
  const fixture = TestBed.createComponent(InspectorComponent);
  fixture.detectChanges();
  return fixture;
}

function field(fixture: ReturnType<typeof TestBed.createComponent>, testid: string) {
  return fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLInputElement;
}

/** Add a Box (auto-selected) and render the Inspector on it. */
function withSelectedBox(store: BoardStore, position = { x: 40, y: -20 }) {
  const id = store.addElement(position);
  const fixture = render();
  return { id, fixture };
}

describe('Board Inspector single-element editing', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: provideBoardStoreTesting(),
    }).compileComponents();
  });

  it('shows the empty-state hint when nothing is selected', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('header')?.textContent).toContain('Inspector');
    expect(el.querySelector('[data-testid=element-x]')).toBeNull();
  });

  it("prefills the selected element's geometry", () => {
    const store = TestBed.inject(BoardStore);
    const { fixture } = withSelectedBox(store, { x: 12, y: 34 });

    expect(field(fixture, 'element-x').value).toBe('12');
    expect(field(fixture, 'element-y').value).toBe('34');
    expect(field(fixture, 'element-width').value).toBe('160');
    expect(field(fixture, 'element-height').value).toBe('120');
  });

  it('moves the element when the X and Y fields change', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store);

    const x = field(fixture, 'element-x');
    x.value = '300';
    x.dispatchEvent(new Event('change'));
    const y = field(fixture, 'element-y');
    y.value = '150';
    y.dispatchEvent(new Event('change'));

    const element = store.document().elements.find((e) => e.id === id);
    expect(element?.position).toEqual({ x: 300, y: 150 });
  });

  it('resizes the element when the width and height fields change', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store);

    const w = field(fixture, 'element-width');
    w.value = '250';
    w.dispatchEvent(new Event('change'));
    const h = field(fixture, 'element-height');
    h.value = '90';
    h.dispatchEvent(new Event('change'));

    const element = store.document().elements.find((e) => e.id === id);
    expect(element?.size).toEqual({ width: 250, height: 90 });
  });

  it('lands a pending geometry edit on the element it was typed into, not a newly selected one', () => {
    const store = TestBed.inject(BoardStore);
    const { id: a, fixture } = withSelectedBox(store, { x: 40, y: -20 });

    // The user focuses A's X field and types 500...
    const x = field(fixture, 'element-x');
    x.dispatchEvent(new Event('focus'));
    x.value = '500';
    // ...then clicks element B on the canvas: pointerdown re-points the selection, and only then does
    // the field blur and raise `change`.
    const b = store.addElement({ x: 50, y: 0 });
    x.dispatchEvent(new Event('change'));

    const byId = (id: string) => store.document().elements.find((e) => e.id === id);
    expect(byId(b)?.position).toEqual({ x: 50, y: 0 }); // B must not jump to the pending 500
    expect(byId(a)?.position).toEqual({ x: 500, y: -20 }); // the typed value follows the edited element
    expect(x.value).toBe('50'); // and the field re-syncs to the element it now renders
  });

  it('reverts the field instead of committing when it is emptied', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store, { x: 40, y: -20 });

    const x = field(fixture, 'element-x');
    x.dispatchEvent(new Event('focus'));
    x.value = ''; // Number('') === 0 — an empty field must not commit x=0
    x.dispatchEvent(new Event('change'));

    expect(store.document().elements.find((e) => e.id === id)?.position.x).toBe(40);
    expect(x.value).toBe('40');
  });

  it('reverts the field when the store rejects a non-finite entry', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store, { x: 40, y: -20 });

    const x = field(fixture, 'element-x');
    x.dispatchEvent(new Event('focus'));
    x.value = '1e400'; // Number('1e400') === Infinity — nothing commits, so [value] alone would leave it painted
    x.dispatchEvent(new Event('change'));

    expect(store.document().elements.find((e) => e.id === id)?.position.x).toBe(40);
    expect(x.value).toBe('40');
  });

  it('reverts a non-positive width to the model instead of clamping to a 1px sliver', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store);

    const w = field(fixture, 'element-width');
    w.dispatchEvent(new Event('focus'));
    w.value = '-50';
    w.dispatchEvent(new Event('change'));

    // Out-of-range commits nothing, matching the cleared-field behavior — clamping used to leave a
    // 1px sliver element.
    expect(store.document().elements.find((e) => e.id === id)?.size).toEqual({ width: 160, height: 120 });
    expect(w.value).toBe('160');
  });

  it('rounds displayed geometry to two decimals but commits full typed precision', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store, { x: -740.33501460766, y: 0.5 });

    // A drag can leave 10+ decimals; painted raw they overflow the field.
    expect(field(fixture, 'element-x').value).toBe('-740.34');
    expect(field(fixture, 'element-y').value).toBe('0.5');

    const x = field(fixture, 'element-x');
    x.dispatchEvent(new Event('focus'));
    x.value = '10.123456';
    x.dispatchEvent(new Event('change'));

    expect(store.document().elements.find((e) => e.id === id)?.position.x).toBe(10.123456);
    expect(x.value).toBe('10.12');
  });

  it('reorders the element via the stacking controls', () => {
    const store = TestBed.inject(BoardStore);
    const a = store.addElement({ x: 0, y: 0 });
    const b = store.addElement({ x: 50, y: 0 }); // b on top, selected
    const fixture = render();

    (fixture.nativeElement.querySelector('[data-testid=z-to-back]') as HTMLButtonElement).click();
    // b sent to the very back sits under a.
    const order = [...store.document().elements].sort((x, y) => x.z - y.z).map((e) => e.id);
    expect(order).toEqual([b, a]);
  });

  it('deletes the selected element when Delete is clicked', () => {
    const store = TestBed.inject(BoardStore);
    const { id, fixture } = withSelectedBox(store);

    const del = fixture.nativeElement.querySelector('[data-testid=element-delete]') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    del.click();

    expect(store.document().elements.find((e) => e.id === id)).toBeUndefined();
    expect(store.selectedElement()).toBeNull();
  });

  it('renders the single-element chrome in French', () => {
    const store = TestBed.inject(BoardStore);
    const { fixture } = withSelectedBox(store);
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('header')?.textContent).toContain('Élément sélectionné');
    expect(el.textContent).toContain('Largeur');
    expect(el.querySelector('[data-testid=element-delete]')?.textContent).toContain('Supprimer l’élément');
  });
});

describe('Board Inspector Embed view choices', () => {
  let subjects: Map<string, Subject<readonly EntityViewChoice[]>>;

  beforeEach(async () => {
    subjects = new Map();
    await TestBed.configureTestingModule({
      imports: [InspectorComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [
        ...provideBoardStoreTesting(),
        // A controllable resolver: hands back a per-target Subject so a spec can emit out of order.
        {
          provide: ENTITY_VIEW_CHOICES,
          useValue: (id: string) => {
            const s = new Subject<readonly EntityViewChoice[]>();
            subjects.set(id, s);
            return s;
          },
        },
      ],
    }).compileComponents();
  });

  function labels(fixture: ReturnType<typeof render>): (string | undefined)[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid=embed-view-select] option')).map((o) =>
      (o as HTMLElement).textContent?.trim(),
    );
  }

  it("withholds the select until choices load, then reflects the Embed's non-default View", () => {
    const store = TestBed.inject(BoardStore);
    store.addEmbed({ x: 0, y: 0 }, 'target-a', 'core.view.map:core.field.grid');
    const fixture = render();

    // While the choices are in flight there is no select: painted sooner it could only show the default
    // option, and a "confirming" change would silently re-point the Embed at ''.
    expect(fixture.nativeElement.querySelector('[data-testid=embed-view-select]')).toBeNull();

    subjects.get('target-a')?.next([{ view: { viewId: 'core.view.map', fieldKey: 'core.field.grid' }, label: 'Map' }]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-testid=embed-view-select]') as HTMLSelectElement;
    expect(select.value).toBe('core.view.map:core.field.grid');
  });

  it('drops a stale response when the selected Embed target changes (out-of-order)', () => {
    const store = TestBed.inject(BoardStore);
    store.addEmbed({ x: 0, y: 0 }, 'target-a'); // selected → effect subscribes to A
    const fixture = render();
    store.addEmbed({ x: 50, y: 0 }, 'target-b'); // now selected → effect cancels A, subscribes to B
    fixture.detectChanges();

    // Responses land out of order: B (current) then A (stale, already cancelled).
    subjects.get('target-b')?.next([{ view: { viewId: 'core.view.map', fieldKey: 'core.field.grid' }, label: 'Map' }]);
    subjects.get('target-a')?.next([{ view: { viewId: 'core.view.rich-content' }, label: 'Content' }]);
    fixture.detectChanges();

    const shown = labels(fixture);
    expect(shown).toContain('Map'); // B's Views
    expect(shown).not.toContain('Content'); // A's stale response never paints under B
  });
});

describe('Board Inspector multi-selection', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: provideBoardStoreTesting(),
    }).compileComponents();
  });

  function withTwoSelected() {
    const store = TestBed.inject(BoardStore);
    const a = store.addElement({ x: 0, y: 0 });
    const b = store.addElement({ x: 50, y: 0 });
    store.selectMany([a, b]);
    const fixture = render();
    return { store, fixture };
  }

  it('shows the selection count instead of a single-element editor when 2+ are selected', () => {
    const { fixture } = withTwoSelected();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid=selection-count]')?.textContent).toContain('2');
    expect(el.querySelector('[data-testid=element-x]')).toBeNull();
  });

  it('deletes the whole set when Delete all is clicked', () => {
    const { store, fixture } = withTwoSelected();
    const del = fixture.nativeElement.querySelector('[data-testid=selection-delete-all]') as HTMLButtonElement;
    expect(del.disabled).toBe(false);

    del.click();

    expect(store.document().elements).toEqual([]);
    expect(store.selectedIds()).toEqual([]);
  });
});
