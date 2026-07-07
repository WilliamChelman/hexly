import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from './transloco-testing';
import { HexlyDatePipe } from './hexly-date.pipe';
import { LocaleService } from './locale.service';

// 3 February 2026 — day/month pair that disambiguates US from EU order.
const TS = Date.UTC(2026, 1, 3, 12);

@Component({
  imports: [HexlyDatePipe],
  template: `<span>{{ ts | hexlyDate }}</span>`,
})
class Host {
  readonly ts = TS;
}

describe('hexlyDate pipe (ADR-0038)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function render(): { text: () => string; locale: LocaleService } {
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()] });
    const locale = TestBed.inject(LocaleService);
    return {
      locale,
      text: () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        return fixture.nativeElement.textContent ?? '';
      },
    };
  }

  it('renders the date under the UI Locale when no Format Locale is chosen', () => {
    const { text, locale } = render();
    expect(text()).toBe(new Date(TS).toLocaleDateString(locale.lang()));
  });

  it('renders under the chosen Format Locale — applied at render time (pure pipe)', () => {
    const { text, locale } = render();
    // The pipe is pure: it formats what renders after the choice, which is how
    // every real surface sees it (the choice happens on /settings, the dates
    // render after navigating back).
    locale.setFormatLocale('en-GB');
    expect(text()).toBe(new Date(TS).toLocaleDateString('en-GB'));
  });
});
