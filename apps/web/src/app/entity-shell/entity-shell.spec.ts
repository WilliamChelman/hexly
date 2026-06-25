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
import { EditorShell } from '../editor-shell/editor-shell';
import { EditorSession } from '../editor-shell/editor-session';
import { TitleService } from '../core/i18n/title.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EntityShell } from './entity-shell';

/** A throwaway stand-in so the dispatch test never mounts the real (heavy) editor. */
@Component({ selector: 'app-editor-shell', template: 'EDITOR' })
class EditorShellStub {}

describe('EntityShell', () => {
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
      imports: [EntityShell, provideTranslocoTesting()],
      providers: [
        EditorSession,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id })) },
        },
      ],
    })
      .overrideComponent(EntityShell, {
        remove: { imports: [EditorShell] },
        add: { imports: [EditorShellStub] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(EntityShell);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('renders the note view for a note', async () => {
    const fixture = await render('n1');
    http.expectOne('/entities/n1').flush(detail('n1', 'note'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-note-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-editor-shell')).toBeNull();
  });

  it('renders the map editor for a hexmap', async () => {
    const fixture = await render('m1');
    http.expectOne('/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-editor-shell')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-note-view')).toBeNull();
  });

  it('titles the tab with the open Entity name (owned by the session, not each view)', async () => {
    const fixture = await render('m1');
    http.expectOne('/entities/m1').flush(detail('m1', 'hexmap'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(TitleService).documentName()).toBe('Aldermoor');
  });

  it('returns to the library when the Entity fails to load', async () => {
    const fixture = await render('gone');
    http
      .expectOne('/entities/gone')
      .flush(null, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith('/entities');
  });
});
