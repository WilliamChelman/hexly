import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CORE_HEXMAP, CORE_NOTE, emptyHexMap, EntityDetail } from '@hexly/domain';
import { EntitySession } from '../services/entity-session';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { EntityMetadata } from './entity-metadata';

describe('EntityMetadata', () => {
  const noteWith = (metadata?: Record<string, unknown>): EntityDetail => ({
    id: 'n1',
    worldId: 'w1',
    name: 'Lady Mara',
    types: [CORE_NOTE],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: {
      content: { format: 'tiptap-v1', snapshot: {} },
      metadata,
    },
  });

  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityMetadata, provideTranslocoTesting()],
      providers: [
        EntitySession,
        { provide: ENTITY_SESSION, useExisting: EntitySession },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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

  it('skips a Structured Field’s value — a Hex Map’s grid is not a Metadata row (ADR-0050)', () => {
    // The grid lives at a Metadata key like every other Field value, but it is a document with its
    // own View: dumping it here as a line of JSON would tell the reader nothing. A Hex Map carrying
    // nothing else therefore shows no disclosure at all, exactly as before the grid moved.
    session.adopt({ ...noteWith({ grid: emptyHexMap() }), types: [CORE_HEXMAP] });
    const fixture = TestBed.createComponent(EntityMetadata);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });
});
