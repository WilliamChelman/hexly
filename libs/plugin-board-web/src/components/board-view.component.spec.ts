import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { FakeEntitySession, provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardViewComponent } from './board-view.component';

/**
 * Smoke coverage for the View shell: the editing chrome (tool palette, Inspector, element overlay) is
 * gated on {@link ENTITY_SESSION.writable}, and the canvas grid renders either way (ADR-0037).
 */
describe('BoardView', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardViewComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: provideBoardStoreTesting(),
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(BoardViewComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the palette, Inspector, and element overlay for a writable opener', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('app-board-canvas')).not.toBeNull();
    expect(el.querySelector('app-board-tool-palette')).not.toBeNull();
    expect(el.querySelector('app-board-inspector')).not.toBeNull();
    expect(el.querySelector('app-board-elements')).not.toBeNull();
  });

  it('hides the editing chrome for a read-only opener, keeping the canvas grid', () => {
    TestBed.inject(FakeEntitySession).setWritable(false);
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('app-board-canvas')).not.toBeNull();
    expect(el.querySelector('app-board-tool-palette')).toBeNull();
    expect(el.querySelector('app-board-inspector')).toBeNull();
    expect(el.querySelector('app-board-elements')).toBeNull();
  });
});
