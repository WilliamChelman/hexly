import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EntityBody, Metadata } from '@hexly/domain';
import { produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DND_TEST_CATALOGS } from '../i18n/test-catalogs';
import { StatBlockView } from './stat-block-view';

/**
 * The plugin's bespoke View (#192). It binds to nothing but the {@link ENTITY_SESSION} contract, so a
 * minimal fake session stands in for the app's.
 */
describe('StatBlockView', () => {
  /** A stand-in for the app's central store: the one body every View reads its slice off. */
  function fakeSession(metadata: Metadata, writable = true): EntitySession {
    const body = signal<EntityBody>({ content: { format: 'tiptap-v1', snapshot: {} }, metadata });
    return {
      body: body.asReadonly(),
      writable: signal(writable).asReadonly(),
      loadGeneration: signal(0).asReadonly(),
      mutate: (recipe) => {
        const [next, redo, undo] = produceWithPatches(body(), recipe);
        body.set(next);
        return { redo, undo };
      },
      applyPatches: () => undefined,
    };
  }

  function render(metadata: Metadata, writable = true) {
    const session = fakeSession(metadata, writable);
    TestBed.configureTestingModule({
      imports: [StatBlockView, provideTranslocoTesting(DND_TEST_CATALOGS)],
      providers: [{ provide: ENTITY_SESSION, useValue: session }, provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StatBlockView);
    fixture.detectChanges();
    return { fixture, session, el: fixture.nativeElement as HTMLElement };
  }

  it('prints the monster as a stat block, not as raw Metadata', () => {
    const { el } = render({
      size: 'Huge',
      creature_type: 'dragon',
      alignment: 'chaotic evil',
      challenge_rating: 24,
      strength: 30,
    });

    // The flavour line is derived from the Fields, not authored as prose.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge dragon, chaotic evil');
    // The derived ability modifier: a raw 30 means +10.
    expect(el.querySelector('[data-testid=stat-mod-strength]')?.textContent).toContain('+10');
    // The plugin ships its own copy under its own scope (ADR-0049): proof the `dnd.*` keys resolve
    // from the plugin's catalog, and not as the raw key a missing scope would print.
    expect(el.textContent).toContain('Switch to the Note view');
  });

  it('edits a stat straight into the one Metadata map every other View reads', () => {
    const { fixture, session, el } = render({ challenge_rating: 5 });

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.value).toBe('5');
    cr.value = '13';
    cr.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A Field is a lens: the stat block writes the same Metadata the Browser facets on (#188).
    expect(session.body().metadata).toMatchObject({ challenge_rating: 13 });
  });

  // The block is the only surface a monster's optional Fields have (the create dialog collects the
  // required ones only), so an unrendered Field would be unsettable anywhere in the app.
  it('offers an editable slot for every Field the type declares, not just the required one', () => {
    const { fixture, session, el } = render({ challenge_rating: 5 });

    const size = el.querySelector('[data-testid=stat-size] select') as HTMLSelectElement;
    expect(Array.from(size.options).map((o) => o.value)).toContain('Huge');
    size.value = 'Huge';
    size.dispatchEvent(new Event('change'));

    const alignment = el.querySelector('[data-testid=stat-alignment] input') as HTMLInputElement;
    alignment.value = 'chaotic evil';
    alignment.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(session.body().metadata).toMatchObject({ size: 'Huge', alignment: 'chaotic evil' });
    // The subtitle is derived, so it re-reads the moment its Fields are edited.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge, chaotic evil');
  });

  it('flags a missing required Field rather than silently accepting an incomplete monster', () => {
    const { el } = render({ size: 'Large' });

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.getAttribute('aria-invalid')).toBe('true');
  });

  it('prints, rather than edits, for a read-only opener', () => {
    const { el } = render({ challenge_rating: 5, dexterity: 8 }, false);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[data-testid=stat-challenge_rating]')?.textContent).toContain('5');
    expect(el.querySelector('[data-testid=stat-mod-dexterity]')?.textContent).toContain('-1');
  });

  it('leaves an unfilled stat blank instead of deriving a bogus modifier (forward-only tolerance)', () => {
    const { el } = render({ challenge_rating: 1 }, false);

    expect(el.querySelector('[data-testid=stat-mod-wisdom]')?.textContent).toContain('—');
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent?.trim()).toBe('');
  });
});
