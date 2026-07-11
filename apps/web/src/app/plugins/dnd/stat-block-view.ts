import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FieldSchema, Metadata, readField, validateFields, writeField } from '@hexly/domain';
import {
  abilityModifier,
  DND_ABILITY_KEYS,
  DND_CHALLENGE_KEY,
  DND_DEFENCE_KEYS,
  DND_IDENTITY_KEYS,
  formatModifier,
} from '@hexly/plugins';
import { EntitySession } from '../../pages/entity/services/entity-session';
import { TypeRegistry } from '../../entity-types/type-registry';
import { StatSlot } from './stat-slot';

/** One rendered slot of the stat block: the Field to edit through, plus its live value. */
interface Slot {
  readonly field: FieldSchema;
  readonly value: unknown;
}

/**
 * The `dnd.monster` **bespoke View** (`dnd.view.stat-block`, #192): the plugin's own renderer, showing
 * a monster the way a player expects — a stat block — rather than as the prose of its Content or the
 * flat list of the generic Field view. This is the whole of what code buys a Plugin type (ADR-0048):
 * its Fields, facets, and validation already work code-lessly; the *view* is the part a plugin ships.
 *
 * It edits the very same Metadata map every other View reads — a Field is a lens, not a store — so a
 * CR typed here is the CR the Entity Browser facets on, and an instance *without* this plugin opens
 * the same monster as rich content plus the generic Field view, nothing lost (CONTEXT.md → Field).
 *
 * It prints every Field the type declares, so the block is the one place a monster is authored: a
 * reader sees the rendered stat block, a writer the same layout with each slot live ({@link StatSlot}).
 * A monster's untyped Metadata still shows in the Note view's Metadata dock, as for any Entity.
 */
@Component({
  selector: 'app-stat-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [TranslocoPipe, StatSlot],
  template: `
    <div class="absolute inset-0 overflow-y-auto bg-surface-sunken" data-testid="stat-block-view">
      <article
        class="max-w-[42rem] mx-auto my-6 rounded-md border border-line border-t-4 border-t-astra bg-surface px-6 py-5 shadow-1"
      >
        <header class="border-b border-line pb-3">
          <h1 class="m-0 font-display text-2xl text-ink-strong">{{ name() }}</h1>
          <!-- The flavour line a stat block opens with, derived from the identity Fields below rather
               than authored — so it re-reads the moment one of them is edited. -->
          <p class="m-0 text-sm italic text-ink-muted" data-testid="stat-block-subtitle">{{ subtitle() }}</p>
        </header>

        <!-- Identity (size, creature type, alignment) and defences (AC, HP, speed): one labelled row each. -->
        <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 py-3">
          @for (slot of rows(); track slot.field.key) {
            <dt class="text-sm font-semibold text-astra">{{ slot.field.label }}</dt>
            <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.key">
              <app-stat-slot
                [field]="slot.field"
                [value]="slot.value"
                [writable]="writable()"
                [invalid]="isInvalid(slot.field)"
                (valueChange)="set(slot.field, $event)"
              />
            </dd>
          }
        </dl>

        <!-- The six ability scores, each printing the modifier a player actually rolls with. -->
        <div class="grid grid-cols-6 gap-2 border-y border-line py-3 text-center">
          @for (slot of abilities(); track slot.field.key) {
            <div class="flex flex-col items-center gap-1">
              <span class="text-2xs font-semibold uppercase tracking-wider text-astra">{{ slot.field.label }}</span>
              <span class="text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.key">
                <app-stat-slot
                  [field]="slot.field"
                  [value]="slot.value"
                  [writable]="writable()"
                  [invalid]="isInvalid(slot.field)"
                  (valueChange)="set(slot.field, $event)"
                />
              </span>
              <span class="text-xs text-ink-muted" [attr.data-testid]="'stat-mod-' + slot.field.key">{{
                modifier(slot.value)
              }}</span>
            </div>
          }
        </div>

        <!-- Challenge Rating: the one required Field, and the number the Browser facets and ranges on. -->
        @if (challenge(); as cr) {
          <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 pt-3">
            <dt class="text-sm font-semibold text-astra">{{ cr.field.label }}</dt>
            <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + cr.field.key">
              <app-stat-slot
                [field]="cr.field"
                [value]="cr.value"
                [writable]="writable()"
                [invalid]="isInvalid(cr.field)"
                (valueChange)="set(cr.field, $event)"
              />
            </dd>
          </dl>
        }

        <p class="mt-4 mb-0 text-xs text-ink-muted">{{ 'plugins.dnd.monster.loreHint' | transloco }}</p>
      </article>
    </div>
  `,
})
export class StatBlockView {
  private readonly session = inject(EntitySession);
  private readonly types = inject(TypeRegistry);

  protected readonly writable = computed(() => this.session.writable());
  protected readonly name = computed(() => this.session.current()?.name ?? '');

  /** The live working Metadata — the one map the stat block is a lens over. */
  private readonly metadata = computed<Metadata>(() => this.session.body().metadata ?? {});

  /**
   * The Fields the open Entity's types declare, indexed by Metadata key. Resolved through the
   * registry rather than off the plugin's declaration directly, so a monster that *also* carries a
   * World-defined type still resolves one coherent Field set (and the primary type wins a key clash).
   */
  private readonly byKey = computed(
    () => new Map(this.types.resolveFields(this.session.types()).map((field) => [field.key, field])),
  );

  private readonly invalidKeys = computed(
    () => new Set(validateFields([...this.byKey().values()], this.metadata()).errors.map((error) => error.key)),
  );

  /** The labelled rows above the ability grid: who the monster is, then what it takes to hurt it. */
  protected readonly rows = computed(() => this.slots([...DND_IDENTITY_KEYS, ...DND_DEFENCE_KEYS]));
  protected readonly abilities = computed(() => this.slots(DND_ABILITY_KEYS));
  protected readonly challenge = computed(() => this.slots([DND_CHALLENGE_KEY])[0]);

  /**
   * The stat block's flavour line — "Large dragon, chaotic evil" — assembled from whichever identity
   * Fields are filled. A monster mid-authoring shows the parts it has rather than a line of
   * placeholder commas.
   */
  protected readonly subtitle = computed(() => {
    const [size, creatureType, alignment] = this.slots([...DND_IDENTITY_KEYS]).map((slot) => text(slot.value));
    const creature = [size, creatureType].filter(Boolean).join(' ');
    return [creature, alignment].filter(Boolean).join(', ');
  });

  /** A raw score's printed modifier (`+3`), or an em dash for an unfilled one. */
  protected modifier(value: unknown): string {
    const modifier = abilityModifier(value);
    return modifier === null ? '—' : formatModifier(modifier);
  }

  protected isInvalid(field: FieldSchema): boolean {
    return this.invalidKeys().has(field.key);
  }

  /** Write a stat back into the Metadata map through the central store — the same channel every View uses. */
  protected set(field: FieldSchema, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft) => {
      draft.metadata = writeField(draft.metadata, field, value);
    });
  }

  /**
   * The slots for the given Metadata keys, in stat-block order, skipping any the resolved Field set
   * doesn't declare — so an Entity that dropped `dnd.monster` (or an evolved plugin schema) renders
   * the stats it still has, never a control over a Field that no longer exists.
   */
  private slots(keys: readonly string[]): Slot[] {
    const byKey = this.byKey();
    return keys.flatMap((key) => {
      const field = byKey.get(key);
      return field ? [{ field, value: readField(this.metadata(), field) }] : [];
    });
  }
}

/** A Field value as the subtitle reads it: its text, or blank for an absent or ill-typed one. */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}
