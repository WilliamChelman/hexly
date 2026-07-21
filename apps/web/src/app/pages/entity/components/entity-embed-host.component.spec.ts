import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { EntitiesClient, ActiveWorld } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { ENTITY_TYPES, VIEW_FIELD_KEY } from '@hexly/web-entity';
import { CONTENT_FORMAT, CORE_NOTE } from '@hexly/plugin-content';
import { CORE_VIEW_RICH_CONTENT, providePluginContent, EntityNameResolver } from '@hexly/plugin-content/web';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { ViewRegistry } from '../../../entity-types/view-registry';
import { CORE_VIEW_DEFINITIONS } from '../views/core-views';
import { EntityEmbedHostComponent } from './entity-embed-host.component';

/**
 * The Board Embed's transclusion host end-to-end (#270): its own read-only {@link EmbedEntitySession}
 * drives an async load, and the pinned View seeds the target's prose. Guards the empty-body regression —
 * a Note target's prose View is placed by id (no Field key), so the Outlet provided no `VIEW_FIELD_KEY`
 * and the nested Content editor inherited the enclosing Board view's `core.field.surface`, reading the
 * wrong document slot. The host is mounted **under an outer `VIEW_FIELD_KEY`** here (the Board's), so the
 * fix — the Outlet shadowing the token with `null` — is what makes the body seed.
 */
describe('EntityEmbedHost', () => {
  let entities: MockEntitiesClient;
  let http: HttpTestingController;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    await TestBed.configureTestingModule({
      imports: [EntityEmbedHostComponent, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        { provide: ENTITY_TYPES, useExisting: TypeRegistry },
        EntityNameResolver,
        { provide: EntitiesClient, useValue: entities },
        // The enclosing view's Field key (a Board surface View provides this): the Embed's Outlet must
        // shadow it, not inherit it, so the transcluded Note's editor falls to its canonical content key.
        { provide: VIEW_FIELD_KEY, useValue: 'core.field.surface' },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set('w1');
    http = TestBed.inject(HttpTestingController);
    const views = TestBed.inject(ViewRegistry);
    for (const def of CORE_VIEW_DEFINITIONS) views.register(def);
  });

  afterEach(() => {
    http.match('/api/auth/me');
    http.verify();
  });

  const note = (): EntityDetail =>
    ({
      id: 'note-1',
      worldId: 'w1',
      name: 'Bigby',
      types: [CORE_NOTE],
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      document: {
        aliases: ['Big'],
        'core.field.content': {
          format: CONTENT_FORMAT,
          snapshot: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bigby lives here' }] }],
          },
        },
      },
    }) as unknown as EntityDetail;

  it('seeds a Note target’s prose despite an enclosing view’s VIEW_FIELD_KEY (async load)', async () => {
    const load = new Subject<EntityDetail>();
    entities.load.mockReturnValue(load);

    const fixture: ComponentFixture<EntityEmbedHostComponent> = TestBed.createComponent(EntityEmbedHostComponent);
    fixture.componentRef.setInput('entityId', 'note-1');
    fixture.componentRef.setInput('viewKey', CORE_VIEW_RICH_CONTENT); // bare, as a Note's by-id placement affords
    fixture.detectChanges(); // mount before the load resolves — the real HTTP-timed order

    load.next(note());
    load.complete();
    TestBed.tick(); // settle the embed session's reconciler + signals
    await TestBed.inject(ViewRegistry).fetch(CORE_VIEW_RICH_CONTENT);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-content-editor')).not.toBeNull();
    // The body seeds the Note's prose — the editor read `core.field.content`, not the inherited surface key.
    expect(el.querySelector('app-content-editor')?.textContent).toContain('Bigby lives here');
  });
});
