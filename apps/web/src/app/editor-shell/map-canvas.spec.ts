import { TestBed } from '@angular/core/testing';
import { EditorStore } from './editor-store';
import { MapCanvas } from './map-canvas';

/**
 * The keyboard contract of the map surface (issue #27): letters arm top-level
 * Tools, `1`–`9` pick the armed Tool's nth Subtool, undo/redo stay on Cmd/Ctrl+Z,
 * and every binding is suppressed while a text field is focused. The handler is a
 * `window:keydown` host listener, so the tests dispatch real keydown events that
 * bubble to the window once the canvas is mounted.
 */
describe('MapCanvas keyboard', () => {
  let store: EditorStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MapCanvas] }).compileComponents();
    const fixture = TestBed.createComponent(MapCanvas);
    fixture.detectChanges();
    store = TestBed.inject(EditorStore);
  });

  /** Dispatch a keydown that bubbles to the window's host listener. */
  function press(key: string, init: KeyboardEventInit = {}): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  }

  it('arms each top-level Tool from its letter', () => {
    press('t');
    expect(store.tool()).toBe('terrain');
    press('f');
    expect(store.tool()).toBe('feature');
    press('r');
    expect(store.tool()).toBe('region');
    press('l');
    expect(store.tool()).toBe('label');
    press('e');
    expect(store.tool()).toBe('erase');
    press('s');
    expect(store.tool()).toBe('select');
  });

  it('picks the nth Subtool of the armed Tool with the number keys', () => {
    store.armTool('terrain');

    press('3'); // the 3rd terrain in the palette is Ocean

    expect(store.terrain()).toBe('ocean');
  });

  it('numbers are relative to the armed Tool, not hardwired to terrain', () => {
    store.armTool('feature');

    press('1'); // the 1st feature, not a terrain

    expect(store.tool()).toBe('feature');
    expect(store.feature()).toBe('settlement');
  });

  it('undoes and redoes with Cmd/Ctrl+Z', () => {
    store.paintAt({ q: 0, r: 0 }, 'forest');

    press('z', { metaKey: true });
    expect('0,0' in store.document().hexes).toBe(false);

    press('z', { metaKey: true, shiftKey: true });
    expect(store.document().hexes['0,0']).toEqual({ terrain: 'forest' });
  });

  it('suppresses tool hotkeys while a text field is focused', () => {
    // Arm a non-default Tool first so this proves suppression rather than the
    // cold-start default: a 't' that leaked through would arm Terrain, flipping
    // the value away from 'region'.
    store.armTool('region');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    // A "t" typed into a field must not re-arm a tool. Remove before asserting so
    // a failure can't leak the input into later tests.
    const armed = store.tool();
    input.remove();
    expect(armed).toBe('region');
  });
});
