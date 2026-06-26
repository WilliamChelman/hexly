import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail } from '@hexly/domain';
import { EntitySession } from '../editor-shell/entity-session';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { EntityTags } from './entity-tags';

describe('EntityTags', () => {
  const noteWith = (tags: string[]): EntityDetail => ({
    id: 'n1',
    ownerId: 'u1',
    name: 'Lady Mara',
    type: 'note',
    tags,
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: { type: 'note', content: { format: 'tiptap-v1', snapshot: {} } },
  });

  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityTags, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
  });

  /** Mount EntityTags over an open entity carrying `tags`. */
  function render(tags: string[]) {
    session.adopt(noteWith(tags));
    const fixture = TestBed.createComponent(EntityTags);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the open entity’s tags as chips', () => {
    const fixture = render(['deity', 'ruined']);

    const text = (
      fixture.nativeElement.querySelector(
        '[data-testid=entity-tags]',
      ) as HTMLElement
    ).textContent;
    expect(text).toContain('deity');
    expect(text).toContain('ruined');
  });

  it('removes a tag when its remove control is clicked', () => {
    const fixture = render(['deity', 'ruined']);

    (
      fixture.nativeElement.querySelector(
        '[data-testid=tag-remove-deity]',
      ) as HTMLButtonElement
    ).click();

    expect(session.tags()).toEqual(['ruined']);
  });

  /** Type into the tag input and press Enter, the way a user adds a tag. */
  function typeTag(fixture: ReturnType<typeof render>, value: string) {
    const input = fixture.nativeElement.querySelector(
      '[data-testid=tag-input]',
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    return input;
  }

  it('adds a typed tag on Enter and clears the input', () => {
    const fixture = render(['deity']);

    const input = typeTag(fixture, 'northern reach');

    expect(session.tags()).toEqual(['deity', 'northern reach']);
    expect(input.value).toBe('');
  });

  it('adds several comma-separated tags at once, trimming blanks', () => {
    const fixture = render([]);

    typeTag(fixture, ' deity , ruined , ');

    expect(session.tags()).toEqual(['deity', 'ruined']);
  });

  it('ignores a duplicate or empty entry', () => {
    const fixture = render(['deity']);

    typeTag(fixture, 'deity');
    typeTag(fixture, '   ');

    expect(session.tags()).toEqual(['deity']);
  });
});
