import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
} from '@angular/router';
import { of } from 'rxjs';
import { EntityDetail, EntityType } from '@hexly/domain';
import { EditorShell } from './components/editor-shell';
import { EntitySession } from './services/entity-session';
import { TitleService } from '../../core/i18n/title.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { EntityPage } from './entity.page';

/** A throwaway stand-in so the dispatch test never mounts the real (heavy) editor. */
@Component({ selector: 'app-editor-shell', template: 'EDITOR' })
class EditorShellStub {}

describe('EntityPage', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const detail = (id: string, type: EntityType): EntityDetail => ({
    id,
    ownerId: 'u1',
    name: type === 'note' ? 'Lady Mara' : 'Aldermoor',
    type,
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document:
      type === 'note'
        ? { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } }
        : {
            type: 'hexmap',
            content: { format: 'tiptap-v1', snapshot: {} },
            hexes: {},
            regions: [],
            labels: [],
          },
  });

  async function render(id: string) {
    await TestBed.configureTestingModule({
      imports: [EntityPage, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id })) },
        },
      ],
    })
      .overrideComponent(EntityPage, {
        remove: { imports: [EditorShell] },
        add: { imports: [EditorShellStub] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(EntityPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('renders the note view for a note', async () => {
    const fixture = await render('n1');
    http.expectOne('/api/entities/n1').flush(detail('n1', 'note'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-note-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-editor-shell')).toBeNull();
  });

  it('renders the map editor for a hexmap', async () => {
    const fixture = await render('m1');
    http.expectOne('/api/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-editor-shell')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-note-view')).toBeNull();
  });

  it('titles the tab with the open Entity name (owned by the session, not each view)', async () => {
    const fixture = await render('m1');
    http.expectOne('/api/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(TitleService).documentName()).toBe('Aldermoor');
  });

  it('returns to the library when the Entity fails to load', async () => {
    const fixture = await render('gone');
    http
      .expectOne('/api/entities/gone')
      .flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith('/entities');
  });
});
