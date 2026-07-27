import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { typeTone } from '@hexly/web-entity';
import { providePluginContent } from '@hexly/plugin-content/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { providePluginBoard } from '@hexly/plugin-board/web';
import { providePluginAsset } from '@hexly/plugin-asset/web';
import { providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginDrawSteel } from '@hexly/plugin-draw-steel/web';
import { TypeRegistry } from './type-registry';

/**
 * The tone every shipped Entity Type wears, read across all six plugins at once — the reading no
 * single plugin's own spec can make, because a collision is by definition a fact about two of them
 * (ADR-0075).
 *
 * Composed from the same `providePluginX()` set `app.config.ts` uses, so the registry holds exactly
 * the types a real build registers; the app authors none of its own (ADR-0051).
 */
describe('the tones the shipped Entity Types wear', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        providePluginBoard(),
        providePluginAsset(),
        providePluginDnd(),
        providePluginDrawSteel(),
      ],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  /**
   * Eight tones and a handful of types, so a collision is never forced — two chips that render alike
   * are a defect a reader sees, not a theoretical one. This is what makes the need to pin *loud*: a new
   * plugin whose id hashes onto a taken tone fails here rather than quietly looking like another type.
   */
  it('are mutually distinct, so no two type chips render alike', () => {
    const byTone = new Map<string, string[]>();
    for (const def of registry.all()) {
      const tone = typeTone(def);
      byTone.set(tone, [...(byTone.get(tone) ?? []), def.id]);
    }
    const collisions = [...byTone].filter(([, ids]) => ids.length > 1);
    expect(
      collisions.map(([tone, ids]) => `${tone}: ${ids.join(', ')}`),
      'pin one of these with `tone:` on its TypeDefinition',
    ).toEqual([]);
  });

  /** The map itself, so a diff says which type changed colour rather than only that one did. */
  it('are the ones this build ships', () => {
    expect(Object.fromEntries(registry.all().map((def) => [def.id, typeTone(def)]))).toEqual({
      // Derived from the id — nothing pinned these.
      'core.type.note': 'tone-5',
      'core.type.hex-map': 'tone-3',
      'core.type.board': 'tone-1',
      'core.type.asset': 'tone-2',
      // Pinned, each off a tone a core type already held. Their definitions say why.
      'dnd.type.monster': 'tone-6',
      'draw-steel.type.monster': 'tone-4',
    });
  });
});
