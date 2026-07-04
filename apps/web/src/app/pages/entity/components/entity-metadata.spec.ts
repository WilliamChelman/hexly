import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail } from '@hexly/domain';
import { EntitySession } from '../services/entity-session';
import { provideTranslocoTesting } from '../../../core/i18n/transloco-testing';
import { EntityMetadata } from './entity-metadata';

describe('EntityMetadata', () => {
  const noteWith = (metadata?: Record<string, unknown>): EntityDetail => ({
    id: 'n1',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'Lady Mara',
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {
      type: 'note',
      content: { format: 'tiptap-v1', snapshot: {} },
      metadata,
    },
  });

  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityMetadata, provideTranslocoTesting()],
      providers: [EntitySession, provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    session = TestBed.inject(EntitySession);
  });

  function render(metadata?: Record<string, unknown>) {
    session.adopt(noteWith(metadata));
    const fixture = TestBed.createComponent(EntityMetadata);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists the open entity’s Metadata keys and values, including hexly.sourcePath', () => {
    const el = render({
      status: 'canon',
      aliases: ['Mara', 'Lady Mara'],
      'hexly.sourcePath': 'people/mara.md',
    });

    const text = el.querySelector('[data-testid=entity-metadata]')?.textContent ?? '';
    expect(text).toContain('status');
    expect(text).toContain('canon');
    expect(text).toContain('hexly.sourcePath');
    expect(text).toContain('people/mara.md');
    // Array values are stringified, not silently dropped.
    expect(text).toContain('Mara');
  });

  it('renders read-only — no inputs or editable controls', () => {
    const el = render({ status: 'canon' });

    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('[contenteditable]')).toBeNull();
  });

  it('renders nothing when the entity has no Metadata', () => {
    expect(render(undefined).querySelector('[data-testid=entity-metadata]')).toBeNull();
    expect(render({}).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });
});
