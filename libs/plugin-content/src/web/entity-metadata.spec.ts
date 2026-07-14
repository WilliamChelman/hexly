import { TestBed } from '@angular/core/testing';
import { EntityDetail, FieldSchema } from '@hexly/domain';
import { TypeDefinition } from '@hexly/web-entity';
import { FakeEntitySession, provideFakeEntitySession, provideEntityTypesTesting } from '@hexly/web-entity/testing';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '../i18n/test-catalogs';
import { CONTENT_FIELD, CORE_NOTE } from '../lib';
import { EntityMetadata } from './entity-metadata';

/**
 * {@link EntityMetadata} reads the open Entity's document off `ENTITY_SESSION.current` and its declared
 * Fields off `ENTITY_TYPES.resolveFields` (ADR-0051), so these specs drive the two contracts' fakes — no
 * `apps/web` session and no map plugin.
 */

/**
 * A stand-in structured Field: any `namespace.id` kind is structured (ADR-0050), so `test.grid` stands
 * for a registered structured Field the panel must skip — its value is a document with its own View —
 * without pulling in the map plugin.
 */
const GRID_FIELD: FieldSchema = {
  key: 'grid',
  label: 'Grid',
  dataType: { kind: 'test.grid' },
  required: false,
  facetable: false,
};

/** `core.note`, as the plugin registers it: its one canonical prose Field. */
const NOTE_TYPE: TypeDefinition = {
  id: CORE_NOTE,
  icon: 'label',
  views: [{ field: CONTENT_FIELD.key }],
  fields: [CONTENT_FIELD],
  graphColorToken: '--color-ink-muted',
  labels: {
    eyebrow: 'x',
    titleLabel: 'x',
    rename: 'x',
    editorLabel: 'x',
    create: 'x',
    untitled: 'x',
  },
};

/** A grid-carrying type — prose beside a Structured Field, both of which the panel skips. */
const MAP_TYPE: TypeDefinition = { ...NOTE_TYPE, id: 'core.hexmap', fields: [CONTENT_FIELD, GRID_FIELD] };

const noteWith = (types: readonly string[], metadata?: Record<string, unknown>): EntityDetail => ({
  id: 'n1',
  worldId: 'w1',
  name: 'Lady Mara',
  types,
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

describe('EntityMetadata', () => {
  let session: FakeEntitySession;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityMetadata, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
      providers: [provideFakeEntitySession(), provideEntityTypesTesting([NOTE_TYPE, MAP_TYPE])],
    }).compileComponents();
    session = TestBed.inject(FakeEntitySession);
  });

  function render(metadata?: Record<string, unknown>) {
    session.loadDetail(noteWith([CORE_NOTE], metadata));
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
    // Only the prose Field's value sits in the document, and it is skipped as a Structured Field's.
    expect(render(undefined).querySelector('[data-testid=entity-metadata]')).toBeNull();
    expect(render({}).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });

  it('skips a Structured Field’s value — a grid is not a EntityDocument row (ADR-0050)', () => {
    // The grid lives at a EntityDocument key like every other Field value, but it is a document with
    // its own View: dumping it here as a line of JSON would tell the reader nothing. A type carrying
    // nothing but Structured Fields therefore shows no disclosure at all.
    session.loadDetail(noteWith(['core.hexmap'], { grid: { hexes: {} } }));
    const fixture = TestBed.createComponent(EntityMetadata);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid=entity-metadata]')).toBeNull();
  });
});

/**
 * With no map plugin, `core.hexmap` is unregistered: it types no key, so the grid is not a Field at
 * all and falls through to plain EntityDocument — shown rather than skipped (ADR-0048).
 */
describe('EntityMetadata without the Hex Map plugin', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityMetadata, provideTranslocoTesting(CONTENT_EDITOR_TEST_CATALOGS)],
      // Only `core.note` is registered; `core.hexmap` resolves no Fields.
      providers: [provideFakeEntitySession(), provideEntityTypesTesting([NOTE_TYPE])],
    }).compileComponents();
  });

  it('shows a Hex Map’s grid as plain EntityDocument — an unrendered value, never a lost one', () => {
    TestBed.inject(FakeEntitySession).loadDetail(noteWith(['core.hexmap'], { grid: { hexes: {} }, status: 'canon' }));
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
