import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ToasterService } from '@hexly/web-core';
import { ToasterComponent } from './toaster.component';

describe('Toaster', () => {
  let announce: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    announce = vi.fn();
    TestBed.configureTestingModule({
      imports: [ToasterComponent, provideTranslocoTesting()],
      providers: [{ provide: LiveAnnouncer, useValue: { announce } }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(ToasterComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders nothing when there are no toasts', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('renders one element per toast, showing each message', () => {
    const toaster = TestBed.inject(ToasterService);
    toaster.show('Move blocked', 'error', { durationMs: 0 }); // sticky so no timer races the assert
    toaster.show('Saved', 'success', { durationMs: 0 });

    const fixture = render();
    const toasts = fixture.nativeElement.querySelectorAll('.toast');
    expect(toasts).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Move blocked');
    expect(fixture.nativeElement.textContent).toContain('Saved');
  });

  it('routes a top-placed toast into the top stack and leaves the rest at the bottom', () => {
    const toaster = TestBed.inject(ToasterService);
    toaster.show('2d6 = 7', 'info', { durationMs: 0, placement: 'top' });
    toaster.show('Saved', 'success', { durationMs: 0 });

    const fixture = render();
    const top = fixture.nativeElement.querySelector('.top-5');
    const bottom = fixture.nativeElement.querySelector('.bottom-5');
    expect(top.textContent).toContain('2d6 = 7');
    expect(top.textContent).not.toContain('Saved');
    expect(bottom.textContent).toContain('Saved');
    expect(bottom.textContent).not.toContain('2d6 = 7');
  });

  it('renders a title as an emphasized headline above the message', () => {
    TestBed.inject(ToasterService).show('2d20+3 → 2d20: 14, 17', 'info', { durationMs: 0, title: '34' });

    const fixture = render();
    const toast = fixture.nativeElement.querySelector('.toast');
    expect(toast.textContent).toContain('34');
    expect(toast.textContent).toContain('2d20+3 → 2d20: 14, 17');
    // The total announces first, then the working.
    expect(announce).toHaveBeenCalledWith('34. 2d20+3 → 2d20: 14, 17', 'polite');
  });

  it('marks an error toast with its tone class', () => {
    TestBed.inject(ToasterService).show('Move blocked', 'error', { durationMs: 0 });

    const fixture = render();
    const toast = fixture.nativeElement.querySelector('.toast');
    // The tone shows as the left-border colour utility (error → danger).
    expect(toast.classList.contains('border-l-danger')).toBe(true);
  });

  it('announces an error toast assertively through the CDK live region', () => {
    TestBed.inject(ToasterService).show('Move blocked', 'error', { durationMs: 0 });

    render();

    expect(announce).toHaveBeenCalledWith('Move blocked', 'assertive');
  });

  it('announces a non-error toast politely', () => {
    TestBed.inject(ToasterService).show('Saved', 'success', { durationMs: 0 });

    render();

    expect(announce).toHaveBeenCalledWith('Saved', 'polite');
  });

  it('dismisses a toast when its dismiss control is clicked', () => {
    const toaster = TestBed.inject(ToasterService);
    toaster.show('Move blocked', 'error', { durationMs: 0 });
    const fixture = render();

    fixture.nativeElement.querySelector('[data-testid="toast-dismiss"]').click();
    fixture.detectChanges();

    expect(toaster.toasts()).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.toast')).toHaveLength(0);
  });
});
