import { provideTranslocoTesting } from '../../../../testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail } from '@hexly/domain';
import { CORE_NOTE } from '@hexly/plugin-content';
import { CORE_HEXMAP, emptyHexMap } from '@hexly/plugin-hexmap';
import { EntitySession } from '../services/entity-session';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
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
      ...metadata,
    },
  });

  let session: EntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityMetadata, provideTranslocoTesting()],
      providers: [
        providePluginHexmap(),
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

  it('lists the open entity’s EntityDocument keys and values, including hexly.sourcePath', () => {
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

  it('renders nothing when the entity has no EntityDocument', () => {
    expect(render(undefined).querySelector('[data-testid=entity-metadata]')).toBeNull();
    expect(render({}).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });

  it('skips a Structured Field’s value — a Hex Map’s grid is not a EntityDocument row (ADR-0050)', () => {
    // The grid lives at a EntityDocument key like every other Field value, but it is a document with its
    // own View: dumping it here as a line of JSON would tell the reader nothing. A Hex Map carrying
    // nothing else therefore shows no disclosure at all, exactly as before the grid moved.
    session.adopt({ ...noteWith({ grid: emptyHexMap() }), types: [CORE_HEXMAP] });
    const fixture = TestBed.createComponent(EntityMetadata);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });
});

/**
 * With no map plugin, `core.hexmap` types no key: the grid is not a Field at all, so it falls through
 * to plain EntityDocument and is shown rather than skipped as a Structured Field's value (ADR-0048).
 */
describe('EntityMetadata without the Hex Map plugin', () => {
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
  });

  it('shows a Hex Map’s grid as plain EntityDocument — an unrendered value, never a lost one', () => {
    TestBed.inject(EntitySession).adopt({
      id: 'm1',
      worldId: 'w1',
      name: 'Aldermoor',
      types: [CORE_HEXMAP],
      tags: [],
      visibility: 'private',
      version: 1,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      document: {
        content: { format: 'tiptap-v1', snapshot: {} },
        grid: emptyHexMap(),
        status: 'canon',
      },
    });
    const fixture = TestBed.createComponent(EntityMetadata);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The dock renders, and the grid is one of its rows: the map's data is still there to read, and
    // to export.
    expect(el.querySelector('[data-testid=entity-metadata]')).not.toBeNull();
    expect(el.textContent).toContain('grid');
    expect(el.textContent).toContain('status');
  });
});
