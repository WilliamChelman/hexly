import { TestBed } from '@angular/core/testing';
import { tiptapContent } from '@hexly/plugin-content';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardStore } from '../services/board-store';
import { BoardCamera } from '../services/board-camera';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardElementsComponent, resizeGeometry } from './board-elements.component';

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('BoardElements rendering', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardElementsComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [...provideBoardStoreTesting(), BoardCamera],
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

describe('BoardElements keyboard', () => {
  let store: BoardStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardElementsComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [...provideBoardStoreTesting(), BoardCamera],
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
