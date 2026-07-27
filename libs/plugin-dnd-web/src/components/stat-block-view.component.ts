import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  EntityDocument,
  Field,
  NO_STRUCTURED_DATA_TYPES,
  readField,
  validateFields,
  writeFieldInPlace,
} from '@hexly/domain';
import { ENTITY_SESSION, VIEW_FIELD_KEY } from '@hexly/web-entity';
import {
  abilityModifier,
  DND_ABILITY_KEYS,
  DND_CHALLENGE_KEY,
  DND_DEFENCE_KEYS,
  DND_IDENTITY_KEYS,
  DND_STAT_BLOCK_FIELD,
  DND_STAT_FIELDS,
  DND_STAT_FIELDS_BY_KEY,
  formatModifier,
} from '@hexly/plugin-dnd';
import { StatSlotComponent } from './stat-slot.component';

/** One rendered slot of the stat block: the stat descriptor to edit through, plus its live value. */
interface Slot {
  readonly field: Field;
  readonly value: unknown;
}

/**
 * The `dnd.datatype.stat-block` data-type's View (`dnd.view.stat-block`, ADR-0055): a laid-out stat block over
 * one grouped **Structured Data Type** value. It renders whichever stat-block Field placed it, reading
 * that Field's EntityDocument key from {@link VIEW_FIELD_KEY} — so a monster's `dnd.field.stat-block`, or the key of
 * a `dnd.datatype.stat-block` Field attached to any other type or a single Entity, are all edited here (ADR-0054).
 *
 * The block is its Entity's only stat-authoring surface (the create dialog collects scalar required
 * Fields only, and a `dnd.datatype.stat-block` Field is structured), so it must offer a slot for every stat: an
 * unrendered one would be unsettable.
 */
@Component({
  selector: 'dnd-stat-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Fills the page's body cell and scrolls within it, so the header and nav around it never scroll
  // away. `h-full` resolves against that cell, which the page's grid row sizes.
  host: { class: 'block h-full overflow-y-auto bg-surface-sunken', 'data-testid': 'stat-block-view' },
  imports: [TranslocoPipe, StatSlotComponent],
  template: `
    <article
      class="max-w-[42rem] mx-auto my-6 rounded-md border border-line border-t-4 border-t-tone-5 bg-surface px-6 py-5 shadow-1"
    >
      <!-- The name line is the page header directly above, so the card opens on the flavour line,
           derived from the identity stats below. -->
      <p class="m-0 border-b border-line pb-3 text-sm italic text-ink-muted" data-testid="stat-block-subtitle">
        {{ subtitle() }}
      </p>

      <!-- Identity (size, creature type, alignment) and defences (AC, HP, speed): one labelled row each. -->
      <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 py-3">
        @for (slot of rows(); track slot.field.id) {
          <dt class="text-sm font-semibold text-tone-5">{{ slot.field.label }}</dt>
          <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.id">
            <dnd-stat-slot
              [field]="slot.field"
              [value]="slot.value"
              [writable]="writable()"
              [invalid]="isFlagged(slot.field)"
              (valueChange)="set(slot.field, $event)"
            />
          </dd>
        }
      </dl>

      <!-- The six ability scores, each printing the modifier a player rolls with. -->
      <div class="grid grid-cols-6 gap-2 border-y border-line py-3 text-center">
        @for (slot of abilities(); track slot.field.id) {
          <div class="flex flex-col items-center gap-1">
            <span class="text-2xs font-semibold uppercase tracking-wider text-tone-5">{{ slot.field.label }}</span>
            <span class="text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.id">
              <dnd-stat-slot
                [field]="slot.field"
                [value]="slot.value"
                [writable]="writable()"
                [invalid]="isFlagged(slot.field)"
                (valueChange)="set(slot.field, $event)"
              />
            </span>
            <span class="text-xs text-ink-muted" [attr.data-testid]="'stat-mod-' + slot.field.id">{{
              modifier(slot.value)
            }}</span>
          </div>
        }
      </div>

      <!-- Challenge Rating: the number the Browser ranges on, harvested with its numeric num (ADR-0055). -->
      @if (challenge(); as cr) {
        <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 pt-3">
          <dt class="text-sm font-semibold text-tone-5">{{ cr.field.label }}</dt>
          <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + cr.field.id">
            <dnd-stat-slot
              [field]="cr.field"
              [value]="cr.value"
              [writable]="writable()"
              [invalid]="isFlagged(cr.field)"
              (valueChange)="set(cr.field, $event)"
            />
          </dd>
        </dl>
      }

      <p class="mt-4 mb-0 text-xs text-ink-muted">{{ 'dnd.monster.loreHint' | transloco }}</p>
    </article>
  `,
})
export class StatBlockViewComponent {
  /** The central store every View of the open Entity reads its slice off and writes back through. */
  private readonly session = inject(ENTITY_SESSION);

  protected readonly writable = this.session.writable;

  /**
   * The stat-block Field this View renders — {@link DND_STAT_BLOCK_FIELD} re-keyed to {@link VIEW_FIELD_KEY},
   * so it lenses whichever document key the placing Field named (a monster's `dnd.field.stat-block`, or an
   * attachment's own key). The whole block is one value at that key (ADR-0055).
   */
  private readonly field: Field = { ...DND_STAT_BLOCK_FIELD, id: inject(VIEW_FIELD_KEY) };

  /** The live stat-block value — a lens over the one EntityDocument map, coerced to a bare record to read stats off. */
  private readonly block = computed<Record<string, unknown>>(() => asBlock(readField(this.session.doc(), this.field)));

  /**
   * The inner stats the forward-only gate reads as unfilled or mistyped — both channels, permanently: an
   * empty slot inside a structured View flags the block, it never gates the save (ADR-0074).
   */
  private readonly flaggedKeys = computed(() => {
    const reading = validateFields(DND_STAT_FIELDS, this.block(), NO_STRUCTURED_DATA_TYPES);
    return new Set([...reading.errors, ...reading.incomplete].map((e) => e.key));
  });

  /** The labelled rows above the ability grid: the identity stats, then the defences. */
  protected readonly rows = computed(() => this.slots([...DND_IDENTITY_KEYS, ...DND_DEFENCE_KEYS]));
  protected readonly abilities = computed(() => this.slots(DND_ABILITY_KEYS));
  protected readonly challenge = computed(() => this.slots([DND_CHALLENGE_KEY])[0]);

  /** The flavour line ("Large dragon, chaotic evil"), assembled from whichever identity stats are filled. */
  protected readonly subtitle = computed(() => {
    const block = this.block();
    const [size, creatureType, alignment] = DND_IDENTITY_KEYS.map((key) => text(block[key]));
    const creature = [size, creatureType].filter(Boolean).join(' ');
    return [creature, alignment].filter(Boolean).join(', ');
  });

  /** A raw score's printed modifier (`+3`), or an em dash for an unfilled one. */
  protected modifier(value: unknown): string {
    const modifier = abilityModifier(value);
    return modifier === null ? '—' : formatModifier(modifier);
  }

  protected isFlagged(field: Field): boolean {
    return this.flaggedKeys().has(field.id);
  }

  /**
   * Write a stat back into the block, then the whole block back into the EntityDocument at the Field's one
   * key — through the central store, the channel every View uses (ADR-0055). An emptied stat drops from
   * the block; the block itself stays (an empty object is not a cleared key), so the Field's slice persists.
   */
  protected set(stat: Field, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft: EntityDocument) => {
      const next = { ...asBlock(readField(draft, this.field)) };
      if (value === undefined || value === null || value === '') delete next[stat.id];
      else next[stat.id] = value;
      writeFieldInPlace(draft, this.field, next);
    });
  }

  /** The slots for the given inner stat keys, in stat-block order — one per stat the block declares. */
  private slots(keys: readonly string[]): Slot[] {
    const block = this.block();
    return keys.flatMap((key) => {
      const field = DND_STAT_FIELDS_BY_KEY.get(key);
      return field ? [{ field, value: block[key] }] : [];
    });
  }
}

/**
 * A stat-block document value coerced to a bare record. Forward-only: a value this build cannot read as
 * a block (a scalar, an array, absent) reads as empty rather than throwing.
 */
function asBlock(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A stat value as the subtitle reads it: its text, or blank for an absent or ill-typed one. */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}
