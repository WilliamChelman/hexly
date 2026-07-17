import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, EMPTY, Observable, of, throwError } from 'rxjs';
import { EntityDetail } from '@hexly/domain';
import { CONTENT_FORMAT, CORE_NOTE } from '@hexly/plugin-content';
import { ENTITY_TYPES } from '@hexly/web-entity';
import { CORE_VIEW_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
import { ViewRegistry } from '../../entity-types/view-registry';
import { TypeRegistry } from '../../entity-types/type-registry';
import { EntitiesClient, PublicClient, Watched } from '@hexly/web-core';
import { MockEntitiesClient } from '@hexly/web-core/testing';
import { PublicEntityPage } from './public-entity.page';

const TOKEN = 'tok-123';

/** A read-only opener, as the server ships one behind a Public Link: `rights: ['read']`. */
const publicDetail = (): EntityDetail => ({
  id: 'n1',
  worldId: 'w1',
  name: 'The Lighthouse',
  types: [CORE_NOTE],
  tags: [],
  visibility: 'shared',
  version: 1,
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  rights: ['read'],
  document: { content: { format: CONTENT_FORMAT, snapshot: {} } },
});

/** Minimal stand-in for the token-scoped Public read client. */
class MockPublicClient {
  entity = vi.fn<(token: string) => Observable<EntityDetail>>();
  worldEntity = vi.fn<(token: string, id: string) => Observable<EntityDetail>>();
  watchEntity = vi.fn<() => Observable<Watched<EntityDetail>>>();
}

describe('PublicEntityPage', () => {
  let client: MockPublicClient;
  let fixture: ComponentFixture<PublicEntityPage>;
  const params$ = new BehaviorSubject(convertToParamMap({ token: TOKEN }));

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(PublicEntityPage);
    fixture.detectChanges();
    // The reused EntityPage outlets the content plugin's View, fetched on activation (ADR-0051).
    await TestBed.inject(ViewRegistry).fetch(CORE_VIEW_CONTENT);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    client = new MockPublicClient();
    client.entity.mockReturnValue(of(publicDetail()));
    client.watchEntity.mockReturnValue(EMPTY);
    await TestBed.configureTestingModule({
      imports: [PublicEntityPage, provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        { provide: ENTITY_TYPES, useExisting: TypeRegistry },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicClient, useValue: client },
        { provide: EntitiesClient, useValue: new MockEntitiesClient() },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params$.asObservable(),
            queryParamMap: of(convertToParamMap({})),
            fragment: of(null),
            data: of({}),
          },
        },
      ],
    }).compileComponents();
  });

  /**
   * The Public Link page mounts the shared {@link EntityPage}, so every route-scoped dependency
   * that component acquires must resolve here too, or construction throws NullInjectorError.
   */
  it('renders the reused editor for an anonymous reader', async () => {
    const el = await render();

    expect(el.querySelector('[data-testid=public-banner]')).not.toBeNull();
    expect(el.querySelector('[data-testid=note-content]')).not.toBeNull();
    expect(el.querySelector('[data-testid=public-notfound]')).toBeNull();
  });

  /**
   * References is not a panel this context can serve: the endpoint answers a `CurrentUser`, and a
   * Public Link grants no scope beyond its own Entity — the fetch could only ever 403.
   */
  it('offers the Outline but not References', async () => {
    const el = await render();

    expect(el.querySelector('[data-testid=outline-toggle]')).not.toBeNull();
    expect(el.querySelector('[data-testid=references-toggle]')).toBeNull();
  });

  it('shows the dead-link panel when the token does not resolve', async () => {
    client.entity.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    const el = await render();

    expect(el.querySelector('[data-testid=public-notfound]')).not.toBeNull();
    expect(el.querySelector('[data-testid=note-content]')).toBeNull();
  });
});
