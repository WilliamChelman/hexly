import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { IS_MAC_PLATFORM, isEditableTarget, ShortcutRegistration, ShortcutService } from './shortcut.service';

describe('ShortcutService', () => {
  let service: ShortcutService;

  function setup(isMac = true): void {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_MAC_PLATFORM, useValue: isMac }],
    });
    service = TestBed.inject(ShortcutService);
  }

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
  }

  /** Dispatch from inside a focused-like editable element, bubbling to the window. */
  function pressIn(el: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
    el.dispatchEvent(event);
    return event;
  }

  function register(partial: Partial<ShortcutRegistration> & Pick<ShortcutRegistration, 'keys'>) {
    const handler = vi.fn();
    const unregister = service.register({ layer: 'surface', handler, ...partial });
    return { handler, unregister };
  }

  describe('matching', () => {
    it('dispatches a bare key to its handler and prevents the default', () => {
      setup();
      const { handler } = register({ keys: 'escape' });

      const event = press('Escape');

      expect(handler).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('matches case-insensitively on event.key', () => {
      setup();
      const { handler } = register({ keys: 'v' });

      press('V', { shiftKey: false });

      expect(handler).toHaveBeenCalled();
    });

    it('accepts an array of chords', () => {
      setup();
      const { handler } = register({ keys: ['delete', 'backspace'] });

      press('Delete');
      press('Backspace');

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('leaves an unmatched key alone — no handler, no preventDefault', () => {
      setup();
      const { handler } = register({ keys: 'v' });

      const event = press('x');

      expect(handler).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('requires exact modifiers: a bare letter never fires on Alt/Ctrl/Meta/Shift variants', () => {
      setup();
      const { handler } = register({ keys: 'v' });

      press('v', { altKey: true });
      press('v', { ctrlKey: true });
      press('v', { metaKey: true });
      press('v', { shiftKey: true });

      expect(handler).not.toHaveBeenCalled();
    });

    it('requires every declared modifier to be down', () => {
      setup(false);
      const { handler } = register({ keys: 'ctrl+shift+z' });

      press('z', { ctrlKey: true });
      expect(handler).not.toHaveBeenCalled();

      press('z', { ctrlKey: true, shiftKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rejects a typo’d modifier at registration time', () => {
      setup();
      expect(() => register({ keys: 'cmd+k' })).toThrowError(/cmd/);
    });
  });

  describe('mod normalization', () => {
    it('resolves mod to metaKey on mac — ctrl+key does not match', () => {
      setup(true);
      const { handler } = register({ keys: 'mod+z' });

      press('z', { ctrlKey: true });
      expect(handler).not.toHaveBeenCalled();

      press('z', { metaKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('resolves mod to ctrlKey elsewhere — meta+key does not match', () => {
      setup(false);
      const { handler } = register({ keys: 'mod+z' });

      press('z', { metaKey: true });
      expect(handler).not.toHaveBeenCalled();

      press('z', { ctrlKey: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('layer order and fall-through', () => {
    it('runs surface before global for the same chord', () => {
      setup();
      const order: string[] = [];
      register({ layer: 'global', keys: 'escape', handler: () => void order.push('global') });
      register({ layer: 'surface', keys: 'escape', handler: () => void order.push('surface') });

      press('Escape');

      expect(order).toEqual(['surface']);
    });

    it('stops at the first handler that handles; a false return falls through', () => {
      setup();
      const second = vi.fn();
      register({ layer: 'surface', keys: 'delete', handler: () => false });
      register({ layer: 'global', keys: 'delete', handler: second });

      const event = press('Delete');

      expect(second).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not preventDefault when every candidate declines', () => {
      setup();
      register({ keys: 'delete', handler: () => false });

      const event = press('Delete');

      expect(event.defaultPrevented).toBe(false);
    });

    it('skips a registration whose when() gate is false', () => {
      setup();
      const gated = vi.fn();
      const fallback = vi.fn();
      register({ layer: 'surface', keys: 'v', when: () => false, handler: gated });
      register({ layer: 'global', keys: 'v', handler: fallback });

      press('v');

      expect(gated).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });
  });

  describe('editable targets', () => {
    let input: HTMLInputElement;

    beforeEach(() => {
      input = document.createElement('input');
      document.body.appendChild(input);
    });

    afterEach(() => input.remove());

    it('suppresses surface and global layers while the target is editable', () => {
      setup();
      const surface = register({ layer: 'surface', keys: 'backspace' });
      const global = register({ layer: 'global', keys: 'backspace' });

      const event = pressIn(input, 'Backspace');

      expect(surface.handler).not.toHaveBeenCalled();
      expect(global.handler).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('runs editable-layer registrations in an editable target, and only there', () => {
      setup();
      const { handler } = register({ layer: 'editable', keys: 'escape' });

      press('Escape');
      expect(handler).not.toHaveBeenCalled();

      pressIn(input, 'Escape');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('lets an inEditable registration through the editable gate', () => {
      setup(true);
      const { handler } = register({ layer: 'global', keys: 'mod+k', inEditable: true });

      pressIn(input, 'k', { metaKey: true });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('modal scope', () => {
    it('suppresses every non-modal layer while a scope is held, and restores on pop', () => {
      setup();
      const surface = register({ layer: 'surface', keys: 'backspace' });

      const pop = service.pushModalScope();
      const suppressed = press('Backspace');
      expect(surface.handler).not.toHaveBeenCalled();
      expect(suppressed.defaultPrevented).toBe(false);

      pop();
      press('Backspace');
      expect(surface.handler).toHaveBeenCalledTimes(1);
    });

    it('runs only modal-layer registrations inside the scope', () => {
      setup();
      const modal = register({ layer: 'modal', keys: 'escape' });

      const pop = service.pushModalScope();
      press('Escape');
      pop();

      expect(modal.handler).toHaveBeenCalledTimes(1);
    });

    it('keeps the editable gate inside the scope: a modal chord needs inEditable to fire from a dialog input', () => {
      setup();
      const plain = register({ layer: 'modal', keys: 'escape' });
      const typing = register({ layer: 'modal', keys: 'escape', inEditable: true });
      const input = document.createElement('input');
      document.body.appendChild(input);

      const pop = service.pushModalScope();
      pressIn(input, 'Escape');
      pop();
      input.remove();

      expect(plain.handler).not.toHaveBeenCalled();
      expect(typing.handler).toHaveBeenCalledTimes(1);
    });

    it('counts stacked scopes — the keyboard is released only when the last pops', () => {
      setup();
      const surface = register({ layer: 'surface', keys: 'escape' });
      const popOuter = service.pushModalScope();
      const popInner = service.pushModalScope();

      popInner();
      press('Escape');
      expect(surface.handler).not.toHaveBeenCalled();

      popOuter();
      press('Escape');
      expect(surface.handler).toHaveBeenCalledTimes(1);
    });

    it('ignores a double pop instead of releasing someone else’s scope', () => {
      setup();
      const surface = register({ layer: 'surface', keys: 'escape' });
      const popFirst = service.pushModalScope();
      const popSecond = service.pushModalScope();

      popFirst();
      popFirst();
      press('Escape');
      expect(surface.handler).not.toHaveBeenCalled();

      popSecond();
      press('Escape');
      expect(surface.handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('registration lifecycle', () => {
    it('attaches its window listener lazily, on the first registration', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      setup();
      const attached = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length;

      expect(attached()).toBe(0);
      register({ keys: 'v' });
      expect(attached()).toBe(1);
      register({ keys: 'x' });
      expect(attached()).toBe(1);

      addSpy.mockRestore();
    });

    it('stops dispatching to an unregistered handler', () => {
      setup();
      const { handler, unregister } = register({ keys: 'v' });

      unregister();
      press('v');

      expect(handler).not.toHaveBeenCalled();
    });

    it('detaches the window listener when the last registration leaves', () => {
      setup();
      const { unregister } = register({ keys: 'v' });
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      unregister();

      expect(removeSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
      removeSpy.mockRestore();
    });

    it('auto-unregisters with the DestroyRef of the injection context it was registered in', () => {
      setup();
      const handler = vi.fn();

      @Component({ template: '' })
      class HostComponent {
        constructor() {
          service.register({ layer: 'surface', keys: 'v', handler });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      press('v');
      expect(handler).toHaveBeenCalledTimes(1);

      fixture.destroy();
      press('v');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('isEditableTarget', () => {
  it('recognizes inputs, textareas, and contenteditable hosts', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    // jsdom does not derive isContentEditable from the attribute; force the property.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
  });

  it('rejects null, the window, and ordinary elements', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});
