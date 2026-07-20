import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { ZoomControlComponent } from './zoom-control.component';

function setup(percent = 100) {
  const fixture = TestBed.createComponent(ZoomControlComponent);
  fixture.componentRef.setInput('percent', percent);
  fixture.detectChanges();
  return fixture;
}

describe('Board ZoomControl', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZoomControlComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
    }).compileComponents();
  });

  it('shows the zoom level as a reset-to-100% button, labelled for assistive tech', () => {
    const fixture = setup(140);
    const level = fixture.nativeElement.querySelector('.lvl') as HTMLButtonElement;

    expect(level.tagName).toBe('BUTTON');
    expect(level.textContent?.trim()).toBe('140%');
    // The readout is the way back to exactly 100% now that "fit" frames content instead.
    expect(level.getAttribute('aria-label')).toBe('Reset zoom to 100%');
    expect(level.getAttribute('title')).toBe('Reset zoom to 100%');
  });

  it('emits resetZoom when the level readout is clicked', () => {
    const fixture = setup();
    let resets = 0;
    fixture.componentInstance.resetZoom.subscribe(() => resets++);

    (fixture.nativeElement.querySelector('.lvl') as HTMLButtonElement).click();

    expect(resets).toBe(1);
  });

  it('emits fit from the fit-content button', () => {
    const fixture = setup();
    let fits = 0;
    fixture.componentInstance.fit.subscribe(() => fits++);
    const fit = fixture.nativeElement.querySelector('button[aria-label="Fit content"]') as HTMLButtonElement;

    expect(fit).not.toBeNull();
    fit.click();

    expect(fits).toBe(1);
  });
});
