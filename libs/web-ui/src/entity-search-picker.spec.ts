import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityPage, EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { EntitySearchPicker } from './entity-search-picker';
import { WEB_UI_TEST_CATALOGS } from './i18n/test-catalogs';

function summary(id: string, name = id, type: EntityType = 'core.note'): EntitySummary {
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
  imports: [EntitySearchPicker],
  template: `<app-entity-search-picker
    testid="pin-picker"
    [worldId]="worldId"
    [query]="query()"
    (queryChange)="query.set($event)"
    (pick)="picked = $event"
  />`,
})
class Host {
  readonly query = signal('');
  worldId: string | undefined = undefined;
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
      imports: [Host, provideTranslocoTesting(WEB_UI_TEST_CATALOGS)],
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
    fixture.componentInstance.worldId = 'w1';
    fixture.detectChanges();

    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'w1' }));
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
