import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '../i18n/test-catalogs';
import { SLASH_ITEMS, SlashItem } from '../models/slash-menu-items';
import { SlashMenuComponent } from './slash-menu.component';

describe('SlashMenu', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SlashMenuComponent, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
    }).compileComponents();
  });

  // The menu teleports to <body>, and these specs don't tear their fixtures down; clear any leftover so a
  // popup from one test can't leak into the next test's document-level query.
  afterEach(() => document.body.querySelectorAll('[data-testid=slash-menu]').forEach((n) => n.remove()));

  /** A caret in the upper half of the window, so the menu hangs below it. */
  const caret = { left: 100, top: 180, bottom: 200 } as DOMRect;

  function open(items: SlashItem[] = SLASH_ITEMS, rect: DOMRect = caret) {
    const fixture = TestBed.createComponent(SlashMenuComponent);
    const menu = fixture.componentInstance;
    const command = vi.fn();
    menu.open({
      items,
      command,
      clientRect: () => rect,
    });
    fixture.detectChanges();
    return { fixture, menu, command };
  }

  // The menu is teleported to <body> (BodyPortalDirective) so it escapes any `transform` ancestor (the
  // Board's zoomed Text Block); it lives on the document, not under the fixture root.
  const menuEl = () => document.body.querySelector('[data-testid=slash-menu]');

  it('renders an option per item with its localized label', () => {
    open([SLASH_ITEMS.find((i) => i.id === 'heading1')!, SLASH_ITEMS.find((i) => i.id === 'bulletList')!]);

    const text = menuEl()?.textContent ?? '';
    expect(text).toContain('Heading 1');
    expect(text).toContain('Bullet list');
  });

  it('renders nothing until opened', () => {
    const fixture = TestBed.createComponent(SlashMenuComponent);
    fixture.detectChanges();

    expect(menuEl()).toBeNull();
  });

  it('moves the active option with ArrowDown and selects it on Enter', () => {
    const { fixture, menu, command } = open();

    const handled = menu.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(handled).toBe(true);

    expect(menu.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
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
    expect(menuEl()).toBeNull();
  });

  it('selects an option when it is clicked', () => {
    const { command } = open();

    (menuEl()!.querySelector('[data-testid=slash-item-blockquote]') as HTMLElement).click();

    expect(command).toHaveBeenCalledWith(SLASH_ITEMS.find((i) => i.id === 'blockquote'));
  });

  it('ignores keys it does not handle, leaving them for the editor', () => {
    const { menu } = open();

    expect(menu.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });

  it('keeps the current items on a loading update, so an async query never blanks', () => {
    const { fixture, menu } = open([SLASH_ITEMS.find((i) => i.id === 'heading1')!]);

    menu.update({
      items: [],
      command: vi.fn(),
      clientRect: () => caret,
      loading: true,
    });
    fixture.detectChanges();

    expect(menuEl()?.textContent ?? '').toContain('Heading 1');
  });

  it('hangs below the caret, capped so a long list scrolls rather than running past the fold', () => {
    open();

    const style = (menuEl() as HTMLElement).style;
    expect(style.top).toBe('200px');
    expect(style.bottom).toBe('');
    expect(parseInt(style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 200);
  });

  it('flips above a caret near the bottom of the window instead of bleeding off-screen', () => {
    const top = window.innerHeight - 20;
    open(SLASH_ITEMS, { left: 100, top, bottom: window.innerHeight } as DOMRect);

    const style = (menuEl() as HTMLElement).style;
    expect(style.top).toBe('');
    expect(style.bottom).toBe(`${window.innerHeight - top}px`);
  });
});
