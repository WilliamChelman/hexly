import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button, ButtonSize, ButtonVariant } from './button';

/** A host that drives the attribute-selector primitive from typed inputs. */
@Component({
  imports: [Button],
  template: `
    <button
      appButton
      [variant]="variant"
      [size]="size"
      [icon]="icon"
      [danger]="danger"
    >
      Label
    </button>
  `,
})
class Host {
  variant: ButtonVariant = 'default';
  size: ButtonSize = 'md';
  icon = false;
  danger = false;
}

describe('Button', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }));

  function render(setup?: (h: Host) => void): HTMLButtonElement {
    const fixture = TestBed.createComponent(Host);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('wears no modifier classes by default', () => {
    const btn = render();
    expect(btn.classList.contains('is-primary')).toBe(false);
    expect(btn.classList.contains('is-ghost')).toBe(false);
    expect(btn.classList.contains('is-sm')).toBe(false);
    expect(btn.classList.contains('is-icon')).toBe(false);
    expect(btn.classList.contains('is-danger')).toBe(false);
  });

  it('maps variant/size/icon/danger inputs onto host classes', () => {
    const btn = render((h) => {
      h.variant = 'primary';
      h.size = 'sm';
      h.icon = true;
      h.danger = true;
    });
    expect(btn.classList.contains('is-primary')).toBe(true);
    expect(btn.classList.contains('is-sm')).toBe(true);
    expect(btn.classList.contains('is-icon')).toBe(true);
    expect(btn.classList.contains('is-danger')).toBe(true);
  });

  it('selects the ghost variant', () => {
    const btn = render((h) => (h.variant = 'ghost'));
    expect(btn.classList.contains('is-ghost')).toBe(true);
    expect(btn.classList.contains('is-primary')).toBe(false);
  });

  it('keeps the host as a real button, projecting its label', () => {
    const btn = render();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent?.trim()).toBe('Label');
  });
});
