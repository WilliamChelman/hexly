import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { BOARD_TEST_CATALOGS } from '../i18n/test-catalogs';
import { provideBoardStoreTesting } from '../testing/entity-session.fake';
import { BoardStore } from '../services/board-store';
import { ToolPaletteComponent } from './tool-palette.component';

function setup() {
  const fixture = TestBed.createComponent(ToolPaletteComponent);
  const store = TestBed.inject(BoardStore);
  fixture.detectChanges();
  return { fixture, store };
}

function click(fixture: ReturnType<typeof TestBed.createComponent>, testid: string): void {
  fixture.detectChanges();
  const el = fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLButtonElement | null;
  if (!el) throw new Error(`no element with data-testid="${testid}"`);
  el.click();
  fixture.detectChanges();
}

describe('Board ToolPalette', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolPaletteComponent, provideTranslocoTesting(BOARD_TEST_CATALOGS)],
      providers: provideBoardStoreTesting(),
    }).compileComponents();
  });

  it('offers Select and the minimal Box Tool, with Select armed at cold-start', () => {
    const { fixture, store } = setup();

    const select = fixture.nativeElement.querySelector('[data-testid=tool-select]') as HTMLButtonElement;
    const box = fixture.nativeElement.querySelector('[data-testid=tool-box]') as HTMLButtonElement;
    expect(select).not.toBeNull();
    expect(box).not.toBeNull();
    // A Board opens armed with Select, so exactly it reads as active.
    expect(store.tool()).toBe('select');
    expect(select.classList.contains('is-active')).toBe(true);
    expect(box.classList.contains('is-active')).toBe(false);
  });

  it('arms exactly one Tool at a time from the palette', () => {
    const { fixture, store } = setup();

    click(fixture, 'tool-box');
    expect(store.tool()).toBe('box');
    const box = fixture.nativeElement.querySelector('[data-testid=tool-box]') as HTMLButtonElement;
    const select = fixture.nativeElement.querySelector('[data-testid=tool-select]') as HTMLButtonElement;
    expect(box.classList.contains('is-active')).toBe(true);
    expect(select.classList.contains('is-active')).toBe(false);

    click(fixture, 'tool-select');
    expect(store.tool()).toBe('select');
  });

  it('renders Undo and Redo, disabled when there is nothing to undo or redo', () => {
    const { fixture, store } = setup();
    const undo = () => fixture.nativeElement.querySelector('[data-testid=undo]') as HTMLButtonElement;
    const redo = () => fixture.nativeElement.querySelector('[data-testid=redo]') as HTMLButtonElement;

    expect(undo().disabled).toBe(true);
    expect(redo().disabled).toBe(true);

    store.addElement({ x: 0, y: 0 });
    fixture.detectChanges();
    expect(undo().disabled).toBe(false);
    expect(redo().disabled).toBe(true);
  });

  it('drives the store history when Undo and Redo are clicked', () => {
    const { fixture, store } = setup();
    store.addElement({ x: 0, y: 0 });

    click(fixture, 'undo');
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);

    click(fixture, 'redo');
    expect(store.document().elements).toHaveLength(1);
  });

  it('names the Tools in French when French is the active language', () => {
    const { fixture } = setup();
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    const labelOf = (testid: string) =>
      (fixture.nativeElement.querySelector(`[data-testid=${testid}]`) as HTMLElement).getAttribute('aria-label');
    expect(labelOf('tool-select')).toBe('Sélection');
    expect(labelOf('tool-box')).toBe('Boîte');
  });
});
