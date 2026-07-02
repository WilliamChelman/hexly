import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../../../core/i18n/transloco-testing';
import { SLASH_ITEMS, SlashItem } from './slash-menu-items';
import { SlashMenu } from './slash-menu';

describe('SlashMenu', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SlashMenu, provideTranslocoTesting()],
    }).compileComponents();
  });

  function open(items: SlashItem[] = SLASH_ITEMS) {
    const fixture = TestBed.createComponent(SlashMenu);
    const menu = fixture.componentInstance;
    const command = vi.fn();
    menu.open({ items, command, clientRect: () => ({ left: 100, bottom: 200 } as DOMRect) });
    fixture.detectChanges();
    return { fixture, menu, command };
  }

  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement;

  it('renders an option per item with its localized label', () => {
    const { fixture } = open([
      SLASH_ITEMS.find((i) => i.id === 'heading1')!,
      SLASH_ITEMS.find((i) => i.id === 'bulletList')!,
    ]);

    const text = el(fixture).textContent ?? '';
    expect(text).toContain('Heading 1');
    expect(text).toContain('Bullet list');
  });

  it('renders nothing until opened', () => {
    const fixture = TestBed.createComponent(SlashMenu);
    fixture.detectChanges();

    expect(
      el(fixture).querySelector('[data-testid=slash-menu]'),
    ).toBeNull();
  });

  it('moves the active option with ArrowDown and selects it on Enter', () => {
    const { fixture, menu, command } = open();

    const handled = menu.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(handled).toBe(true);

    expect(menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
    // First item is index 0; ArrowDown moved to index 1 before Enter.
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[1]);
  });

  it('wraps to the last option with ArrowUp from the top', () => {
    const { menu, command } = open();

    menu.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[SLASH_ITEMS.length - 1]);
  });

  it('closes on Escape without selecting', () => {
    const { fixture, menu, command } = open();

    expect(menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    fixture.detectChanges();

    expect(command).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('[data-testid=slash-menu]')).toBeNull();
  });

  it('selects an option when it is clicked', () => {
    const { fixture, command } = open();

    (
      el(fixture).querySelector('[data-testid=slash-item-blockquote]') as HTMLElement
    ).click();

    expect(command).toHaveBeenCalledWith(
      SLASH_ITEMS.find((i) => i.id === 'blockquote'),
    );
  });

  it('ignores keys it does not handle, leaving them for the editor', () => {
    const { menu } = open();

    expect(menu.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });

  it('keeps the current items on a loading update, so an async query never blanks', () => {
    const { fixture, menu } = open([
      SLASH_ITEMS.find((i) => i.id === 'heading1')!,
    ]);

    // tiptap's interim "loading" render carries empty items; the menu must ignore
    // it and keep showing the previous results until the resolved render lands.
    menu.update({
      items: [],
      command: vi.fn(),
      clientRect: () => ({ left: 100, bottom: 200 }) as DOMRect,
      loading: true,
    });
    fixture.detectChanges();

    expect(el(fixture).textContent ?? '').toContain('Heading 1');
  });
});
