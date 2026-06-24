import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { ToasterService } from '../core/toaster.service';
import { Toaster } from './toaster';

describe('Toaster', () => {
  let announce: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    announce = vi.fn();
    TestBed.configureTestingModule({
      imports: [Toaster, provideTranslocoTesting()],
      providers: [{ provide: LiveAnnouncer, useValue: { announce } }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(Toaster);
    fixture.detectChanges();
    return fixture;
  }

  it('renders nothing when there are no toasts', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('renders one element per toast, showing each message', () => {
    const toaster = TestBed.inject(ToasterService);
    toaster.show('Move blocked', 'error', 0); // sticky so no timer races the assert
    toaster.show('Saved', 'success', 0);

    const fixture = render();
    const toasts = fixture.nativeElement.querySelectorAll('.toast');
    expect(toasts).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Move blocked');
    expect(fixture.nativeElement.textContent).toContain('Saved');
  });

  it('marks an error toast with its tone class', () => {
    TestBed.inject(ToasterService).show('Move blocked', 'error', 0);

    const fixture = render();
    const toast = fixture.nativeElement.querySelector('.toast');
    // The tone shows as the left-border colour utility (error → ember).
    expect(toast.classList.contains('border-l-ember')).toBe(true);
  });

  it('announces an error toast assertively through the CDK live region', () => {
    TestBed.inject(ToasterService).show('Move blocked', 'error', 0);

    render();

    expect(announce).toHaveBeenCalledWith('Move blocked', 'assertive');
  });

  it('announces a non-error toast politely', () => {
    TestBed.inject(ToasterService).show('Saved', 'success', 0);

    render();

    expect(announce).toHaveBeenCalledWith('Saved', 'polite');
  });

  it('dismisses a toast when its dismiss control is clicked', () => {
    const toaster = TestBed.inject(ToasterService);
    toaster.show('Move blocked', 'error', 0);
    const fixture = render();

    fixture.nativeElement
      .querySelector('[data-testid="toast-dismiss"]')
      .click();
    fixture.detectChanges();

    expect(toaster.toasts()).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.toast')).toHaveLength(0);
  });
});
