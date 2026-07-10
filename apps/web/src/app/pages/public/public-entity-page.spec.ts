import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, EMPTY, Observable, of, throwError } from 'rxjs';
import { CONTENT_FORMAT, EntityDetail } from '@hexly/domain';
import { EntitiesClient, PublicClient, Watched } from '@hexly/web-core';
import { MockEntitiesClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { PublicEntityPage } from './public-entity-page';

const TOKEN = 'tok-123';

/** A read-only opener, as the server ships one behind a Public Link: `rights: ['read']`. */
const publicDetail = (): EntityDetail => ({
  id: 'n1',
  worldId: 'w1',
  name: 'The Lighthouse',
  type: 'note',
  tags: [],
  visibility: 'shared',
  version: 1,
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  rights: ['read'],
  document: { type: 'note', content: { format: CONTENT_FORMAT, snapshot: {} } },
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

  function render(): HTMLElement {
    fixture = TestBed.createComponent(PublicEntityPage);
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
   * that component acquires must resolve here too. When they were listed on the entity *route*,
   * this page had to mirror the list by hand — and a missed one (`RightDock`, #179) threw
   * NullInjectorError during construction, rendering the banner over an empty page.
   */
  it('renders the reused editor for an anonymous reader', () => {
    const el = render();

    expect(el.querySelector('[data-testid=public-banner]')).not.toBeNull();
    expect(el.querySelector('[data-testid=note-content]')).not.toBeNull();
    expect(el.querySelector('[data-testid=public-notfound]')).toBeNull();
  });

  /**
   * References is not a panel this context can serve: the endpoint answers a `CurrentUser`, and a
   * Public Link grants no scope beyond its own Entity. So the dock offers the Outline alone —
   * no toggle, and therefore no fetch that could only ever 403.
   */
  it('offers the Outline but not References', () => {
    const el = render();

    expect(el.querySelector('[data-testid=outline-toggle]')).not.toBeNull();
    expect(el.querySelector('[data-testid=references-toggle]')).toBeNull();
  });

  it('shows the dead-link panel when the token does not resolve', () => {
    client.entity.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    const el = render();

    expect(el.querySelector('[data-testid=public-notfound]')).not.toBeNull();
    expect(el.querySelector('[data-testid=note-content]')).toBeNull();
  });
});
