import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { coordKey, MapDetail } from '@hexly/domain';
import { EditorSession } from './editor-session';
import { EditorStore } from './editor-store';

describe('EditorSession', () => {
  let session: EditorSession;
  let editor: EditorStore;
  let http: HttpTestingController;

  const forestAt00 = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' as const } } };
  const aldermoor: MapDetail = {
    id: 'm1',
    ownerId: 'u1',
    title: 'Aldermoor',
    visibility: 'private',
    version: 3,
    createdAt: 1,
    updatedAt: 1,
    document: forestAt00,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(EditorSession);
    editor = TestBed.inject(EditorStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('opens a map by id and loads its document into the editor', () => {
    session.open('m1').subscribe();

    http.expectOne('/maps/m1').flush(aldermoor);

    expect(editor.document()).toEqual(forestAt00);
  });

  /** Open Aldermoor (version 3) so save/conflict tests have an open map. */
  function openAldermoor() {
    session.open('m1').subscribe();
    http.expectOne('/maps/m1').flush(aldermoor);
  }

  it('saves the editor document under the open map base version', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean'); // edit after opening

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      document: editor.document(),
      version: 3,
    });

    req.flush({ ...aldermoor, version: 4, document: editor.document() });
    expect(outcome).toEqual({
      status: 'saved',
      map: { ...aldermoor, version: 4, document: editor.document() },
    });
  });

  it('surfaces a stale save as a conflict and keeps the editor edit', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');
    const edited = editor.document();

    const serverCurrent: MapDetail = {
      ...aldermoor,
      version: 7,
      document: { hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'desert' } } },
    };

    let outcome: unknown;
    session.save().subscribe((o) => (outcome = o));
    http
      .expectOne('/maps/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
    expect(session.conflict()).toEqual(serverCurrent);
    // The in-progress edit is not lost — it stays in the editor for the re-pull.
    expect(editor.document()).toEqual(edited);
  });

  it('re-pulls the server version on reload, replacing the edit and clearing the conflict', () => {
    openAldermoor();
    editor.paintAt({ q: 5, r: 5 }, 'ocean');

    const serverCurrent: MapDetail = {
      ...aldermoor,
      version: 7,
      document: { hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'desert' } } },
    };
    session.save().subscribe();
    http
      .expectOne('/maps/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    // The user chooses to re-pull: the editor adopts the server's current map
    // and the conflict is resolved.
    session.reload().subscribe();
    http.expectOne('/maps/m1').flush(serverCurrent);

    expect(editor.document()).toEqual(serverCurrent.document);
    expect(session.conflict()).toBeNull();
  });

  it('renames the open map', () => {
    openAldermoor();

    session.rename('The Whisperwood').subscribe();

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'The Whisperwood' });
    req.flush({ ...aldermoor, title: 'The Whisperwood' });

    expect(session.current()?.title).toBe('The Whisperwood');
  });
});
