import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityPage, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
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
    [query]="query()"
    (queryChange)="query.set($event)"
    (pick)="picked = $event"
  />`,
})
class Host {
  readonly query = signal('');
  readonly worldId = signal<string | undefined>(undefined);
  readonly includeMounts = signal(true);
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
      imports: [Host, provideTranslocoTesting(COLLAB_TEST_CATALOGS)],
      providers: [{ provide: EntitiesClient, useValue: entities }],
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
});
