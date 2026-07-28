import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ColorScheme, ColorSchemeService, detectColorScheme } from './color-scheme.service';

/**
 * Pin the OS preference so a spec never depends on the runner's own setting.
 * Defined rather than spied: the test DOM has no `matchMedia` at all, which is
 * why the service guards its call with `?.`.
 */
function osPrefers(scheme: ColorScheme): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: scheme === 'astral', media: query }) as MediaQueryList,
  });
}

describe('ColorSchemeService (ADR-0075)', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    localStorage.clear();
    delete document.documentElement.dataset['colorScheme'];
  });

  it('follows the OS preference when the reader has expressed no choice', () => {
    osPrefers('astral');

    expect(detectColorScheme()).toBe('astral');
    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('astral');
  });

  it('reflects the ColorScheme onto the root element, which every token declaration keys off', () => {
    const service = TestBed.inject(ColorSchemeService);

    service.set('astral');

    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('astral');
  });

  it('toggles between solar and astral', () => {
    const service = TestBed.inject(ColorSchemeService);
    service.set('solar');

    service.toggle();
    expect(service.colorScheme()).toBe('astral');

    service.toggle();
    expect(service.colorScheme()).toBe('solar');
  });

  it('round-trips the choice through storage, so a reload paints it back over the OS preference', () => {
    osPrefers('astral');
    TestBed.inject(ColorSchemeService).set('solar');

    // The key is pinned: the pre-paint bootstrap in `index.html` reads it by hand.
    expect(localStorage.getItem('hexly-color-scheme')).toBe('solar');

    TestBed.resetTestingModule(); // a fresh service is what a reload constructs
    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('solar');
  });

  it('ignores a stored value that is not a ColorScheme', () => {
    osPrefers('solar');
    localStorage.setItem('hexly-color-scheme', 'midnight');

    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('solar');
  });
});
