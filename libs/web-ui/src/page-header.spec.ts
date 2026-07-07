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

  @Component({
    imports: [PageHeader],
    template: `<app-page-header><span pageHeaderTitle>title</span></app-page-header>`,
  })
  class TitleOnlyHost {}

  @Component({
    imports: [PageHeader],
    template: `<app-page-header sticky><span pageHeaderTitle>title</span></app-page-header>`,
  })
  class StickyHost {}

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

  it('declares the banner landmark so assistive tech can jump to the header', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('app-page-header').getAttribute('role'),
    ).toBe('banner');
  });

  it('reserves no leading gap when a page projects no leading content', () => {
    const fixture = TestBed.createComponent(TitleOnlyHost);
    fixture.detectChanges();

    // :empty drives `empty:hidden`, so the unused slot collapses out of the flow.
    expect(slot(fixture.nativeElement, 'leading').matches(':empty')).toBe(true);
  });

  it('pins itself to the top only when sticky is set', () => {
    const plain = TestBed.createComponent(Host);
    plain.detectChanges();
    expect(
      plain.nativeElement.querySelector('app-page-header').classList,
    ).not.toContain('sticky');

    const sticky = TestBed.createComponent(StickyHost);
    sticky.detectChanges();
    expect(
      sticky.nativeElement.querySelector('app-page-header').classList,
    ).toContain('sticky');
  });
});
