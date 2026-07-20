import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EntityDocument } from '@hexly/domain';
import { produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DND_STAT_BLOCK_KEY } from '@hexly/plugin-dnd';
import { DND_TEST_CATALOGS } from '../i18n/test-catalogs';
import { StatBlockViewComponent } from './stat-block-view.component';

/**
 * The `dnd.datatype.stat-block` data-type's View (#192, ADR-0055). It binds to the {@link ENTITY_SESSION} contract
 * plus {@link VIEW_FIELD_KEY} — the one document key its whole block lives at — so a minimal fake session
 * and a fixed key stand in for the app's.
 */
describe('StatBlockView', () => {
  /** A stand-in for the app's central store: the one Entity Document every View reads its slice off. */
  function fakeSession(block: Record<string, unknown>, writable = true): EntitySession {
    // The block is one grouped value at the stat-block key, beside the prose every Entity carries.
    const doc = signal<EntityDocument>({
      content: { format: 'tiptap-v1', snapshot: {} },
      [DND_STAT_BLOCK_KEY]: block,
    });
    return {
      current: signal(null).asReadonly(),
      doc: doc.asReadonly(),
      writable: signal(writable).asReadonly(),
      loadGeneration: signal(0).asReadonly(),
      mutate: (recipe) => {
        const [next, redo, undo] = produceWithPatches(doc(), recipe);
        doc.set(next);
        return { redo, undo };
      },
      applyPatches: () => undefined,
      registerEditor: () => () => undefined,
    };
  }

  /** Render the View over a stat block seeded at {@link DND_STAT_BLOCK_KEY} — the key the page injects. */
  function render(block: Record<string, unknown>, writable = true) {
    const session = fakeSession(block, writable);
    TestBed.configureTestingModule({
      imports: [StatBlockViewComponent, provideTranslocoTesting(DND_TEST_CATALOGS)],
      providers: [
        { provide: ENTITY_SESSION, useValue: session },
        { provide: VIEW_FIELD_KEY, useValue: DND_STAT_BLOCK_KEY },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(StatBlockViewComponent);
    fixture.detectChanges();
    return { fixture, session, el: fixture.nativeElement as HTMLElement };
  }

  /** The stat block as it sits inside the document — the value at the injected key. */
  const statBlock = (session: EntitySession) => session.doc()[DND_STAT_BLOCK_KEY];

  it('prints the block from one grouped value, not from raw top-level EntityDocument', () => {
    const { el } = render({
      size: 'Huge',
      creature_type: 'dragon',
      alignment: 'chaotic evil',
      challenge_rating: 24,
      strength: 30,
    });

    // The flavour line is derived from the stats, not authored as prose.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge dragon, chaotic evil');
    // The derived ability modifier: a raw 30 means +10.
    expect(el.querySelector('[data-testid=stat-mod-strength]')?.textContent).toContain('+10');
    // The plugin ships its own copy under its own scope (ADR-0049): proof the `dnd.*` keys resolve
    // from the plugin's catalog, and not as the raw key a missing scope would print.
    expect(el.textContent).toContain('Switch to the Note view');
  });

  it('edits a stat back into the one grouped block value every other View reads', () => {
    const { fixture, session, el } = render({ challenge_rating: 5 });

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.value).toBe('5');
    cr.value = '13';
    cr.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A structured Field is a lens: the block writes back at its one key, which the Browser harvests on (#188/#236).
    expect(statBlock(session)).toMatchObject({ challenge_rating: 13 });
  });

  it('offers an editable slot for every stat, not just the required one', () => {
    const { fixture, session, el } = render({ challenge_rating: 5 });

    const size = el.querySelector('[data-testid=stat-size] select') as HTMLSelectElement;
    expect(Array.from(size.options).map((o) => o.value)).toContain('Huge');
    size.value = 'Huge';
    size.dispatchEvent(new Event('change'));

    const alignment = el.querySelector('[data-testid=stat-alignment] input') as HTMLInputElement;
    alignment.value = 'chaotic evil';
    alignment.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toMatchObject({ size: 'Huge', alignment: 'chaotic evil', challenge_rating: 5 });
    // The subtitle is derived, so it re-reads the moment its stats are edited.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('Huge, chaotic evil');
  });

  it('does not flag a missing stat — the reusable block imposes no required stat (ADR-0055)', () => {
    // A deity that borrows the block for its size facet and leaves CR blank must see no spurious error:
    // requiredness is a consumer's concern, not the block's. Only an at-rest ill-typed value is flagged.
    const { el } = render({ size: 'Large' });

    const cr = el.querySelector('[data-testid=stat-challenge_rating] input') as HTMLInputElement;
    expect(cr.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('flags an at-rest ill-typed stat — a string where a number belongs (forward-only)', () => {
    // A value this build cannot re-type is tolerated (never dropped) but marked, so an active edit can fix it.
    const { el } = render({ challenge_rating: 'huge' as unknown as number });

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

  it('mints the block on the first edit of an Entity that had none (an attach-and-afford opener)', () => {
    // A non-monster carrying an attached stat-block Field: the key is absent until the first stat lands.
    const { fixture, session, el } = render({});
    expect(statBlock(session)).toEqual({});

    const size = el.querySelector('[data-testid=stat-size] select') as HTMLSelectElement;
    size.value = 'Medium';
    size.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(statBlock(session)).toEqual({ size: 'Medium' });
  });
});
