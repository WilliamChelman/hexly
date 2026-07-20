import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { tiptapContent } from '@hexly/plugin-content';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardStore } from '../services/board-store';
import { BoardCamera } from '../services/board-camera';
import { Camera } from '../utils/camera';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardElementsComponent, resizeGeometry } from './board-elements.component';

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

// A Text Block now renders the real Content editor for both faces (#268), so any test that mounts one
// needs the editor's ambient deps — mirrors the TextBlock/ContentEditor harnesses.
const contentEditorHarness = () => [
  EntityNameResolver,
  provideHttpClient(),
  provideHttpClientTesting(),
  provideRouter([]),
  { provide: ActivatedRoute, useValue: { fragment: of(null) } },
];

describe('BoardElements rendering', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardElementsComponent,
        provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS }),
      ],
      providers: [...provideBoardStoreTesting(), BoardCamera, ...contentEditorHarness()],
    }).compileComponents();
  });

  function setup() {
    const store = TestBed.inject(BoardStore);
    const fixture = TestBed.createComponent(BoardElementsComponent);
    fixture.detectChanges();
    return { store, fixture };
  }

  it('renders a box for each element, positioned by the camera at zoom 1', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 30, y: 40 });
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    expect(box).not.toBeNull();
    // Identity camera (offset 0, zoom 1): world position maps straight to screen pixels.
    expect(box.style.left).toBe('30px');
    expect(box.style.top).toBe('40px');
    expect(box.style.width).toBe('160px');
    expect(box.style.height).toBe('120px');
  });

  it('scales content by the camera zoom while sizing the box in screen space', () => {
    const { store, fixture } = setup();
    const cam = TestBed.inject(BoardCamera);
    const id = store.addElement({ x: 0, y: 0 });
    cam.set(Camera.initial().zoomAt({ x: 0, y: 0 }, 2)); // zoom 2×, world origin fixed at screen origin
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    // Box is screen-sized (world 160×120 × zoom 2)…
    expect(box.style.width).toBe('320px');
    expect(box.style.height).toBe('240px');
    // …while the content wrapper stays world-sized and carries the scale, so the prose/image/embed
    // inside zooms with the box instead of reflowing at native size.
    const content = box.querySelector('.content') as HTMLElement;
    expect(content.style.width).toBe('160px');
    expect(content.style.height).toBe('120px');
    expect(content.style.scale).toBe('2');
  });

  it('shows resize handles only on a single selected element', () => {
    const { store, fixture } = setup();
    store.addElement({ x: 0, y: 0 }); // selected → handles
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-se]')).not.toBeNull();

    const b = store.addElement({ x: 50, y: 0 });
    store.selectMany([b, store.document().elements[0].id]); // two selected → no handles
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).toBeNull();
  });

  it('renders a Text Block’s prose in place, static (read-only) until armed', () => {
    const { store, fixture } = setup();
    const id = store.addText({ x: 0, y: 0 });
    store.setContent(
      id,
      tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whisperwood' }] }],
      }),
    );
    // addText arms the new block; disarm so the static (read-only) face renders.
    store.disarm();
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    expect(box.classList.contains('is-text')).toBe(true);
    expect(box.textContent).toContain('Whisperwood');
  });

  it('double-clicking a Text Block arms it for inline editing (#268)', () => {
    const { store, fixture } = setup();
    const id = store.addText({ x: 0, y: 0 });
    store.disarm();
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    // Assert the store state without re-rendering: mounting the live editor needs the full content
    // harness; the arm itself is what this seam owns.
    expect(store.armed()).toBe(id);
  });

  it('hides the resize handles on an armed element — it must be disarmed before resizing (#268)', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 0, y: 0 }); // a Box, selected → handles show
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).not.toBeNull();

    store.arm(id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).toBeNull();
  });

  it('paints elements bottom-to-top so the DOM order is the stacking order', () => {
    const { store, fixture } = setup();
    const a = store.addElement({ x: 0, y: 0 });
    const b = store.addElement({ x: 10, y: 0 });
    store.sendBackward(b); // b now under a
    fixture.detectChanges();

    const ids = Array.from(fixture.nativeElement.querySelectorAll('.element')).map((el) =>
      (el as HTMLElement).getAttribute('data-testid'),
    );
    expect(ids).toEqual([`element-${b}`, `element-${a}`]);
  });
});

describe('BoardElements read-only (ADR-0062 transclusion / read-only viewer)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardElementsComponent,
        provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS }),
      ],
      providers: [...provideBoardStoreTesting(), BoardCamera, ...contentEditorHarness()],
    }).compileComponents();
  });

  function setup() {
    const store = TestBed.inject(BoardStore);
    const fixture = TestBed.createComponent(BoardElementsComponent);
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    return { store, fixture };
  }

  it('still renders every element (content, not a bare grid)', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 30, y: 40 });
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.classList.contains('is-readonly')).toBe(true);
  });

  it('shows no resize handles even on a single selected element', () => {
    const { store, fixture } = setup();
    store.addElement({ x: 0, y: 0 }); // selected on add
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).toBeNull();
  });

  it('does not arm a Text Block on double-click', () => {
    const { store, fixture } = setup();
    const id = store.addText({ x: 0, y: 0 });
    store.disarm();
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
    box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(store.armed()).toBeNull();
  });

  it('ignores mutation keys — a window keydown cannot delete or reorder a transcluded board', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    press('Delete');
    expect(store.document().elements.find((e) => e.id === id)).toBeDefined();
  });

  it('does not start a move gesture on an element press', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;

    box.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));

    // The element never moved: no gesture was armed by the read-only press.
    expect(store.document().elements.find((e) => e.id === id)?.position).toEqual({ x: 0, y: 0 });
  });
});

describe('BoardElements keyboard', () => {
  let store: BoardStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardElementsComponent,
        provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS }),
      ],
      providers: [...provideBoardStoreTesting(), BoardCamera, ...contentEditorHarness()],
    }).compileComponents();
    const fixture = TestBed.createComponent(BoardElementsComponent);
    fixture.detectChanges();
    store = TestBed.inject(BoardStore);
  });

  it('deletes the selection on Delete/Backspace', () => {
    const id = store.addElement({ x: 0, y: 0 });
    press('Delete');
    expect(store.document().elements.find((e) => e.id === id)).toBeUndefined();
  });

  it('clears the selection on Escape', () => {
    store.addElement({ x: 0, y: 0 });
    press('Escape');
    expect(store.selectedIds()).toEqual([]);
  });

  it('arms Tools from their letter, and undoes on Cmd/Ctrl+Z', () => {
    press('b');
    expect(store.tool()).toBe('box');
    press('v');
    expect(store.tool()).toBe('select');

    store.addElement({ x: 0, y: 0 });
    press('z', { ctrlKey: true });
    expect(store.document().elements).toEqual([]);
  });
});

describe('resizeGeometry', () => {
  const origin = { position: { x: 10, y: 20 }, size: { width: 100, height: 80 } };

  it('grows from the south-east corner, anchoring the top-left', () => {
    const { position, size } = resizeGeometry(origin, 'se', 40, 30);
    expect(position).toEqual({ x: 10, y: 20 });
    expect(size).toEqual({ width: 140, height: 110 });
  });

  it('drags the north-west corner, anchoring the bottom-right', () => {
    const { position, size } = resizeGeometry(origin, 'nw', -10, -20);
    // Left/top edges move out; the opposite edges (right=110, bottom=100) stay put.
    expect(position).toEqual({ x: 0, y: 0 });
    expect(size).toEqual({ width: 110, height: 100 });
  });

  it('floors each dimension at the minimum, never inverting', () => {
    const { position, size } = resizeGeometry(origin, 'nw', 500, 500);
    // The dragged edges can't cross the anchored ones — size clamps to the 20px floor.
    expect(size.width).toBe(20);
    expect(size.height).toBe(20);
    expect(position).toEqual({ x: 90, y: 80 }); // right(110)-20, bottom(100)-20
  });
});
