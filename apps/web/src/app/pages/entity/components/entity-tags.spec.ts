import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail } from '@hexly/domain';
import { of } from 'rxjs';
import { EntitySession } from '../services/entity-session';
import { EntitiesClient } from '../../../core/services/entities.client';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntityTags } from './entity-tags';

describe('EntityTags', () => {
  const noteWith = (tags: string[]): EntityDetail => ({
    id: 'n1',
    ownerId: 'u1',
    worldId: 'w1',
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
  let vocab: string[];

  beforeEach(async () => {
    vocab = ['deity', 'demigod', 'ruined'];
    await TestBed.configureTestingModule({
      imports: [EntityTags, provideTranslocoTesting()],
      providers: [
        EntitySession,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
    // The picker's vocabulary comes from the owner's DISTINCT tags; stub it.
    vi.spyOn(TestBed.inject(EntitiesClient), 'listTags').mockImplementation(() =>
      of(vocab),
    );
  });

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

  async function queryInput(
    fixture: ReturnType<typeof render>,
    value: string,
  ): Promise<HTMLInputElement> {
    const input = fixture.nativeElement.querySelector(
      '[data-testid=tag-input]',
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    return input;
  }

  const optionFor = (fixture: ReturnType<typeof render>, tag: string) =>
    fixture.nativeElement.querySelector(`[data-testid="tag-picker-option-${tag}"]`);

  it('suggests matching vocabulary tags, excluding those already on the entity', async () => {
    const fixture = render(['deity']);

    await queryInput(fixture, 'de');

    expect(optionFor(fixture, 'demigod')).toBeTruthy();
    expect(optionFor(fixture, 'deity')).toBeFalsy(); // already added
    expect(optionFor(fixture, 'ruined')).toBeFalsy(); // no substring match
  });

  it('adds a suggestion as a chip and clears the input when clicked', async () => {
    const fixture = render([]);

    const input = await queryInput(fixture, 'demi');
    (optionFor(fixture, 'demigod') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(session.tags()).toEqual(['demigod']);
    expect(input.value).toBe('');
  });

  it('commits a keyboard-navigated suggestion on Enter (menu wins)', async () => {
    const fixture = render([]);

    // Row 0 is the "create de" row; ArrowDown moves onto the first vocab match.
    const input = await queryInput(fixture, 'de');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(session.tags()).toEqual(['deity']);
  });

  it('adds a brand-new tag via the create row on Enter', async () => {
    const fixture = render([]);

    const input = await queryInput(fixture, 'undead');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(session.tags()).toEqual(['undead']);
  });

  it('splits comma-separated text committed through the create row on Enter', async () => {
    const fixture = render([]);

    // Paste of multiple tags opens a single create row; Enter routes through commit(),
    // which must still comma-split rather than store one malformed combined tag.
    const input = await queryInput(fixture, 'orc, goblin, troll');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(session.tags()).toEqual(['orc', 'goblin', 'troll']);
  });

  it('lets Tab move focus without committing the highlighted suggestion', async () => {
    const fixture = render([]);

    const input = await queryInput(fixture, 'de');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    fixture.detectChanges();

    expect(session.tags()).toEqual([]);
  });
});
