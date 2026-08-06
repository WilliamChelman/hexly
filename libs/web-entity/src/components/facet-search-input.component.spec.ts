import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EntityFacets, FacetKeySet } from '@hexly/domain';
import { FacetSearchInputComponent } from './facet-search-input.component';

/** The Entity Browser's vocabulary in miniature: the reserved trio it can apply, plus two Facet keys. */
const KEYS: FacetKeySet = { reserved: ['type', 'tag', 'visibility'], fields: ['challenge_rating', 'region'] };

/** The Facet read a browse surface already runs — value suggestions and their counts come off this. */
const FACETS: EntityFacets = {
  type: [
    { value: 'npc', count: 4 },
    { value: 'note', count: 2 },
  ],
  tag: [
    { value: 'Sea of Storms', count: 3 },
    { value: 'draft', count: 1 },
  ],
  visibility: [],
  fields: [{ key: 'region', label: 'Region', dataType: { kind: 'string' }, values: [{ value: 'Ashfen', count: 5 }] }],
};

/** A consumer owning the text, as every surface does — the box is controlled, never self-committing. */
@Component({
  imports: [FacetSearchInputComponent],
  template: `<app-facet-search-input
    testid="search"
    [value]="value()"
    [keys]="keys()"
    [facets]="facets()"
    (queryChange)="onQuery($event)"
  />`,
})
class Host {
  readonly value = signal('');
  readonly keys = signal<FacetKeySet>(KEYS);
  readonly facets = signal<EntityFacets | null>(FACETS);
  readonly emitted: string[] = [];

  /** Controlled, as every consumer is: the box's own keystroke comes straight back as its value. */
  onQuery(text: string): void {
    this.emitted.push(text);
    this.value.set(text);
  }
}

describe('FacetSearchInput (ADR-0082)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = el.querySelector('[data-testid=search]') as HTMLInputElement;

    /** Type into the box as a caller would: the DOM value, the caret, then the event. */
    const type = (text: string, caret = text.length) => {
      box.value = text;
      box.setSelectionRange(caret, caret);
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const rows = () =>
      Array.from(el.querySelectorAll('[role=option]')).map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      box.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    return { fixture, el, box, type, rows, press };
  }

  describe('stage one: the keys', () => {
    it('reveals the whole vocabulary on a `$` at a word boundary', () => {
      const { type, rows } = render();

      type('orc $');

      expect(rows()).toEqual(['type', 'tag', 'visibility', 'challenge_rating', 'region']);
    });

    /** The registry answers synchronously, so the list stands whatever the Facet read is doing. */
    it('offers keys with no Facet read at all', () => {
      const { fixture, type, rows } = render();
      fixture.componentInstance.facets.set(null);
      fixture.detectChanges();

      type('$');

      expect(rows()).toEqual(['type', 'tag', 'visibility', 'challenge_rating', 'region']);
    });

    it('narrows as the key is typed, and offers nothing for a `$` mid-word', () => {
      const { type, rows } = render();

      type('$reg');
      expect(rows()).toEqual(['region']);

      type('sea$');
      expect(rows()).toEqual([]);
    });

    it('completes the key with its colon and opens the value stage straight away', () => {
      const { box, type, rows, press } = render();

      type('$ty');
      press('Enter');

      expect(box.value).toBe('$type:');
      expect(box.selectionStart).toBe(6);
      expect(rows()).toEqual(['npc4', 'note2']);
    });
  });

  describe('stage two: the values', () => {
    it('offers the Facet read’s values with their counts', () => {
      const { type, rows } = render();

      type('$type:n');

      expect(rows()).toEqual(['npc4', 'note2']);
    });

    it('reads a Facet key’s values off the Field facet that carries it', () => {
      const { type, rows } = render();

      type('$region:');

      expect(rows()).toEqual(['Ashfen5']);
    });

    it('offers nothing where the read carries no such key — a miss, not a guess', () => {
      const { type, rows } = render();

      type('$visibility:');

      expect(rows()).toEqual([]);
    });

    /**
     * The Facet read is surfaced by presence (#231), so it can carry a key this surface's registry does
     * not name — and the vocabulary is the registry's alone (ADR-0082). A key the page reports as a miss
     * must not quietly grow a counted value list.
     */
    it('offers no values for a key this surface cannot apply, whatever the read carries', () => {
      const { fixture, type, rows } = render();
      fixture.componentInstance.keys.set({ reserved: ['type'], fields: [] });
      fixture.detectChanges();

      type('$region:');
      expect(rows()).toEqual([]);

      type('$type:n');
      expect(rows()).toEqual(['npc4', 'note2']);
    });

    it('inserts the stored value verbatim, in the case it is stored in', () => {
      const { fixture, box, type, press } = render();

      type('$region:ash');
      press('Enter');

      expect(box.value).toBe('$region:Ashfen');
      expect(fixture.componentInstance.emitted.at(-1)).toBe('$region:Ashfen');
    });

    it('quotes a value the grammar would otherwise read as two words', () => {
      const { box, type, press } = render();

      type('$tag:sea');
      press('Enter');

      expect(box.value).toBe('$tag:"Sea of Storms"');
    });

    it('shuts once a value is accepted — that token asked its whole question', () => {
      const { type, rows, press } = render();

      type('$type:n');
      press('Enter');

      expect(rows()).toEqual([]);
    });

    it('leaves the text after the caret alone', () => {
      const { box, type, press } = render();

      type('$type:np orc', 8);
      press('Enter');

      expect(box.value).toBe('$type:npc orc');
    });
  });

  describe('the keyboard', () => {
    it('moves the selection with the arrows and accepts with Enter', () => {
      const { box, el, type, press } = render();

      type('$type:');
      press('ArrowDown');
      expect(el.querySelectorAll('[aria-selected=true]')[0]?.textContent).toContain('note');

      press('ArrowUp');
      press('Enter');
      expect(box.value).toBe('$type:npc');
    });

    it('dismisses the list on Escape and leaves the surface under it open', () => {
      const { fixture, box, type, rows, press } = render();
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as KeyboardEvent).key);
      window.addEventListener('keydown', listener);

      try {
        type('$type:');
        const escape = press('Escape');

        expect(rows()).toEqual([]);
        // Neither half of the surface's Escape reaches it: the native `<dialog>` cancel is prevented and
        // the app's window-level dispatcher never sees the key — so only the list closes.
        expect(escape.defaultPrevented).toBe(true);
        expect(seen).toEqual([]);
        // The box keeps what was typed; dismissing a list is not clearing a query.
        expect(box.value).toBe('$type:');
        expect(fixture.componentInstance.emitted.at(-1)).toBe('$type:');
      } finally {
        window.removeEventListener('keydown', listener);
      }
    });

    /** A caret the list did not move can leave the token it was completing, so it shuts rather than act
     * on a slice the caret has left. */
    it('shuts when the caret walks out from under it', () => {
      const { type, rows, press } = render();

      type('$type:n');
      press('ArrowLeft');

      expect(rows()).toEqual([]);
    });

    /**
     * The deliberate deviation from ADR-0063 (recorded there): while the list is open these keys are
     * claimed on the element and stopped before the app's window-level dispatcher.
     */
    it('keeps its keys from the window dispatcher while open — and leaves them alone while closed', () => {
      const { type, press } = render();
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as KeyboardEvent).key);
      window.addEventListener('keydown', listener);

      try {
        type('$type:');
        press('ArrowDown');
        press('Enter');
        expect(seen).toEqual([]);

        type('orc');
        press('ArrowDown');
        press('Enter');
        press('Escape');
        expect(seen).toEqual(['ArrowDown', 'Enter', 'Escape']);
      } finally {
        window.removeEventListener('keydown', listener);
      }
    });

    it('leaves Tab its native focus move, closing the list', () => {
      const { type, rows, press } = render();

      type('$type:');
      const tab = press('Tab');

      expect(rows()).toEqual([]);
      expect(tab.defaultPrevented).toBe(false);
    });
  });

  it('emits every keystroke and never rewrites the box itself', () => {
    const { fixture, box, type } = render();

    type('$tag:fan');

    expect(fixture.componentInstance.emitted).toEqual(['$tag:fan']);
    expect(box.value).toBe('$tag:fan');
  });

  it('opens no list for a surface that names no vocabulary — the plain box it replaces', () => {
    const { fixture, type, rows } = render();
    fixture.componentInstance.keys.set({ reserved: [], fields: [] });
    fixture.detectChanges();

    type('$');

    expect(rows()).toEqual([]);
  });
});
