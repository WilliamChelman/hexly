import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EntityDocument } from '@hexly/domain';
import { produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { DS_STAT_BLOCK_KEY } from '@hexly/plugin-draw-steel';
import { DS_TEST_CATALOGS } from '../i18n/test-catalogs';
import { StatBlockViewComponent } from './stat-block-view.component';

/**
 * The `draw-steel.stat-block` data-type's View (#243, ADR-0055). It binds to the {@link ENTITY_SESSION}
 * contract plus {@link VIEW_FIELD_KEY} — the one document key its whole block lives at — so a minimal fake
 * session and a fixed key stand in for the app's.
 */
describe('StatBlockView (draw-steel)', () => {
  /** A stand-in for the app's central store: the one Entity Document every View reads its slice off. */
  function fakeSession(block: Record<string, unknown>, writable = true): EntitySession {
    const doc = signal<EntityDocument>({
      content: { format: 'tiptap-v1', snapshot: {} },
      [DS_STAT_BLOCK_KEY]: block,
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

  /** Render the View over a stat block seeded at {@link DS_STAT_BLOCK_KEY} — the key the page injects. */
  function render(block: Record<string, unknown>, writable = true) {
    const session = fakeSession(block, writable);
    TestBed.configureTestingModule({
      imports: [StatBlockViewComponent, provideTranslocoTesting(DS_TEST_CATALOGS)],
      providers: [
        { provide: ENTITY_SESSION, useValue: session },
        { provide: VIEW_FIELD_KEY, useValue: DS_STAT_BLOCK_KEY },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(StatBlockViewComponent);
    fixture.detectChanges();
    return { fixture, session, el: fixture.nativeElement as HTMLElement };
  }

  /** The stat block as it sits inside the document — the value at the injected key. */
  const statBlock = (session: EntitySession) => session.doc()[DS_STAT_BLOCK_KEY];

  it('prints the block from one grouped value, with translated labels', () => {
    const { el } = render({ role: 'brute', organization: 'elite', level: 3, might: 2 });

    // The flavour line is derived from the identity stats, not authored as prose.
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('brute, elite');
    // In a writable opener the level is an editable control, so its value lives on the input.
    expect((el.querySelector('[data-testid=stat-level] input') as HTMLInputElement).value).toBe('3');
    expect(el.textContent).toContain('Switch to the Note view');
    // The plugin ships its own copy under its own scope (ADR-0049): a stat label, the immunities section
    // header, and a damage-type label all resolve — not the raw key a missing scope would print.
    expect(el.textContent).toContain('Stamina');
    expect(el.textContent).toContain('Immunities');
    expect(el.textContent).toContain('Fire');
    // The characteristics grid prints the language-neutral abbreviation (M) with the value beside it.
    expect((el.querySelector('[data-testid=stat-might] input') as HTMLInputElement).value).toBe('2');
  });

  it('edits a scalar stat back into the one grouped block value every other View reads', () => {
    const { fixture, session, el } = render({ level: 5 });

    const level = el.querySelector('[data-testid=stat-level] input') as HTMLInputElement;
    expect(level.value).toBe('5');
    level.value = '7';
    level.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A structured Field is a lens: the block writes back at its one key (#188/#236).
    expect(statBlock(session)).toMatchObject({ level: 7 });
  });

  it('offers an editable slot for every stat — the enum role and the free-text keywords list', () => {
    const { fixture, session, el } = render({ level: 3 });

    const role = el.querySelector('[data-testid=stat-role] select') as HTMLSelectElement;
    expect(Array.from(role.options).map((o) => o.value)).toContain('brute');
    role.value = 'brute';
    role.dispatchEvent(new Event('change'));

    // A `list` renders as a comma-separated text control (web-entity FieldControl).
    const keywords = el.querySelector('[data-testid=stat-keywords] input') as HTMLInputElement;
    keywords.value = 'humanoid, goblin';
    keywords.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toMatchObject({ level: 3, role: 'brute', keywords: ['humanoid', 'goblin'] });
    expect(el.querySelector('[data-testid=stat-block-subtitle]')?.textContent).toContain('brute');
  });

  it('edits a per-damage-type immunity into a nested map, and clears the map when the last entry is emptied', () => {
    const { fixture, session, el } = render({});

    const fire = el.querySelector('[data-testid=damage-immunities-fire] input') as HTMLInputElement;
    fire.value = '5';
    fire.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({ immunities: { fire: 5 } });

    // Emptying the only entry drops the whole map — no `{}` husk survives into the frontmatter.
    fire.value = '';
    fire.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(statBlock(session)).toEqual({});
  });

  it('does not flag a missing stat — the reusable block imposes no required stat (ADR-0055)', () => {
    const { el } = render({ role: 'brute' });

    const level = el.querySelector('[data-testid=stat-level] input') as HTMLInputElement;
    expect(level.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('flags an at-rest ill-typed stat — a string where a number belongs (forward-only)', () => {
    const { el } = render({ stamina: 'lots' as unknown as number });

    const stamina = el.querySelector('[data-testid=stat-stamina] input') as HTMLInputElement;
    expect(stamina.getAttribute('aria-invalid')).toBe('true');
  });

  it('prints, rather than edits, for a read-only opener', () => {
    const { el } = render({ level: 5, might: 2, movement_types: ['walk', 'fly'] }, false);

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[data-testid=stat-level]')?.textContent).toContain('5');
    // A list prints joined for legibility, not as a bare `walk,fly`.
    expect(el.querySelector('[data-testid=stat-movement_types]')?.textContent).toContain('walk, fly');
  });

  it('mints the block on the first edit of an Entity that had none (an attach-and-afford opener)', () => {
    const { fixture, session, el } = render({});
    expect(statBlock(session)).toEqual({});

    const might = el.querySelector('[data-testid=stat-might] input') as HTMLInputElement;
    might.value = '3';
    might.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(statBlock(session)).toEqual({ might: 3 });
  });
});
