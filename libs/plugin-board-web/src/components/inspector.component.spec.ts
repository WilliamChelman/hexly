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

  it('drops a stale response when the selected Embed target changes (out-of-order)', () => {
    const store = TestBed.inject(BoardStore);
    store.addEmbed({ x: 0, y: 0 }, 'target-a'); // selected → effect subscribes to A
    const fixture = render();
    store.addEmbed({ x: 50, y: 0 }, 'target-b'); // now selected → effect cancels A, subscribes to B
    fixture.detectChanges();

    // Responses land out of order: B (current) then A (stale, already cancelled).
    subjects.get('target-b')?.next([{ view: { viewId: 'core.view.map', fieldKey: 'core.grid' }, label: 'Map' }]);
    subjects.get('target-a')?.next([{ view: { viewId: 'core.view.content' }, label: 'Content' }]);
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
