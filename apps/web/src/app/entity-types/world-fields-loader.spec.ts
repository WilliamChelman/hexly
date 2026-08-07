import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { Field, defineField } from '@hexly/domain';
import { ActiveWorld, Logger, WorldsClient } from '@hexly/web-core';
import { WorldFieldsLoader } from './world-fields-loader';
import { TypeRegistry } from './type-registry';

describe('WorldFieldsLoader', () => {
  const cr = defineField({ id: 'world.field.cr', label: 'CR', dataType: { kind: 'number' }, facetable: true });

  let worldId: ReturnType<typeof signal<string | null>>;
  let fields: ReturnType<typeof vi.fn>;
  let registry: TypeRegistry;

  beforeEach(() => {
    worldId = signal<string | null>(null);
    fields = vi.fn(() => of<Field[]>([]));
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        { provide: ActiveWorld, useValue: { worldId } },
        { provide: WorldsClient, useValue: { fields } },
        { provide: Logger, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  /** Instantiate the loader and let its World-change stream emit. */
  function load(): void {
    TestBed.inject(WorldFieldsLoader);
    TestBed.flushEffects();
  }

  it('leaves a Facet key unsettled from before the first parse until the read answers (ADR-0082)', () => {
    fields.mockReturnValue(NEVER); // in flight
    worldId.set('w1');
    load();

    expect(registry.fieldsResolved()).toBe(false);
    expect(registry.facetKeySettled('world.field.cr')).toBe(false);
    // A reserved name never waits on it — a browse naming no Field key loads at once.
    expect(registry.facetKeySettled('type')).toBe(true);
  });

  it('settles the vocabulary when the World’s Fields land', () => {
    fields.mockReturnValue(of([cr]));
    worldId.set('w1');
    load();

    expect(registry.fieldsResolved()).toBe(true);
    expect(registry.facetKeys()).toContain('world.field.cr');
  });

  /**
   * The failure path a held read hangs on: every surface that waits on {@link TypeRegistry.fieldsResolved}
   * before fetching (the three browses, the Palette) would show an empty grid forever if a refused or
   * broken Fields read left the registry awaiting. It degrades to no World Fields instead, so the wait
   * always ends and the key settles — as a miss, which is then honestly reported.
   */
  it('settles the vocabulary when the Fields read fails, so nothing waits on it forever', () => {
    fields.mockReturnValue(throwError(() => new Error('offline')));
    worldId.set('w1');
    load();

    expect(registry.fieldsResolved()).toBe(true);
    expect(registry.facetKeySettled('world.field.cr')).toBe(true);
    expect(registry.facetKeys()).not.toContain('world.field.cr');
  });

  it('settles the vocabulary with no World to read Fields for', () => {
    load();

    expect(registry.fieldsResolved()).toBe(true);
  });

  it('re-opens the wait on a World change, and closes it on that World’s answer', () => {
    fields.mockReturnValue(of([cr]));
    worldId.set('w1');
    load();
    expect(registry.fieldsResolved()).toBe(true);

    // A World change reopens the gap: one World's vocabulary may not settle a question about another's.
    const second = new Subject<Field[]>();
    fields.mockReturnValue(second);
    worldId.set('w2');
    TestBed.flushEffects();
    expect(registry.fieldsResolved()).toBe(false);

    second.next([]);

    expect(registry.fieldsResolved()).toBe(true);
    expect(registry.facetKeys()).not.toContain('world.field.cr');
  });
});
