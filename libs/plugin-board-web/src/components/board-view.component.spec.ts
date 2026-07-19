import { TestBed } from '@angular/core/testing';
import { addElement, emptyBoardSurface } from '@hexly/plugin-board';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardViewComponent } from './board-view.component';

/**
 * Smoke coverage for the View shell: the element overlay renders for every session (ADR-0062) — a
 * read-only opener or an Embed's transclusion must see the Board's content, not a bare grid — while the
 * editing chrome (tool palette, Inspector) and the overlay's editing gestures are gated on
 * {@link ENTITY_SESSION.writable} (ADR-0037), mirroring the Hex Map View.
 */
describe('BoardView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardViewComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: provideBoardStoreTesting(),
    }).compileComponents();
  });

  /** Seed the session with a surface carrying one Box so the overlay has an element to draw. */
  function seedOneElement() {
    const surface = addElement(emptyBoardSurface(), {
      id: 'e1',
      kind: 'box',
      position: { x: 30, y: 40 },
      size: { width: 100, height: 80 },
      z: 0,
    });
    TestBed.inject(FakeEntitySession).load(surface);
  }

  function render() {
    const fixture = TestBed.createComponent(BoardViewComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the palette, Inspector, and element overlay for a writable opener', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('app-board-canvas')).not.toBeNull();
    expect(el.querySelector('app-board-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-board-inspector')).not.toBeNull();
    const overlay = el.querySelector('app-board-elements');
    expect(overlay).not.toBeNull();
    // Writable → the overlay is interactive, not read-only.
    expect(overlay?.querySelector('.element')).toBeNull(); // no element seeded here
  });

  it('renders the element overlay read-only for a read-only opener, keeping the canvas but hiding editing chrome', () => {
    TestBed.inject(FakeEntitySession).setWritable(false);
    seedOneElement();
    const el = render().nativeElement as HTMLElement;

    // The plane and its content still render — a transcluded/read-only Board is not an empty grid.
    expect(el.querySelector('app-board-canvas')).not.toBeNull();
    const box = el.querySelector('[data-testid=element-e1]');
    expect(box).not.toBeNull();
    expect(box?.classList.contains('is-readonly')).toBe(true);
    // No editing affordances: no handles, no palette, no Inspector.
    expect(el.querySelector('[data-testid=handle-nw]')).toBeNull();
    expect(el.querySelector('app-board-tool-palette')).toBeNull();
    expect(el.querySelector('app-board-inspector')).toBeNull();
  });
});
