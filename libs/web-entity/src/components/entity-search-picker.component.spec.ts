import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityPage, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { UI_TEST_CATALOGS } from '@hexly/web-ui/testing';
import { provideEntityTypesTesting } from '../testing/entity-types.fake';
import { EntitySearchPickerComponent } from './entity-search-picker.component';
import { COLLAB_TEST_CATALOGS } from '../i18n/test-catalogs';

function summary(id: string, name = id, type: EntityType = 'core.type.note'): EntitySummary {
  return {
    id,
    worldId: 'w1',
    name,
    types: [type],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

const page = (items: EntitySummary[]): EntityPage => ({
  items,
  nextCursor: null,
});

/** A host that owns the controlled query, mirroring how a page embeds the picker. */
@Component({
  imports: [EntitySearchPickerComponent],
  template: `<app-entity-search-picker
    testid="pin-picker"
    [worldId]="worldId()"
    [includeMounts]="includeMounts()"
    [types]="types()"
    [query]="query()"
    (queryChange)="query.set($event)"
    (pick)="picked = $event"
  />`,
})
class Host {
  readonly query = signal('');
  readonly worldId = signal<string | undefined>(undefined);
  readonly includeMounts = signal(true);
  readonly types = signal<readonly string[] | undefined>(undefined);
  picked: EntitySummary | null = null;
}

describe('EntitySearchPicker', () => {
  let entities: MockEntitiesClient;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    // Filter the stub set by the query, mirroring the server-side name search.
    entities.list.mockImplementation((o) =>
      of(
        page(
          [summary('n1', 'Riverbend'), summary('n2', 'North Reach')].filter((e) =>
            e.name.toLowerCase().includes((o?.q ?? '').toLowerCase()),
          ),
        ),
      ),
    );
    await TestBed.configureTestingModule({
      imports: [Host, provideTranslocoTesting(COLLAB_TEST_CATALOGS, UI_TEST_CATALOGS)],
      providers: [
        { provide: EntitiesClient, useValue: entities },
        // The box reads its Facet vocabulary off the registry, synchronously (ADR-0082).
        provideEntityTypesTesting([]),
      ],
    }).compileComponents();
  });

  const byId = (el: HTMLElement, testid: string) => el.querySelector(`[data-testid=${testid}]`) as HTMLElement | null;

  it('lists entities and emits the chosen one on pick', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The prefix is the configured testid.
    expect(byId(el, 'pin-picker-option-n1')).not.toBeNull();
    (byId(el, 'pin-picker-option-n2') as HTMLButtonElement).click();

    expect(fixture.componentInstance.picked?.id).toBe('n2');
  });

  it('scopes the search to the World when a worldId is given', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.worldId.set('w1');
    fixture.detectChanges();

    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1' }));
  });

  /**
   * Every consumer of this picker asks the same question — what may this point at? — so the read says so
   * once here rather than four times over, and the server answers it with this World's Entities and the
   * ones in the Containers it Mounts, and nothing else (ADR-0079, ADR-0080). That covers the Entity Link
   * Field picker, the Board Embed picker and a broken link's relink popover, from one read.
   */
  it('asks for link targets, so only what the World may point at is offered', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ read: 'link-target' }));
  });

  /**
   * The **Container** facet (ADR-0080): where a World Mounts something, the picker offers one chip per
   * Container the read reached, and picking one narrows to a single pack or Shelf. Counted off the same
   * read the options come from — its own selection dropped, as every drill-down facet's is — so the
   * chips can never annotate a list they disagree with.
   */
  describe('the Container facet', () => {
    beforeEach(() => {
      entities.facets.mockImplementation(() =>
        of({
          type: [],
          tag: [],
          visibility: [],
          fields: [],
          container: [
            { value: 'w1', label: 'Aldermoor', count: 2 },
            { value: 'shelf', label: 'The Art Shelf', count: 1 },
          ],
        }),
      );
    });

    it('offers one chip per Container, labelled and counted', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      expect(byId(el, 'pin-picker-container-w1')?.textContent).toContain('Aldermoor');
      expect(byId(el, 'pin-picker-container-shelf')?.textContent).toContain('The Art Shelf');
      expect(byId(el, 'pin-picker-container-shelf')?.textContent).toContain('1');
      // Counted with its own selection dropped, so the chip you stand on keeps its siblings.
      expect(entities.facets).toHaveBeenCalledWith(expect.objectContaining({ container: undefined }));
    });

    it('narrows the read to the Container picked, and gives it back', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      byId(el, 'pin-picker-container-shelf')?.click();
      fixture.detectChanges();
      expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ container: ['shelf'] }));

      byId(el, 'pin-picker-container-all')?.click();
      fixture.detectChanges();
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ container: undefined }));
    });

    /**
     * A narrowing the World outlives would silently answer the next search from a Container the user
     * cannot see chosen — a new World is a new set of Containers (ADR-0080).
     */
    it('drops the narrowing when the World changes', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.worldId.set('w1');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      byId(el, 'pin-picker-container-shelf')?.click();
      fixture.detectChanges();
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ container: ['shelf'] }));

      fixture.componentInstance.worldId.set('w2');
      fixture.detectChanges();

      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ worldId: 'w2', container: undefined }));
    });

    /**
     * The server counts Containers over the *filtered* result set, so refining a search until only one
     * Container still matches drops the chosen one out of the facet — while the read stays narrowed to
     * it. The way out of a narrowing must never leave the screen before the narrowing does.
     */
    it('keeps the way out of a narrowing on screen once the facet counts one Container', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      byId(el, 'pin-picker-container-shelf')?.click();
      fixture.detectChanges();

      entities.facets.mockImplementation(() =>
        of({
          type: [],
          tag: [],
          visibility: [],
          fields: [],
          container: [{ value: 'w1', label: 'Aldermoor', count: 1 }],
        }),
      );
      const search = byId(el, 'pin-picker-search') as HTMLInputElement;
      search.value = 'river';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ container: ['shelf'] }));
      expect(byId(el, 'pin-picker-container-all')).not.toBeNull();
      expect(byId(el, 'pin-picker-container-shelf')).not.toBeNull();
    });

    it('offers no chip at all where the read spans one Container, there being nothing to narrow', () => {
      entities.facets.mockImplementation(() => of({ type: [], tag: [], visibility: [], fields: [] }));
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();

      expect(byId(fixture.nativeElement as HTMLElement, 'pin-picker-containers')).toBeNull();
    });

    /**
     * ADR-0080 enumerates what widens — the `@` picker, the Entity Link Field picker, the Board Embed
     * picker, the asset and Board image pickers. A consumer outside that list keeps the sealed scope, so
     * it offers no mounted Container to narrow to and counts none either.
     */
    it('offers this World alone to a consumer that declines the Mount-widened scope', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.worldId.set('w1');
      fixture.componentInstance.includeMounts.set(false);
      fixture.detectChanges();

      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ worldId: 'w1', container: ['w1'] }));
      expect(byId(fixture.nativeElement as HTMLElement, 'pin-picker-containers')).toBeNull();
      expect(entities.facets).not.toHaveBeenCalled();
    });
  });

  /**
   * A picker is no browse: an Asset stays pickable by name (a Board Embed of one, a pinned one), unlike in
   * the Entity Browser's own listing (ADR-0065). The server ranks hidden types last, so they never lead.
   */
  it('opts into hidden-from-default-listing types, as a by-name picker', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ includeHidden: true }));
  });

  it('re-searches as the query changes and narrows the options', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const search = byId(el, 'pin-picker-search') as HTMLInputElement;
    search.value = 'river';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.query()).toBe('river');
    expect(byId(el, 'pin-picker-option-n1')).not.toBeNull();
    expect(byId(el, 'pin-picker-option-n2')).toBeNull();
  });

  /**
   * The token language, in a picker (ADR-0082). These surfaces carry no rail, so the text is the only
   * store: a Facet is named inline, and reversed by backspacing what named it. Values and their counts
   * come off the Facet read the Container chips already issue — no request is added per keystroke.
   */
  describe('the token language', () => {
    /** The Facet read every picker already runs, here carrying values to offer as well as Containers. */
    beforeEach(() => {
      entities.facets.mockImplementation(() =>
        of({
          type: [{ value: 'core.type.npc', count: 4 }],
          tag: [
            { value: 'Sea of Storms', count: 3 },
            { value: 'draft', count: 1 },
          ],
          visibility: [],
          fields: [],
        }),
      );
    });

    function typeInto(fixture: ReturnType<typeof TestBed.createComponent<Host>>, text: string) {
      const box = byId(fixture.nativeElement as HTMLElement, 'pin-picker-search') as HTMLInputElement;
      box.value = text;
      box.setSelectionRange(text.length, text.length);
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return box;
    }

    it('narrows the read by a typed Facet, the wire carrying the residual text', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();

      typeInto(fixture, '$type:core.type.npc riverbend');

      expect(entities.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'riverbend', type: ['core.type.npc'] }),
      );
    });

    it('reverses a filter when its token is backspaced away — no rail is needed to undo it', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();

      typeInto(fixture, '-$tag:draft riverbend');
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ excludeTag: ['draft'] }));

      // The box holds exactly what was typed, so backspacing the token is all it takes.
      typeInto(fixture, 'riverbend');
      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'riverbend' }));
      expect(entities.list).not.toHaveBeenLastCalledWith(expect.objectContaining({ excludeTag: ['draft'] }));
    });

    it('offers values and their counts off the read it already runs, adding no request', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      typeInto(fixture, '$tag:');

      const rows = Array.from(el.querySelectorAll('[role=option]')).map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
      expect(rows).toEqual(['Sea of Storms3', 'draft1']);
      // One Facet read per read of the options, exactly as before the box could offer anything.
      expect(entities.facets.mock.calls.length).toBe(entities.list.mock.calls.length);
    });

    it('offers the whole vocabulary on the dollar, less the Container the chips own', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      typeInto(fixture, '$');

      const rows = Array.from(el.querySelectorAll('[role=option]')).map((row) => (row.textContent ?? '').trim());
      expect(rows).toEqual(['type', 'tag', 'visibility']);
    });

    /**
     * The wire's `type` ORs, so a token could only widen past a picker already pinned to its target
     * types — reported as a miss instead, which is what a reader can act on.
     */
    it('answers to no $type where the picker is already pinned to one, and says so', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.types.set(['core.type.note']);
      fixture.detectChanges();

      typeInto(fixture, '$type:core.type.npc');

      expect(entities.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: ['core.type.note'] }));
      expect(byId(fixture.nativeElement as HTMLElement, 'pin-picker-unknown-facet')?.textContent).toContain('type');
    });

    /** A token that resolved and still applied nothing is stated, never left to look like an empty box. */
    it('says why a resolvable token filtered nothing, with its own message per reason', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      typeInto(fixture, '$tag:');
      expect(byId(el, 'pin-picker-unknown-facet-empty-value')?.textContent).toContain('names no value');

      typeInto(fixture, '$tag:"sea of ');
      expect(byId(el, 'pin-picker-unknown-facet-unterminated-quote')?.textContent).toContain('quote still open');
      // Half a value is not a filter: the search runs on the text alone.
      expect(entities.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ tag: expect.anything() }));
    });

    it('dismisses the suggestions on Escape without closing the picker', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const box = typeInto(fixture, '$');
      expect(el.querySelector('[role=option]')).not.toBeNull();

      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      box.dispatchEvent(escape);
      fixture.detectChanges();

      expect(el.querySelector('[role=option]')).toBeNull();
      // The dialog or popover the picker sits in never sees the key, so it stays open.
      expect(escape.defaultPrevented).toBe(true);
      expect(byId(el, 'pin-picker-menu')).not.toBeNull();
    });
  });
});
