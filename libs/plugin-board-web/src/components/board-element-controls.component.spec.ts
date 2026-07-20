import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail } from '@hexly/domain';
import { EmbedElement, ImageElement, TextElement, SURFACE_FIELD } from '@hexly/plugin-board';
import { emptyContent } from '@hexly/plugin-content';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardStore } from '../services/board-store';
import { BoardElementControlsComponent } from './board-element-controls.component';

function imageElement(over: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'img',
    kind: 'image',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 180 },
    z: 0,
    assetUrl: '/assets/w1/a.png',
    lockRatio: false,
    ...over,
  };
}

function embedElement(over: Partial<EmbedElement> = {}): EmbedElement {
  return {
    id: 'em',
    kind: 'embed',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 260 },
    z: 0,
    targetEntityId: 'note-2',
    viewInstance: '',
    ...over,
  };
}

function textElement(over: Partial<TextElement> = {}): TextElement {
  return {
    id: 'tx',
    kind: 'text',
    position: { x: 0, y: 0 },
    size: { width: 300, height: 160 },
    z: 0,
    content: emptyContent(),
    ...over,
  };
}

type AnyElement = ImageElement | EmbedElement | TextElement;

/** A board Entity the fake session opens as `current()`, its surface carrying `element` so the store resolves it. */
function boardDetail(element: AnyElement): EntityDetail {
  return {
    id: 'board-1',
    worldId: 'w1',
    name: 'A board',
    types: ['core.board'],
    document: { [SURFACE_FIELD.id]: { elements: [element] } },
  } as unknown as EntityDetail;
}

describe('BoardElementControls', () => {
  let fixture: ComponentFixture<BoardElementControlsComponent>;
  let ref: ComponentRef<BoardElementControlsComponent>;
  let session: FakeEntitySession;
  let store: BoardStore;

  function setup(): void {
    TestBed.configureTestingModule({
      imports: [BoardElementControlsComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: [...provideBoardStoreTesting(), provideRouter([])],
    });
    session = TestBed.inject(FakeEntitySession);
    store = TestBed.inject(BoardStore);
    fixture = TestBed.createComponent(BoardElementControlsComponent);
    ref = fixture.componentRef;
  }

  // The menus live in a CDK overlay attached to the body; tear it down so one test's panel never bleeds
  // into the next.
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove()));

  function render(element: AnyElement): void {
    session.loadDetail(boardDetail(element));
    ref.setInput('element', element);
    ref.setInput('left', 40);
    ref.setInput('top', 60);
    fixture.detectChanges();
  }

  /** A control in the strip itself (a trigger or direct button). */
  function strip(testid: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  }

  /** A menu row, scoped to the CDK overlay so it never matches the trigger that opened it. */
  function menuItem(testid: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`.cdk-overlay-container [data-testid="${testid}"]`);
  }

  function openMenu(triggerTestid: string): void {
    (strip(triggerTestid) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('anchors the strip to the element box’s screen top-left', () => {
    setup();
    render(imageElement());
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.left).toBe('40px');
    expect(host.style.top).toBe('60px');
  });

  describe('flip near the viewport top', () => {
    it('lifts above the element’s top edge when there is room (no flip)', () => {
      setup();
      render(imageElement()); // top 60 — above the flip threshold, the strip lifts as usual.
      expect((fixture.nativeElement as HTMLElement).classList).not.toContain('is-flipped');
    });

    it('flips below the element’s top edge when the lifted strip would clip out of the overlay', () => {
      setup();
      render(imageElement());
      // Within the strip's own height + margin of the viewport top, the lift would cross the overlay's
      // overflow-hidden edge — the strip drops below the element's top edge instead.
      ref.setInput('top', 10);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).classList).toContain('is-flipped');
    });

    it('tracks the threshold as the element moves — flipping on and back off', () => {
      setup();
      render(imageElement());
      ref.setInput('top', 0);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).classList).toContain('is-flipped');

      ref.setInput('top', 120);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).classList).not.toContain('is-flipped');
    });
  });

  describe('for an Image', () => {
    it('shows the fit, ratio-lock, and stacking-order controls, not the Embed resize menu', () => {
      setup();
      render(imageElement());
      expect(strip('control-fit-image')).not.toBeNull();
      expect(strip('control-lock-ratio')).not.toBeNull();
      expect(strip('control-order')).not.toBeNull();
      expect(strip('control-resize')).toBeNull();
      expect(strip('control-open-target')).toBeNull();
    });

    it('reflects the lock-off state and flips it through the store on click', () => {
      setup();
      render(imageElement({ lockRatio: false }));
      const lock = strip('control-lock-ratio') as HTMLButtonElement;
      expect(lock.getAttribute('aria-pressed')).toBe('false');

      lock.click();
      expect((store.document().elements[0] as ImageElement).lockRatio).toBe(true);
    });

    it('reflects an already-locked Image as pressed', () => {
      setup();
      render(imageElement({ lockRatio: true }));
      expect(strip('control-lock-ratio')?.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('for an Embed', () => {
    it('shows the open-target link, the resize menu, and the stacking-order menu, not the Image controls', () => {
      setup();
      render(embedElement());
      expect(strip('control-open-target')).not.toBeNull();
      expect(strip('control-resize')).not.toBeNull();
      expect(strip('control-order')).not.toBeNull();
      expect(strip('control-fit-image')).toBeNull();
      expect(strip('control-lock-ratio')).toBeNull();
    });

    it('resolves the open-target link to the target Entity’s route (a real anchor for ctrl-click)', () => {
      setup();
      render(embedElement());
      const href = strip('control-open-target')?.getAttribute('href');
      expect(href).toContain('w1');
      expect(href).toContain('note-2');
    });

    it('opens a resize menu offering per-axis and full fits', () => {
      setup();
      render(embedElement());
      openMenu('control-resize');
      expect(menuItem('control-fit-width')).not.toBeNull();
      expect(menuItem('control-fit-height')).not.toBeNull();
      expect(menuItem('control-fit-both')).not.toBeNull();
    });
  });

  describe('for a Text Block', () => {
    it('shows the resize and stacking-order menus, not the Image/Embed-specific controls', () => {
      setup();
      render(textElement());
      expect(strip('control-resize')).not.toBeNull();
      expect(strip('control-order')).not.toBeNull();
      expect(strip('control-open-target')).toBeNull();
      expect(strip('control-fit-image')).toBeNull();
      expect(strip('control-lock-ratio')).toBeNull();
    });

    it('opens the same resize menu as an Embed', () => {
      setup();
      render(textElement());
      openMenu('control-resize');
      expect(menuItem('control-fit-height')).not.toBeNull();
      expect(menuItem('control-fit-both')).not.toBeNull();
    });
  });

  describe('menu triggers', () => {
    it('carry a chevron affordance marking them as drop-downs', () => {
      setup();
      render(embedElement());
      expect(strip('control-resize')?.querySelector('.caret')).not.toBeNull();
      expect(strip('control-order')?.querySelector('.caret')).not.toBeNull();
    });
  });

  describe('stacking-order menu', () => {
    it('offers the four z-order moves and dispatches them to the store', () => {
      setup();
      render(embedElement());
      const toFront = vi.spyOn(store, 'toFront');

      openMenu('control-order');
      expect(menuItem('control-z-forward')).not.toBeNull();
      expect(menuItem('control-z-backward')).not.toBeNull();
      expect(menuItem('control-z-to-back')).not.toBeNull();

      menuItem('control-z-to-front')!.click();
      expect(toFront).toHaveBeenCalledWith('em');
    });
  });
});
