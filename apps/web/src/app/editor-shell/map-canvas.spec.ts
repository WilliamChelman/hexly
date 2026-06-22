import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
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
    await TestBed.configureTestingModule({
      imports: [MapCanvas, provideTranslocoTesting()],
    }).compileComponents();
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
    press('l');
    expect(store.tool()).toBe('label');
    press('e');
    expect(store.tool()).toBe('erase');
    press('s');
    expect(store.tool()).toBe('select');
  });

  it('has no key for the departed Region tool', () => {
    store.armTool('terrain');

    press('r'); // Region left the palette (ADR-0012): 'r' arms nothing

    expect(store.tool()).toBe('terrain');
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

  it('deletes the selected entity on Delete and on Backspace', () => {
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null); // a bare Hex is selected

    press('Delete');
    expect('0,0' in store.document().hexes).toBe(false);
    expect(store.selection()).toBeNull();

    // Backspace is the second, equivalent gesture (issue #29).
    store.paintAt({ q: 1, r: 1 }, 'forest');
    store.select({ q: 1, r: 1 }, null);
    press('Backspace');
    expect('1,1' in store.document().hexes).toBe(false);
  });

  it('clears the selection on Escape when nothing is being dragged', () => {
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    expect(store.selection()).not.toBeNull();

    press('Escape');

    expect(store.selection()).toBeNull();
  });

  it('suppresses Delete/Backspace while a text field is focused', () => {
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Backspace in a label/rename field must edit the text, never delete the hex.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
    );

    const survived = '0,0' in store.document().hexes;
    input.remove();
    expect(survived).toBe(true);
  });

  it('suppresses Delete/Backspace while a non-canvas control is focused', () => {
    store.paintAt({ q: 0, r: 0 }, 'forest');
    store.select({ q: 0, r: 0 }, null);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    // Delete right after clicking, say, a tool button must not erase the selection
    // behind the focused control — only the canvas owns the destructive shortcut.
    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );

    const survived = '0,0' in store.document().hexes;
    button.remove();
    expect(survived).toBe(true);
  });

  it('suppresses tool hotkeys while a text field is focused', () => {
    // Arm a non-default Tool first so this proves suppression rather than the
    // cold-start default: a 't' that leaked through would arm Terrain, flipping
    // the value away from 'erase'.
    store.armTool('erase');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    // A "t" typed into a field must not re-arm a tool. Remove before asserting so
    // a failure can't leak the input into later tests.
    const armed = store.tool();
    input.remove();
    expect(armed).toBe('erase');
  });
});

describe('MapCanvas localization', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapCanvas, provideTranslocoTesting()],
    }).compileComponents();
  });

  it('renders the readout and chrome in French when French is the active language', () => {
    const fixture = TestBed.createComponent(MapCanvas);
    fixture.detectChanges();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // With no hovered coordinate the readout reads the "no hex" fallback, and the
    // canvas/zoom chrome carries translated aria-labels.
    expect(el.querySelector('.readout')?.textContent).toContain('Aucun hex');
    expect(el.querySelector('canvas')?.getAttribute('aria-label')).toBe(
      'Carte hexagonale',
    );
    expect(el.querySelector('[aria-label="Zoom avant"]')).not.toBeNull();
  });
});
