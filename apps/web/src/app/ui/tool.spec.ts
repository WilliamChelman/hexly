import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Tool, ToolGlyph } from './tool';

/** A host that drives the attribute-selector primitive from typed inputs. */
@Component({
  imports: [Tool],
  template: `
    <button
      appTool
      [label]="label"
      [swatch]="swatch"
      [glyph]="glyph"
      [active]="active"
      [attr.aria-label]="label"
    ></button>
  `,
})
class Host {
  label = 'Forest';
  swatch: string | undefined;
  glyph: ToolGlyph | undefined;
  active = false;
}

describe('Tool', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));

  function render(setup?: (h: Host) => void): HTMLButtonElement {
    const fixture = TestBed.createComponent(Host);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('renders a leading swatch (not a glyph) for a terrain token', () => {
    const btn = render((h) => (h.swatch = '--terrain-forest'));
    expect(btn.querySelector('[appSwatch]')).not.toBeNull();
    expect(btn.querySelector('[appGlyphBox]')).toBeNull();
    expect(btn.textContent).toContain('Forest');
  });

  it('renders a glyph box (not a swatch) for a glyph with no swatch', () => {
    const btn = render((h) => (h.glyph = 'feature'));
    expect(btn.querySelector('[appGlyphBox]')).not.toBeNull();
    expect(btn.querySelector('[appSwatch]')).toBeNull();
  });

  it('reflects the armed state as is-active and aria-pressed', () => {
    const btn = render((h) => (h.active = true));
    expect(btn.classList.contains('is-active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('forces type=button on the native element', () => {
    const btn = render();
    expect(btn.getAttribute('type')).toBe('button');
  });
});
