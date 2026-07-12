import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FieldSchema, Metadata, readField, validateFields, writeField } from '@hexly/domain';
import { ENTITY_SESSION } from '@hexly/web-entity';
import {
  abilityModifier,
  DND_ABILITY_KEYS,
  DND_CHALLENGE_KEY,
  DND_DEFENCE_KEYS,
  DND_IDENTITY_KEYS,
  DND_MONSTER_TYPE,
  formatModifier,
} from '../lib/monster';
import { StatSlot } from './stat-slot';

/** One rendered slot of the stat block: the Field to edit through, plus its live value. */
interface Slot {
  readonly field: FieldSchema;
  readonly value: unknown;
}

/** The plugin's declared Fields, by Metadata key — the block renders its own type, so it needs no registry. */
const FIELDS_BY_KEY = new Map(DND_MONSTER_TYPE.fields.map((field) => [field.key, field]));

/**
 * The `dnd.monster` **bespoke View** (`dnd.view.stat-block`, #192): the plugin's own renderer, showing
 * a monster the way a player expects — a stat block — rather than as the prose of its Content or the
 * flat list of the generic Field view. This is the whole of what code buys a Plugin type (ADR-0048):
 * a type's Fields, facets, and validation already work code-lessly; the *view* is the part a plugin
 * ships.
 *
 * It edits the very same Metadata map every other View reads — a Field is a lens, not a store — so a
 * CR typed here is the CR the Entity Browser facets on, and an instance *without* this plugin opens
 * the same monster as rich content plus the generic Field view, nothing lost (CONTEXT.md → Field).
 *
 * It prints every Field the type declares, so the block is the one place a monster is authored: a
 * reader sees the rendered stat block, a writer the same layout with each slot live ({@link StatSlot}).
 * A monster's *untyped* Metadata still shows in the Note view's Metadata dock, as for any Entity.
 *
 * Its only couplings are the {@link ENTITY_SESSION} contract and `@hexly/web-entity`'s `FieldControl`
 * — never `apps/web` — so the app *composes* this plugin rather than hosting it (the ADR-0048
 * inversion, the same one `MapView` rides).
 */
@Component({
  selector: 'dnd-stat-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The View fills the page's body cell and scrolls within it — the frame around it (header, nav) must
  // not scroll away. `h-full` resolves against that cell, which the page's grid row sizes.
  host: { class: 'block h-full overflow-y-auto bg-surface-sunken', 'data-testid': 'stat-block-view' },
  imports: [TranslocoPipe, StatSlot],
  template: `
    <article
      class="max-w-[42rem] mx-auto my-6 rounded-md border border-line border-t-4 border-t-astra bg-surface px-6 py-5 shadow-1"
    >
      <!-- A stat block's name line is the page header directly above, so the card opens on the flavour
           line beneath it — derived from the identity Fields, so it re-reads as they are edited. -->
      <p class="m-0 border-b border-line pb-3 text-sm italic text-ink-muted" data-testid="stat-block-subtitle">
        {{ subtitle() }}
      </p>

      <!-- Identity (size, creature type, alignment) and defences (AC, HP, speed): one labelled row each. -->
      <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 py-3">
        @for (slot of rows(); track slot.field.key) {
          <dt class="text-sm font-semibold text-astra">{{ slot.field.label }}</dt>
          <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.key">
            <dnd-stat-slot
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
              <dnd-stat-slot
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
            <dnd-stat-slot
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
  `,
})
export class StatBlockView {
  /** The central store every View of the open Entity reads its slice off and writes back through. */
  private readonly session = inject(ENTITY_SESSION);

  protected readonly writable = this.session.writable;

  /** The live working Metadata — the one map the stat block is a lens over. */
  private readonly metadata = computed<Metadata>(() => this.session.body().metadata ?? {});

  private readonly invalidKeys = computed(
    () => new Set(validateFields(DND_MONSTER_TYPE.fields, this.metadata()).errors.map((error) => error.key)),
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
    const [size, creatureType, alignment] = DND_IDENTITY_KEYS.map((key) => text(this.metadata()[key]));
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

  /** The slots for the given Metadata keys, in stat-block order — one per Field the type declares. */
  private slots(keys: readonly string[]): Slot[] {
    return keys.flatMap((key) => {
      const field = FIELDS_BY_KEY.get(key);
      return field ? [{ field, value: readField(this.metadata(), field) }] : [];
    });
  }
}

/** A Field value as the subtitle reads it: its text, or blank for an absent or ill-typed one. */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}
