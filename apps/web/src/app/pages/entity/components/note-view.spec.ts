import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EntitySession } from '../services/entity-session';
import { EntityNameResolver } from '../services/entity-name-resolver';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { NoteView } from './note-view';
import { noteDetail } from './entity-detail.fixtures';

// NoteView owns the note's page chrome around the shared ContentEditor; the editor
// surface itself is covered by content-editor.spec.
describe('NoteView', () => {
  const note = noteDetail;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoteView, provideTranslocoTesting()],
      providers: [
        EntitySession,
        EntityNameResolver,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
  });

  it('shows the open note’s name', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lady Mara');
  });

  it('offers a way back to the library', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    const back = fixture.nativeElement.querySelector(
      '[data-testid=back-to-library]',
    ) as HTMLAnchorElement;
    expect(back).not.toBeNull();
    expect(back.getAttribute('href')).toBe('/entities');
  });

  it('mounts the shared Content editor, seeded with the note’s stored Content', () => {
    TestBed.inject(EntitySession).adopt({
      ...note('Lady Mara'),
      document: {
        type: 'note',
        content: {
          format: 'tiptap-v1',
          snapshot: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Lady Mara rules the north.' }],
              },
            ],
          },
        },
      },
    });

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    // Stored prose appearing proves NoteView wires the editor to the open note.
    expect(fixture.nativeElement.querySelector('app-content-editor')).not.toBeNull();
    const surface = fixture.nativeElement.querySelector(
      '[data-testid=note-content]',
    ) as HTMLElement;
    expect(surface.textContent).toContain('Lady Mara rules the north.');
  });

  it('mounts the tag editor for the open note', () => {
    TestBed.inject(EntitySession).adopt(note('Lady Mara'));

    const fixture = TestBed.createComponent(NoteView);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid=entity-tags]'),
    ).not.toBeNull();
  });
});
