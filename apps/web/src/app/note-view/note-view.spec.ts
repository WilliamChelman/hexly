import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntityDetail } from '@hexly/domain';
import { EditorSession } from '../editor-shell/editor-session';
import { HeaderService } from '../shell/header.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { NoteView } from './note-view';

describe('NoteView', () => {
  const note = (name: string): EntityDetail => ({
    id: 'n1',
    ownerId: 'u1',
    name,
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } },
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoteView, provideTranslocoTesting()],
      providers: [
        EditorSession,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('shows the open note’s name', () => {
    TestBed.inject(EditorSession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lady Mara');
  });

  it('offers a way back to the library', () => {
    TestBed.inject(EditorSession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    const back = fixture.nativeElement.querySelector(
      '[data-testid=back-to-library]',
    ) as HTMLAnchorElement;
    expect(back).not.toBeNull();
    expect(back.getAttribute('href')).toBe('/entities');
  });

  it('contributes the note’s name to the app header while open', () => {
    TestBed.inject(EditorSession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(TestBed.inject(HeaderService).content()?.title).toBe('Lady Mara');
  });
});
