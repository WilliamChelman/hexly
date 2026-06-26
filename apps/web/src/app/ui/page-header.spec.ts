import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageHeader } from './page-header';

/**
 * The reuse contract every page-owned header depends on (ADR-0022): content
 * tagged for a slot lands in that slot. Plain pages and the rich editor share
 * this one frame, so the projection is the seam worth pinning down here — the
 * rest (rail, navigation, per-page content) is asserted end-to-end.
 */
describe('PageHeader', () => {
  @Component({
    imports: [PageHeader],
    template: `
      <app-page-header>
        <span pageHeaderLeading data-testid="L">lead</span>
        <span pageHeaderTitle data-testid="T">title</span>
        <span pageHeaderActions data-testid="A">act</span>
      </app-page-header>
    `,
  })
  class Host {}

  function slot(host: HTMLElement, name: string): HTMLElement {
    return host.querySelector<HTMLElement>(`[data-testid="slot-${name}"]`)!;
  }

  it('projects leading / title / actions content into their own slots', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(slot(el, 'leading').querySelector('[data-testid="L"]')).not.toBeNull();
    expect(slot(el, 'title').querySelector('[data-testid="T"]')).not.toBeNull();
    expect(slot(el, 'actions').querySelector('[data-testid="A"]')).not.toBeNull();

    // Each slot holds only its own content — no cross-projection.
    expect(slot(el, 'title').querySelector('[data-testid="L"]')).toBeNull();
    expect(slot(el, 'actions').querySelector('[data-testid="T"]')).toBeNull();
  });
});
