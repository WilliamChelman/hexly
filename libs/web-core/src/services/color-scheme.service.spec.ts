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
    value: (query: string) => ({ matches: scheme === 'dark', media: query }) as MediaQueryList,
  });
}

describe('ColorSchemeService (ADR-0075, ADR-0077)', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    localStorage.clear();
    delete document.documentElement.dataset['colorScheme'];
  });

  it('follows the OS preference when the reader has expressed no choice', () => {
    osPrefers('dark');

    expect(detectColorScheme()).toBe('dark');
    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('dark');
  });

  it('reflects the ColorScheme onto the root element, which every token declaration keys off', () => {
    const service = TestBed.inject(ColorSchemeService);

    service.set('dark');

    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
  });

  it('toggles between light and dark', () => {
    const service = TestBed.inject(ColorSchemeService);
    service.set('light');

    service.toggle();
    expect(service.colorScheme()).toBe('dark');

    service.toggle();
    expect(service.colorScheme()).toBe('light');
  });

  it('round-trips the choice through storage, so a reload paints it back over the OS preference', () => {
    osPrefers('dark');
    TestBed.inject(ColorSchemeService).set('light');

    // The key is pinned: the pre-paint bootstrap in `index.html` reads it by hand.
    expect(localStorage.getItem('hexly-color-scheme')).toBe('light');

    TestBed.resetTestingModule(); // a fresh service is what a reload constructs
    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('light');
  });

  it('ignores a stored value that is not a ColorScheme', () => {
    osPrefers('light');
    localStorage.setItem('hexly-color-scheme', 'midnight');

    expect(TestBed.inject(ColorSchemeService).colorScheme()).toBe('light');
  });

  it('lets a choice stored before ADR-0077 lapse to the OS preference, and rewrites it on the next set', () => {
    // Deliberately no translation branch: `astral` no longer matches, so the reader falls through to
    // what their system says rather than to a guess, and the first toggle re-persists the new spelling.
    osPrefers('dark');
    localStorage.setItem('hexly-color-scheme', 'astral');

    const service = TestBed.inject(ColorSchemeService);
    expect(service.colorScheme()).toBe('dark');

    service.set('light');
    expect(localStorage.getItem('hexly-color-scheme')).toBe('light');
  });
});
