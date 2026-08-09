import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { tiptapContent } from '@hexly/plugin-content';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { EntityNameResolver } from '@hexly/plugin-content/web';
import { IS_MAC_PLATFORM, ShortcutService } from '@hexly/web-core';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { provideEntityTypesTesting } from '@hexly/web-entity/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardStore } from '../services/board-store';
import { BoardCamera } from '../services/board-camera';
import { Camera } from '../utils/camera';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardElementsComponent, resizeGeometry } from './board-elements.component';
import { TextBlockComponent } from './text-block.component';

/** Dispatch a keydown that reaches the ShortcutService's one window listener (ADR-0063). */
function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

/** A press on an element box / handle — buttons=1 mirrors a held primary button. */
function pointerDown(el: Element, init: PointerEventInit = {}): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...init }));
}

/** The overlay tracks drags on `document:` listeners, so moves/releases are dispatched on the document. */
function pointerMove(init: PointerEventInit = {}): void {
  document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, ...init }));
}

function pointerUp(init: PointerEventInit = {}): void {
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...init }));
}

// A Text Block now renders the real Content editor for both faces (#268), so any test that mounts one
// needs the editor's ambient deps — mirrors the TextBlock/ContentEditor harnesses.
const contentEditorHarness = () => [
  // The `@` mention inside the reused editor reads its Facet vocabulary off the registry (ADR-0082).
  provideEntityTypesTesting([]),
  EntityNameResolver,
  provideHttpClient(),
  provideHttpClientTesting(),
  provideRouter([]),
  { provide: ActivatedRoute, useValue: { fragment: of(null) } },
];

async function configure(): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [
      BoardElementsComponent,
      provideTranslocoTesting({ ...BOARD_TEST_CATALOGS, ...CONTENT_EDITOR_TEST_CATALOGS }),
    ],
    providers: [
      ...provideBoardStoreTesting(),
      BoardCamera,
      ...contentEditorHarness(),
      // Pin `mod` to Ctrl so the chords below are platform-stable in CI (see IS_MAC_PLATFORM).
      { provide: IS_MAC_PLATFORM, useValue: false },
    ],
  }).compileComponents();
}

function setup(readOnly = false) {
  const store = TestBed.inject(BoardStore);
  const fixture = TestBed.createComponent(BoardElementsComponent);
  if (readOnly) fixture.componentRef.setInput('readOnly', true);
  fixture.detectChanges();
  return { store, fixture };
}

function box(fixture: ComponentFixture<BoardElementsComponent>, id: string): HTMLElement {
  const el = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement | null;
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe('BoardElements rendering', () => {
  beforeEach(configure);

  it('renders a box for each element, positioned by the camera at zoom 1', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 30, y: 40 });
    fixture.detectChanges();

    const el = box(fixture, id);
    // Identity camera (offset 0, zoom 1): world position maps straight to screen pixels.
    expect(el.style.left).toBe('30px');
    expect(el.style.top).toBe('40px');
    expect(el.style.width).toBe('160px');
    expect(el.style.height).toBe('120px');
  });

  it('scales content by the camera zoom while sizing the box in screen space', () => {
    const { store, fixture } = setup();
    const cam = TestBed.inject(BoardCamera);
    const id = store.addElement({ x: 0, y: 0 });
    cam.set(Camera.initial().zoomAt({ x: 0, y: 0 }, 2)); // zoom 2×, world origin fixed at screen origin
    fixture.detectChanges();

    const el = box(fixture, id);
    // Box is screen-sized (world 160×120 × zoom 2)…
    expect(el.style.width).toBe('320px');
    expect(el.style.height).toBe('240px');
    // …while the content wrapper stays world-sized and carries the scale, so the prose/image/embed
    // inside zooms with the box instead of reflowing at native size.
    const content = el.querySelector('.content') as HTMLElement;
    expect(content.style.width).toBe('160px');
    expect(content.style.height).toBe('120px');
    expect(content.style.scale).toBe('2');
  });

  it('labels each element box by its kind, so assistive tech hears more than "element"', () => {
    const { store, fixture } = setup();
    const boxId = store.addElement({ x: 0, y: 0 });
    const textId = store.addText({ x: 50, y: 0 });
    store.disarm();
    fixture.detectChanges();

    expect(box(fixture, boxId).getAttribute('aria-label')).toBe('Box element');
    expect(box(fixture, textId).getAttribute('aria-label')).toBe('Text block element');
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

    const el = box(fixture, id);
    expect(el.classList.contains('is-text')).toBe(true);
    expect(el.textContent).toContain('Whisperwood');
  });

  it('double-clicking a Text Block arms it for inline editing (#268)', () => {
    const { store, fixture } = setup();
    const id = store.addText({ x: 0, y: 0 });
    store.disarm();
    fixture.detectChanges();

    box(fixture, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

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

  it('focuses the armed Text Block’s editor when arming (dblclick or the Text tool, which arms on placement)', async () => {
    const { store, fixture } = setup();
    const id = store.addText({ x: 0, y: 0 });
    store.disarm();
    fixture.detectChanges();

    const block = fixture.debugElement.query(By.directive(TextBlockComponent)).componentInstance as TextBlockComponent;
    const focus = vi.spyOn(block, 'focus');

    // Arming without moving focus left the keyboard on <body>, so the next Backspace deleted the whole
    // element and a caret needed a third click. The effect watches `armed`, so it covers both paths.
    store.arm(id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(focus).toHaveBeenCalled();
  });
});

describe('BoardElements read-only (ADR-0062 transclusion / read-only viewer)', () => {
  beforeEach(configure);

  it('still renders every element (content, not a bare grid)', () => {
    const { store, fixture } = setup(true);
    const id = store.addElement({ x: 30, y: 40 });
    fixture.detectChanges();
    expect(box(fixture, id).classList.contains('is-readonly')).toBe(true);
  });

  it('shows no resize handles even on a single selected element', () => {
    const { store, fixture } = setup(true);
    store.addElement({ x: 0, y: 0 }); // selected on add
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=handle-nw]')).toBeNull();
  });

  it('does not arm a Text Block on double-click', () => {
    const { store, fixture } = setup(true);
    const id = store.addText({ x: 0, y: 0 });
    store.disarm();
    fixture.detectChanges();

    box(fixture, id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(store.armed()).toBeNull();
  });

  it('ignores mutation keys — a window keydown cannot delete or reorder a transcluded board', () => {
    const { store, fixture } = setup(true);
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    press('Delete');
    expect(store.document().elements.find((e) => e.id === id)).toBeDefined();
  });

  it('does not start a move gesture on an element press', () => {
    const { store, fixture } = setup(true);
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    pointerDown(box(fixture, id), { clientX: 0, clientY: 0 });
    pointerMove({ clientX: 100, clientY: 100 });
    pointerUp({ clientX: 100, clientY: 100 });

    // The element never moved: no gesture was armed by the read-only press.
    expect(store.document().elements.find((e) => e.id === id)?.position).toEqual({ x: 0, y: 0 });
  });
});

describe('BoardElements gestures', () => {
  beforeEach(configure);

  it('commits a move on release, dividing by the zoom frozen at the press (not the live camera)', () => {
    const { store, fixture } = setup();
    const cam = TestBed.inject(BoardCamera);
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    pointerDown(box(fixture, id), { clientX: 0, clientY: 0 });
    pointerMove({ clientX: 10, clientY: 0 }); // crosses the drag threshold at zoom 1
    // A pinch lands mid-drag: the gesture's world math must keep the zoom it started under, or the
    // element snaps to half the distance under a stationary pointer.
    cam.set(Camera.initial().zoomAt({ x: 0, y: 0 }, 2));
    pointerMove({ clientX: 100, clientY: 0 });
    pointerUp({ clientX: 100, clientY: 0 });

    expect(store.document().elements[0].position).toEqual({ x: 100, y: 0 });
  });

  it('Escape cancels a move in flight: nothing commits on release and the multi-selection survives', () => {
    const { store, fixture } = setup();
    const a = store.addElement({ x: 0, y: 0 });
    const b = store.addElement({ x: 50, y: 0 });
    store.selectMany([a, b]);
    fixture.detectChanges();

    pointerDown(box(fixture, a), { clientX: 0, clientY: 0 }); // plain press on a selected element → group move
    pointerMove({ clientX: 60, clientY: 60 });
    press('Escape');
    pointerUp({ clientX: 60, clientY: 60 }); // the release after a cancel is inert

    const byId = new Map(store.document().elements.map((e) => [e.id, e]));
    expect(byId.get(a)?.position).toEqual({ x: 0, y: 0 });
    expect(byId.get(b)?.position).toEqual({ x: 50, y: 0 });
    expect(new Set(store.selectedIds())).toEqual(new Set([a, b]));
  });

  it('Escape cancels a resize in flight — the release no longer commits the abandoned preview', () => {
    const { store, fixture } = setup();
    store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    const handle = fixture.nativeElement.querySelector('[data-testid=handle-se]') as HTMLElement;
    pointerDown(handle, { clientX: 0, clientY: 0 });
    pointerMove({ clientX: 40, clientY: 30 });
    press('Escape');
    pointerUp({ clientX: 40, clientY: 30 });

    expect(store.document().elements[0].size).toEqual({ width: 160, height: 120 });
  });

  it('ignores a foreign pointer: only the gesture’s own pointer drives and ends it', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    pointerDown(box(fixture, id), { clientX: 0, clientY: 0, pointerId: 1 });
    pointerMove({ clientX: 500, clientY: 500, pointerId: 7 }); // a second touch: not this gesture's
    pointerUp({ clientX: 500, clientY: 500, pointerId: 7 }); // nor may it end the gesture
    pointerMove({ clientX: 50, clientY: 0, pointerId: 1 });
    pointerUp({ clientX: 50, clientY: 0, pointerId: 1 });

    expect(store.document().elements[0].position).toEqual({ x: 50, y: 0 });
  });

  it('abandons the gesture when the pointer moves with no button held (a pointerup lost off-window)', () => {
    const { store, fixture } = setup();
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();

    pointerDown(box(fixture, id), { clientX: 0, clientY: 0 });
    pointerMove({ clientX: 20, clientY: 0 });
    // The release happened outside the window: the next hover move arrives with buttons=0 and must
    // kill the gesture instead of rubber-banding the element around until the next click.
    pointerMove({ clientX: 200, clientY: 0, buttons: 0 });
    pointerUp({ clientX: 200, clientY: 0 });

    expect(store.document().elements[0].position).toEqual({ x: 0, y: 0 });
  });

  it('ignores a pointerdown while a gesture is live, instead of overwriting it', () => {
    const { store, fixture } = setup();
    const a = store.addElement({ x: 0, y: 0 });
    const b = store.addElement({ x: 300, y: 0 });
    store.select(a);
    fixture.detectChanges();

    pointerDown(box(fixture, a), { clientX: 0, clientY: 0, pointerId: 1 });
    pointerMove({ clientX: 10, clientY: 0, pointerId: 1 });
    pointerDown(box(fixture, b), { clientX: 300, clientY: 0, pointerId: 7 }); // second finger: ignored
    pointerMove({ clientX: 50, clientY: 0, pointerId: 1 });
    pointerUp({ clientX: 50, clientY: 0, pointerId: 1 });

    // The first gesture ran to completion on element a; b was neither selected nor moved.
    expect(store.document().elements.find((e) => e.id === a)?.position).toEqual({ x: 50, y: 0 });
    expect(store.document().elements.find((e) => e.id === b)?.position).toEqual({ x: 300, y: 0 });
    expect(store.selectedIds()).toEqual([a]);
  });

  it('pans the camera on a middle-button drag over an element box, committing nothing', () => {
    const { store, fixture } = setup();
    const cam = TestBed.inject(BoardCamera);
    const id = store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();
    const before = cam.camera().offset;
    const undoBefore = store.canUndo();

    box(fixture, id).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, clientX: 0, clientY: 0 }),
    );
    pointerMove({ clientX: 30, clientY: 20, buttons: 4 });
    pointerUp({ clientX: 30, clientY: 20 });

    // The grid's middle-drag pan no longer dies over an element box…
    expect(cam.camera().offset).toEqual({ x: before.x + 30, y: before.y + 20 });
    // …and the element itself never moved; nothing was committed.
    expect(store.document().elements[0].position).toEqual({ x: 0, y: 0 });
    expect(store.canUndo()).toBe(undoBefore);
  });
});

describe('BoardElements keyboard', () => {
  let store: BoardStore;
  let fixture: ComponentFixture<BoardElementsComponent>;

  beforeEach(async () => {
    await configure();
    ({ store, fixture } = setup());
  });

  it('deletes the selection on Delete/Backspace', () => {
    const id = store.addElement({ x: 0, y: 0 });
    press('Delete');
    expect(store.document().elements.find((e) => e.id === id)).toBeUndefined();
  });

  it('suppresses Delete/Backspace while a non-canvas control is focused', () => {
    const id = store.addElement({ x: 0, y: 0 });
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    // Backspace right after clicking a palette/Inspector button must not delete the selection behind
    // the focused control — the same isInteractiveTarget guard the map canvas carries.
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    const survived = store.document().elements.find((e) => e.id === id) !== undefined;
    button.remove();
    expect(survived).toBe(true);
  });

  it('arms Tools from their letter, and undoes on mod+Z', () => {
    press('b');
    expect(store.tool()).toBe('box');
    press('v');
    expect(store.tool()).toBe('select');

    store.addElement({ x: 0, y: 0 });
    press('z', { ctrlKey: true }); // mod resolves to Ctrl (IS_MAC_PLATFORM pinned false)
    expect(store.document().elements).toEqual([]);
  });

  it('redoes on mod+Shift+Z and on Ctrl+Y (the Windows/Linux convention)', () => {
    const id = store.addElement({ x: 0, y: 0 });
    press('z', { ctrlKey: true });
    expect(store.document().elements).toEqual([]);

    press('z', { ctrlKey: true, shiftKey: true });
    expect(store.document().elements[0]?.id).toBe(id);

    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    expect(store.document().elements[0]?.id).toBe(id);
  });

  it('ignores Alt/Ctrl/Cmd+letter chords — a modifier chord must not re-arm a Tool', () => {
    store.armTool('box');
    press('v', { altKey: true });
    press('v', { ctrlKey: true });
    press('v', { metaKey: true });
    expect(store.tool()).toBe('box');
  });

  describe('Escape unwinds one layer of mode per press', () => {
    it('disarms an armed element first, keeping the selection', () => {
      const id = store.addElement({ x: 0, y: 0 });
      store.arm(id);

      press('Escape');

      expect(store.armed()).toBeNull();
      expect(store.selectedIds()).toEqual([id]);
    });

    it('then re-arms Select from a placement Tool, then deselects — in that order', () => {
      const id = store.addElement({ x: 0, y: 0 });
      store.arm(id);
      store.armTool('box');

      press('Escape'); // (2) disarm only
      expect(store.armed()).toBeNull();
      expect(store.tool()).toBe('box');
      expect(store.selectedIds()).toEqual([id]);

      press('Escape'); // (3) abandon the armed placement Tool
      expect(store.tool()).toBe('select');
      expect(store.selectedIds()).toEqual([id]);

      press('Escape'); // (4) nothing else claimed: clear the selection
      expect(store.selectedIds()).toEqual([]);
    });

    it('disarms from *inside* the armed editor (editable layer), handing focus back to the surface', () => {
      const id = store.addElement({ x: 0, y: 0 });
      store.arm(id);
      fixture.detectChanges();
      // The focused editable must live inside the board's host — the registration claims only its own
      // armed editor (see the foreign-field spec below).
      const input = document.createElement('input');
      box(fixture, id).appendChild(input);
      input.focus();

      // The old window handler bailed on editable targets, so Escape did nothing and authors were
      // mouse-trapped in edit mode. The editable-layer registration disarms and blurs.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      const stillFocused = document.activeElement === input;
      input.remove();
      expect(store.armed()).toBeNull();
      expect(store.selectedIds()).toEqual([id]);
      expect(stillFocused).toBe(false);
    });

    it('falls through from a foreign text field while armed — armed stays, the field keeps its Escape', () => {
      const id = store.addElement({ x: 0, y: 0 });
      store.arm(id);
      // A field *outside* the board's host (a dialog input, the command palette's search): the armed
      // board used to disarm, blur it, and preventDefault the native <dialog> cancel — palette stuck open.
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(event);

      const stillFocused = document.activeElement === input;
      input.remove();
      expect(event.defaultPrevented).toBe(false);
      expect(store.armed()).toBe(id);
      expect(stillFocused).toBe(true);
    });

    it('falls through from an editable target when nothing is armed (a dialog input keeps its Escape)', () => {
      store.addElement({ x: 0, y: 0 });
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(event);

      input.remove();
      expect(event.defaultPrevented).toBe(false);
      expect(store.selectedIds()).not.toEqual([]); // the surface-layer deselect never ran
    });
  });

  describe('arrow-key nudge', () => {
    it('nudges the selection by 1 world px, 10 with Shift — one undo step per press', () => {
      const id = store.addElement({ x: 0, y: 0 });
      store.select(id);

      press('ArrowRight');
      expect(store.document().elements[0].position).toEqual({ x: 1, y: 0 });

      press('ArrowDown', { shiftKey: true });
      expect(store.document().elements[0].position).toEqual({ x: 1, y: 10 });

      store.undo(); // each press is its own step (a held key is not coalesced)
      expect(store.document().elements[0].position).toEqual({ x: 1, y: 0 });
    });

    it('moves a multi-selection together', () => {
      const a = store.addElement({ x: 0, y: 0 });
      const b = store.addElement({ x: 50, y: 0 });
      store.selectMany([a, b]);

      press('ArrowLeft');

      const byId = new Map(store.document().elements.map((e) => [e.id, e]));
      expect(byId.get(a)?.position).toEqual({ x: -1, y: 0 });
      expect(byId.get(b)?.position).toEqual({ x: 49, y: 0 });
    });

    it('leaves arrows alone when nothing is selected — the board must not eat them', () => {
      store.addElement({ x: 0, y: 0 });
      store.deselect();

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(store.document().elements[0].position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('mutating shortcuts are gated while a gesture is in flight', () => {
    /** Start a live move gesture on the (selected) element `id`. */
    function startMove(id: string): void {
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector(`[data-testid=element-${id}]`) as HTMLElement;
      pointerDown(el, { clientX: 0, clientY: 0 });
      pointerMove({ clientX: 20, clientY: 0 });
    }

    it('undo mid-gesture is ignored — the pending commit would replay a pre-undo origin', () => {
      const id = store.addElement({ x: 0, y: 0 });
      startMove(id);

      press('z', { ctrlKey: true });

      // The only edit (the add) was not undone under the drag.
      expect(store.document().elements.find((e) => e.id === id)).toBeDefined();
      pointerUp({ clientX: 20, clientY: 0 });
    });

    it('delete, tool hotkeys, and nudge are ignored mid-gesture', () => {
      const id = store.addElement({ x: 0, y: 0 });
      startMove(id);

      press('Delete');
      press('b');
      press('ArrowRight');

      expect(store.document().elements.find((e) => e.id === id)).toBeDefined();
      expect(store.tool()).toBe('select');
      pointerUp({ clientX: 20, clientY: 0 });
      // Only the drag itself landed: 20 screen px at zoom 1.
      expect(store.document().elements[0].position).toEqual({ x: 20, y: 0 });
    });
  });

  it('suppresses every surface shortcut while a modal shortcut scope is held (ADR-0063)', () => {
    const id = store.addElement({ x: 0, y: 0 });

    // Backspace behind a modal picker used to delete the selection under it, and Escape cleared the
    // selection while closing the dialog.
    const pop = TestBed.inject(ShortcutService).pushModalScope();
    press('Backspace');
    press('Escape');
    pop();

    expect(store.document().elements.find((e) => e.id === id)).toBeDefined();
    expect(store.selectedIds()).toEqual([id]);
  });

  it('suppresses Delete/Backspace and tool hotkeys while a text field is focused', () => {
    const id = store.addElement({ x: 0, y: 0 });
    store.armTool('box');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));

    const survived = store.document().elements.find((e) => e.id === id) !== undefined;
    const tool = store.tool();
    input.remove();
    expect(survived).toBe(true);
    expect(tool).toBe('box');
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

  describe('with a locked aspect ratio', () => {
    // A 2:1 origin (100×50), so the derived dimension is easy to read off.
    const ratioOrigin = { position: { x: 10, y: 20 }, size: { width: 100, height: 50 } };

    it('derives the height from the width on a corner drag, holding the ratio', () => {
      const { position, size } = resizeGeometry(ratioOrigin, 'se', 100, 0, 2);
      // Width follows the pointer (200); height derives to keep 2:1; top-left stays anchored.
      expect(size).toEqual({ width: 200, height: 100 });
      expect(position).toEqual({ x: 10, y: 20 });
    });

    it('derives the width from the height on a vertical edge, re-anchoring the moved edge', () => {
      const { position, size } = resizeGeometry(ratioOrigin, 'n', 0, -50, 2);
      // Dragging the north edge up by 50 makes height 100; width derives to 200 to hold 2:1.
      expect(size).toEqual({ width: 200, height: 100 });
      // The north edge re-anchors against the corrected height (bottom=70 stays put); x is unchanged.
      expect(position).toEqual({ x: 10, y: -30 });
    });

    it('keeps both dimensions on the ratio when one would breach the floor', () => {
      const { size } = resizeGeometry(ratioOrigin, 'se', -95, 0, 2);
      // Collapsing the width would drive the derived height (10) below the 20px floor; the height pins at
      // 20 and the width re-derives to 40 — the smallest box still on the 2:1 ratio.
      expect(size).toEqual({ width: 40, height: 20 });
    });
  });
});
