import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageElement } from '@hexly/plugin-board';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { BoardImageComponent } from './board-image.component';

/** A minimal Image element pointing at `assetUrl`. */
function imageElement(assetUrl: string): ImageElement {
  return { id: 'img', kind: 'image', position: { x: 0, y: 0 }, size: { width: 240, height: 180 }, z: 0, assetUrl };
}

describe('BoardImage', () => {
  let fixture: ComponentFixture<BoardImageComponent>;
  let ref: ComponentRef<BoardImageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardImageComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardImageComponent);
    ref = fixture.componentRef;
  });

  function render(assetUrl: string): void {
    ref.setInput('element', imageElement(assetUrl));
    fixture.detectChanges();
  }

  const img = () => fixture.nativeElement.querySelector('[data-testid=image-asset]') as HTMLImageElement | null;
  const placeholder = () => fixture.nativeElement.querySelector('[data-testid=image-placeholder]');

  it('renders the Asset at the element’s URL', () => {
    render('/assets/w1/aaa.png');
    expect(img()).not.toBeNull();
    // Angular resolves the bound src against the base href, so assert the pathname it kept.
    expect(new URL(img()!.src).pathname).toBe('/assets/w1/aaa.png');
    expect(placeholder()).toBeNull();
  });

  it('shows a graceful placeholder when the element has no Asset set', () => {
    render('');
    expect(img()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('falls back to the placeholder when the Asset fails to load (a missing Asset)', () => {
    render('/assets/w1/gone.png');
    img()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    // The broken image degrades to the placeholder rather than a broken surface.
    expect(placeholder()).not.toBeNull();
    expect(img()).toBeNull();
  });

  it('recovers when re-pointed at a good Asset after a load failure', () => {
    render('/assets/w1/gone.png');
    img()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(placeholder()).not.toBeNull();

    // The broken state is keyed to the failing URL, so a new URL renders as an image again.
    render('/assets/w1/fresh.png');
    expect(img()).not.toBeNull();
    expect(placeholder()).toBeNull();
  });
});
