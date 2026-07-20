import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { addElement, emptyBoardSurface } from '@hexly/plugin-board';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardCamera } from '../services/board-camera';
import { BoardStore } from '../services/board-store';
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
      imports: [
        BoardViewComponent,
        provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS }),
      ],
      providers: [
        ...provideBoardStoreTesting(),
        // The armed Text Block mounts the reused Content editor; these are its ambient dependencies
        // (mirrors the ContentEditor/TextBlock spec harnesses).
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { fragment: of(null) } },
      ],
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

  /**
   * Wheel pan/zoom is delegated from the View host so it catches wheels over *both* layers — the canvas
   * grid and the DOM element overlay (its boxes are `pointer-events-auto`, so a wheel over one never
   * reaches the canvas' own listener, the reported bug). Two regions keep the wheel: the floating chrome
   * and an armed element's interactive content.
   */
  describe('wheel pan/zoom', () => {
    function wheel(target: Element, init: WheelEventInit): void {
      target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
    }

    /** Resolve a required element, asserting it is present so a missing target never masks a false green. */
    function query(fixture: ReturnType<typeof render>, selector: string): Element {
      const el = (fixture.nativeElement as HTMLElement).querySelector(selector);
      expect(el).not.toBeNull();
      return el as Element;
    }

    it('pans the camera on a wheel over an element box (a sibling-overlay box, not the canvas)', () => {
      seedOneElement();
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      wheel(query(fixture, '[data-testid=element-e1]'), { deltaX: 0, deltaY: 100 });

      // Plain scroll pans: scrolling down moves content up, so the offset drops by the delta.
      expect(cam.camera().offset.y).toBe(before.offset.y - 100);
    });

    it('zooms the camera on ctrl+wheel over an element box', () => {
      seedOneElement();
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);

      wheel(query(fixture, '[data-testid=element-e1]'), { deltaY: -100, ctrlKey: true });

      // Ctrl+wheel up zooms in past the identity scale.
      expect(cam.camera().zoom).toBeGreaterThan(1);
    });

    it('leaves the camera untouched for a wheel inside an armed Text Block editor', () => {
      const fixture = render();
      const store = fixture.debugElement.injector.get(BoardStore);
      const id = store.addText({ x: 0, y: 0 }); // addText arms the new block
      fixture.detectChanges();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      wheel(query(fixture, `[data-testid=element-${id}] app-board-text-block`), { deltaY: 100 });

      // Same camera instance — the guard never called through, so the editor keeps the wheel.
      expect(cam.camera()).toBe(before);
    });

    it('leaves the camera untouched for a wheel over the Inspector', () => {
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      wheel(query(fixture, 'app-board-inspector'), { deltaY: 100, ctrlKey: true });

      expect(cam.camera()).toBe(before);
    });
  });
});
