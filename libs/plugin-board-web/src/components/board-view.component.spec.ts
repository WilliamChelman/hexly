import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { addElement, emptyBoardSurface } from '@hexly/plugin-board';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { provideEntityTypesTesting } from '@hexly/web-entity/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardCamera } from '../services/board-camera';
import { BoardStore } from '../services/board-store';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardViewComponent } from './board-view.component';

/**
 * Smoke coverage for the View shell: the element overlay renders for every session (ADR-0062) — a
 * read-only opener or an Embed's transclusion must see the Board's content, not a bare grid — while the
 * editing chrome (the tool palette) and the overlay's editing gestures are gated on
 * {@link ENTITY_SESSION.writable} (ADR-0037), mirroring the Hex Map View. The Inspector is a page-Dock
 * Panel now (ADR-0067), mounted by the page's Dock rather than this View, so it never renders in this host.
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
        // The `@` mention inside that editor reads its Facet vocabulary off the registry (ADR-0082).
        provideEntityTypesTesting([]),
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

  it('renders the palette and element overlay for a writable opener', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('app-board-canvas')).not.toBeNull();
    expect(el.querySelector('app-board-tool-palette')).not.toBeNull();
    // The Inspector is page-Dock chrome now (ADR-0067), never a child of this View.
    expect(el.querySelector('app-board-inspector')).toBeNull();
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
    // No editing affordances: no handles, no palette. (The Inspector, a write-gated page-Dock Panel now,
    // is never a child of this View regardless of writability — ADR-0067.)
    expect(el.querySelector('[data-testid=handle-nw]')).toBeNull();
    expect(el.querySelector('app-board-tool-palette')).toBeNull();
  });

  /**
   * Wheel pan/zoom is delegated from the View host so it catches wheels over *both* layers — the canvas
   * grid and the DOM element overlay (its boxes are `pointer-events-auto`, so a wheel over one never
   * reaches the canvas' own listener, the reported bug). Two regions keep the *plain* wheel: the floating
   * chrome and an armed element's interactive content; Ctrl/⌘+wheel (a pinch) is a zoom intent and is
   * forwarded from both.
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

    /**
     * The wheel listener's host must be a real full-bleed box, never `display:contents` (the 08bdd28
     * regression): a boxless host takes the bubbled wheel as non-cancelable, so `preventDefault()` is
     * dropped and a trackpad pinch zooms the whole page. jsdom can't observe passivity, so this locks in
     * the layout choice that keeps the wheel cancelable in a real browser.
     */
    it('mounts on a real full-bleed box, not display:contents (08bdd28 regression guard)', () => {
      const host = render().nativeElement as HTMLElement;
      expect(host.classList.contains('contents')).toBe(false);
      expect(host.classList.contains('absolute')).toBe(true);
      expect(host.classList.contains('inset-0')).toBe(true);
    });

    it('cancels the wheel default over an element box, so a pinch never zooms the page', () => {
      seedOneElement();
      const fixture = render();
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
      query(fixture, '[data-testid=element-e1]').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

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

    it('leaves the camera untouched for a *plain* wheel inside an armed Text Block editor', () => {
      const fixture = render();
      const store = fixture.debugElement.injector.get(BoardStore);
      const id = store.addText({ x: 0, y: 0 }); // addText arms the new block
      fixture.detectChanges();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      wheel(query(fixture, `[data-testid=element-${id}] app-board-text-block`), { deltaY: 100 });

      // Same camera instance — the guard never called through, so the editor keeps the plain scroll.
      expect(cam.camera()).toBe(before);
    });

    it('zooms the board on Ctrl/⌘+wheel over an armed element — a pinch while editing must not zoom the page', () => {
      const fixture = render();
      const store = fixture.debugElement.injector.get(BoardStore);
      const id = store.addText({ x: 0, y: 0 }); // armed
      fixture.detectChanges();
      const cam = fixture.debugElement.injector.get(BoardCamera);

      // Returning without preventDefault here was the exact 08bdd28 symptom: the armed exemption covers
      // only the plain scroll; a zoom intent is forwarded (and cancelled) like anywhere else.
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
      query(fixture, `[data-testid=element-${id}] app-board-text-block`).dispatchEvent(event);

      expect(cam.camera().zoom).toBeGreaterThan(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the camera untouched for a *plain* wheel over the chrome — it must scroll natively', () => {
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      // The tool palette stands in for the floating chrome exemption; the Inspector is a page-Dock Panel
      // now (ADR-0067), mounted outside this host, so its wheels never reach this listener at all.
      wheel(query(fixture, 'app-board-tool-palette'), { deltaY: 100 });

      expect(cam.camera()).toBe(before);
    });

    it('zooms the board on Ctrl/⌘+wheel over the chrome — a pinch over the palette must not zoom the page', () => {
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);

      // The chrome exemption used to return without preventDefault for every wheel; the zoom intent is
      // now forwarded (and cancelled) exactly like over an armed element.
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
      query(fixture, 'app-board-tool-palette').dispatchEvent(event);

      expect(cam.camera().zoom).toBeGreaterThan(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('stops propagation of a handled wheel, so an outer board (board-in-board) never rides the gesture', () => {
      seedOneElement();
      const fixture = render();
      const reachedWindow = vi.fn();
      window.addEventListener('wheel', reachedWindow);

      // Forwarded-to-canvas wheels must die here: transcluded into another Board, the outer View's
      // listener would otherwise zoom its camera off the same pinch.
      wheel(query(fixture, '[data-testid=element-e1]'), { deltaY: -100, ctrlKey: true });
      window.removeEventListener('wheel', reachedWindow);

      expect(reachedWindow).not.toHaveBeenCalled();
    });

    it('lets an exempted plain wheel keep bubbling — the inner content owns its native scroll', () => {
      const fixture = render();
      const reachedWindow = vi.fn();
      window.addEventListener('wheel', reachedWindow);

      wheel(query(fixture, 'app-board-tool-palette'), { deltaY: 100 });
      window.removeEventListener('wheel', reachedWindow);

      expect(reachedWindow).toHaveBeenCalledOnce();
    });

    it('leaves the camera untouched for a wheel over the selected element’s control strip', () => {
      const fixture = render();
      const store = fixture.debugElement.injector.get(BoardStore);
      store.addText({ x: 0, y: 0 });
      store.disarm(); // selected single Text Block → the floating controls render
      fixture.detectChanges();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();

      // Scrolling over the strip used to pan the board out from under its buttons.
      wheel(query(fixture, 'app-board-element-controls'), { deltaY: 100 });

      expect(cam.camera()).toBe(before);
    });

    it('swallows the wheel entirely while an element gesture is in flight', () => {
      seedOneElement();
      const fixture = render();
      const cam = fixture.debugElement.injector.get(BoardCamera);
      const before = cam.camera();
      const boxEl = query(fixture, '[data-testid=element-e1]');

      // Start a live move gesture on the element…
      boxEl.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: 0, clientY: 0 }),
      );
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, clientX: 20, clientY: 0 }));

      // …then wheel: the overlay's world math froze the zoom at the press, so the camera must not move
      // under the drag — and the event is cancelled so a mid-drag pinch can't zoom the page either.
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
      boxEl.dispatchEvent(event);

      expect(cam.camera()).toBe(before);
      expect(event.defaultPrevented).toBe(true);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 20, clientY: 0 }));
    });
  });
});
