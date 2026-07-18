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
  DS_CHARACTERISTIC_ABBREVIATIONS,
  DS_CHARACTERISTIC_KEYS,
  DS_DAMAGE_TYPE_OPTIONS,
  DS_DEFENCE_KEYS,
  DS_IDENTITY_KEYS,
  DS_MAP_KEYS,
  DS_STAT_BLOCK_FIELD,
  DS_STAT_FIELDS,
  DS_STAT_FIELDS_BY_KEY,
} from '@hexly/plugin-draw-steel';
import { StatSlotComponent } from './stat-slot.component';

/** One rendered slot of the stat block: the stat descriptor to edit through, its label key, and its live value. */
interface Slot {
  readonly field: Field;
  readonly labelKey: string;
  readonly value: unknown;
}

/** One damage row of an immunities/weaknesses section: the synthetic number Field, its label key, and its value. */
interface DamageEntry {
  readonly field: Field;
  readonly type: string;
  readonly labelKey: string;
}

/** An immunities/weaknesses section: the map key it writes into and its per-damage-type rows. */
interface DamageSection {
  readonly mapKey: string;
  readonly labelKey: string;
  readonly entries: readonly DamageEntry[];
}

/**
 * The `draw-steel.stat-block` data-type's View (`draw-steel.view.stat-block`, ADR-0055): a laid-out
 * Draw Steel stat block over one grouped **Structured Data Type** value. It renders whichever stat-block
 * Field placed it, reading that Field's EntityDocument key from {@link VIEW_FIELD_KEY} — so a monster's
 * `stat_block`, or the key of a `draw-steel.stat-block` Field attached to any other type, are edited here.
 *
 * The block is its Entity's only stat-authoring surface (the create dialog collects scalar required
 * Fields only, and a `draw-steel.stat-block` Field is structured), so it must offer a slot for every
 * stat: an unrendered one would be unsettable. This first pass is the numeric/identity half — Traits and
 * Abilities land in a follow-up (#242).
 */
@Component({
  selector: 'ds-stat-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto bg-surface-sunken', 'data-testid': 'stat-block-view' },
  imports: [TranslocoPipe, StatSlotComponent],
  template: `
    <article
      class="max-w-[42rem] mx-auto my-6 rounded-md border border-line border-t-4 border-t-sea bg-surface px-6 py-5 shadow-1"
    >
      <!-- The name line is the page header directly above, so the card opens on the flavour line,
           derived from the identity stats below. -->
      <p class="m-0 border-b border-line pb-3 text-sm italic text-ink-muted" data-testid="stat-block-subtitle">
        {{ subtitle() }}
      </p>

      <!-- Identity (level, role, organization, EV, keywords, size), each a labelled row. -->
      <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 py-3">
        @for (slot of identity(); track slot.field.id) {
          <dt class="text-sm font-semibold text-sea">{{ slot.labelKey | transloco }}</dt>
          <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.id">
            <ds-stat-slot
              [field]="slot.field"
              [value]="slot.value"
              [writable]="writable()"
              [invalid]="isInvalid(slot.field)"
              (valueChange)="set(slot.field, $event)"
            />
          </dd>
        }
      </dl>

      <!-- Defences and movement (stamina, stability, save threshold, speed, free strike, movement). -->
      <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0 border-t border-line py-3">
        @for (slot of defences(); track slot.field.id) {
          <dt class="text-sm font-semibold text-sea">{{ slot.labelKey | transloco }}</dt>
          <dd class="m-0 text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.id">
            <ds-stat-slot
              [field]="slot.field"
              [value]="slot.value"
              [writable]="writable()"
              [invalid]="isInvalid(slot.field)"
              (valueChange)="set(slot.field, $event)"
            />
          </dd>
        }
      </dl>

      <!-- The five characteristics, each printing its single-letter abbreviation (M/A/R/I/P). -->
      <div class="grid grid-cols-5 gap-2 border-y border-line py-3 text-center">
        @for (slot of characteristics(); track slot.field.id) {
          <div class="flex flex-col items-center gap-1">
            <span class="text-2xs font-semibold uppercase tracking-wider text-sea">{{
              abbreviation(slot.field.id)
            }}</span>
            <span class="text-sm text-ink" [attr.data-testid]="'stat-' + slot.field.id">
              <ds-stat-slot
                [field]="slot.field"
                [value]="slot.value"
                [writable]="writable()"
                [invalid]="isInvalid(slot.field)"
                (valueChange)="set(slot.field, $event)"
              />
            </span>
          </div>
        }
      </div>

      <!-- Immunities and weaknesses: a per-damage-type number under each section heading. -->
      @for (section of damageSections; track section.mapKey) {
        <section class="border-b border-line py-3" [attr.data-testid]="'section-' + section.mapKey">
          <h3 class="m-0 mb-2 text-sm font-semibold text-sea">{{ section.labelKey | transloco }}</h3>
          <dl class="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-x-4 gap-y-2 m-0">
            @for (entry of section.entries; track entry.type) {
              <dt class="text-sm text-ink-muted">{{ entry.labelKey | transloco }}</dt>
              <dd class="m-0 text-sm text-ink" [attr.data-testid]="'damage-' + section.mapKey + '-' + entry.type">
                <ds-stat-slot
                  [field]="entry.field"
                  [value]="damageValue(section.mapKey, entry.type)"
                  [writable]="writable()"
                  [invalid]="isDamageInvalid(section.mapKey, entry.type)"
                  (valueChange)="setDamage(section.mapKey, entry.type, $event)"
                />
              </dd>
            }
          </dl>
        </section>
      }

      <p class="mt-4 mb-0 text-xs text-ink-muted">{{ 'drawSteel.monster.loreHint' | transloco }}</p>
    </article>
  `,
})
export class StatBlockViewComponent {
  /** The central store every View of the open Entity reads its slice off and writes back through. */
  private readonly session = inject(ENTITY_SESSION);

  protected readonly writable = this.session.writable;

  /**
   * The stat-block Field this View renders — {@link DS_STAT_BLOCK_FIELD} re-keyed to {@link VIEW_FIELD_KEY},
   * so it lenses whichever document key the placing Field named (a monster's `stat_block`, or an
   * attachment's own key). The whole block is one value at that key (ADR-0055).
   */
  private readonly field: Field = { ...DS_STAT_BLOCK_FIELD, id: inject(VIEW_FIELD_KEY) };

  /** The live stat-block value — a lens over the one EntityDocument map, coerced to a bare record to read stats off. */
  private readonly block = computed<Record<string, unknown>>(() => asBlock(readField(this.session.doc(), this.field)));

  /** The flat inner stats failing the forward-only gate — a mistyped stat at rest, never an absent one. */
  private readonly invalidKeys = computed(
    () => new Set(validateFields(DS_STAT_FIELDS, this.block(), NO_STRUCTURED_DATA_TYPES).errors.map((e) => e.key)),
  );

  protected readonly identity = computed(() => this.slots(DS_IDENTITY_KEYS));
  protected readonly defences = computed(() => this.slots(DS_DEFENCE_KEYS));
  protected readonly characteristics = computed(() => this.slots(DS_CHARACTERISTIC_KEYS));

  /**
   * The immunities/weaknesses sections — static, since each damage type is a fixed row (its value is
   * read live from {@link damageValue}). Each row is a synthetic `number` Field the control edits through.
   */
  protected readonly damageSections: readonly DamageSection[] = DS_MAP_KEYS.map((mapKey) => ({
    mapKey,
    labelKey: `drawSteel.statBlock.section.${mapKey}`,
    entries: DS_DAMAGE_TYPE_OPTIONS.map((type) => ({
      type,
      labelKey: `drawSteel.statBlock.damage.${type}`,
      field: { id: `${mapKey}.${type}`, label: type, dataType: { kind: 'number' }, required: false, facetable: false },
    })),
  }));

  /** The flavour line ("brute, elite"), assembled from whichever identity stats read as text. */
  protected readonly subtitle = computed(() => {
    const block = this.block();
    return [text(block['role']), text(block['organization'])].filter(Boolean).join(', ');
  });

  /** The single-letter abbreviation a characteristic prints in the grid (M/A/R/I/P). */
  protected abbreviation(key: string): string {
    return DS_CHARACTERISTIC_ABBREVIATIONS[key as keyof typeof DS_CHARACTERISTIC_ABBREVIATIONS] ?? key;
  }

  protected isInvalid(field: Field): boolean {
    return this.invalidKeys().has(field.id);
  }

  /** A damage entry's live value — the number stored at `block[mapKey][type]`, or `undefined` if unset. */
  protected damageValue(mapKey: string, type: string): unknown {
    return asBlock(this.block()[mapKey])[type];
  }

  /** Flag a damage entry present at rest but not a finite number (forward-only: marked, never dropped). */
  protected isDamageInvalid(mapKey: string, type: string): boolean {
    const value = this.damageValue(mapKey, type);
    if (value === undefined || value === null) return false;
    return typeof value !== 'number' || !Number.isFinite(value);
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
      if (isEmpty(value)) delete next[stat.id];
      else next[stat.id] = value;
      writeFieldInPlace(draft, this.field, next);
    });
  }

  /**
   * Write one damage-type modifier into an immunities/weaknesses map. An emptied entry drops from the map,
   * and an emptied map drops from the block — so a cleared section leaves no `{}` husk in the frontmatter.
   */
  protected setDamage(mapKey: string, type: string, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft: EntityDocument) => {
      const next = { ...asBlock(readField(draft, this.field)) };
      const map = { ...asBlock(next[mapKey]) };
      if (isEmpty(value)) delete map[type];
      else map[type] = value;
      if (Object.keys(map).length === 0) delete next[mapKey];
      else next[mapKey] = map;
      writeFieldInPlace(draft, this.field, next);
    });
  }

  /** The slots for the given inner stat keys, in stat-block order — one per stat the block declares. */
  private slots(keys: readonly string[]): Slot[] {
    const block = this.block();
    return keys.flatMap((key) => {
      const field = DS_STAT_FIELDS_BY_KEY.get(key);
      return field ? [{ field, labelKey: field.labelKey ?? field.label, value: block[key] }] : [];
    });
  }
}

/**
 * A stat-block document value coerced to a bare record. Forward-only: a value this build cannot read as
 * a record (a scalar, an array, absent) reads as empty rather than throwing.
 */
function asBlock(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Whether a written value reads as emptied — an em-dash cell, a cleared control, an empty list. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** A stat value as the subtitle reads it: its text, or blank for an absent or ill-typed one. */
function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '';
}
