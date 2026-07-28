import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipComponent, ChipTone } from './chip.component';
import { IconName } from '../icon/icon-registry';
import { CATEGORICAL_TONES } from '../utils/tone';

/** A host that drives the chip from typed inputs, the way a call site binds them. */
@Component({
  imports: [ChipComponent],
  template: `<app-chip [tone]="tone" [icon]="icon">Label</app-chip>`,
})
class Host {
  tone: ChipTone | undefined = undefined;
  icon: IconName | null = null;
}

describe('Chip', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));

  function render(setup?: (h: Host) => void): HTMLElement {
    const fixture = TestBed.createComponent(Host);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('app-chip') as HTMLElement;
  }

  /**
   * The load-bearing one: the eight tones sit on the deuteranope confusion arc, so the glyph is the
   * identity channel and the colour decoration (ADR-0075, #368). The icon is the chip's own input —
   * not a projection each caller must remember — so this holds for every toned chip in the app.
   */
  it.each(CATEGORICAL_TONES)('carries a glyph alongside its tone (%s)', (tone) => {
    const chip = render((h) => {
      h.tone = tone;
      h.icon = 'region';
    });

    expect(chip.classList.contains(`is-${tone}`)).toBe(true);
    expect(chip.querySelector('app-icon svg')).not.toBeNull();
  });

  it('draws the accent chip its glyph too', () => {
    const chip = render((h) => {
      h.tone = 'accent';
      h.icon = 'terrain';
    });

    expect(chip.classList.contains('is-accent')).toBe(true);
    expect(chip.querySelector('app-icon svg')).not.toBeNull();
  });

  it('renders no glyph for the explicitly icon-less chip', () => {
    const chip = render();

    expect(chip.querySelector('app-icon')).toBeNull();
    expect(chip.className).toBe('');
  });
});
