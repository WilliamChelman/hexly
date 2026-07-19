import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconButtonComponent, IconComponent } from '@hexly/web-ui';
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
  DsCharacteristicKey,
  DS_DAMAGE_TYPE_OPTIONS,
  DS_MAP_KEYS,
  DS_STAT_BLOCK_FIELD,
  DS_STAT_FIELDS,
  DS_STAT_FIELDS_BY_KEY,
} from '@hexly/plugin-draw-steel';
import { StatSlotComponent } from './stat-slot.component';
import { StatControlComponent } from './stat-control.component';
import { DamageMapComponent } from './damage-map.component';
import { TraitsSectionComponent } from './traits-section.component';
import { AbilitiesSectionComponent } from './abilities-section.component';
import { dsIcon } from '../ds-glyphs';

/**
 * The `draw-steel.stat-block` data-type's View (`draw-steel.view.stat-block`, ADR-0055): the Draw Steel
 * stat-block card over one grouped **Structured Data Type** value. It renders whichever stat-block Field
 * placed it, reading that Field's EntityDocument key from {@link VIEW_FIELD_KEY} — so a monster's
 * `stat_block`, or the key of a `draw-steel.stat-block` Field attached to any other type, is edited here.
 *
 * One card, edited in place (not two layouts): the **Bestiary Spread** — a serif header band with an EV
 * plate, a left spec-sheet rail whose stats carry Lucide glyphs, the M·A·R·I·P characteristic glyphs,
 * immunity/weakness, then the active **Abilities** (#246) and passive **Traits** (#245) sections as flowing
 * prose. {@link edit} (gated on {@link EntitySession.writable}) swaps each printed value for its control
 * *in place* — the same `[writable]` toggle the Abilities/Traits sections already use — rather than routing
 * to a second card. In edit the rail also reveals the slots read hides (empty movement, the minion captain
 * line) and immunity/weakness become the compact per-type editor, so every flat stat stays settable.
 *
 * The block is the Entity's only stat-authoring surface (the create dialog collects scalar required Fields
 * only, and a `draw-steel.stat-block` Field is structured), so every flat stat must have a slot in the edit
 * form — an unrendered one would be unsettable.
 */
@Component({
  selector: 'ds-stat-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto bg-surface-sunken', 'data-testid': 'stat-block-view' },
  imports: [
    TranslocoPipe,
    StatSlotComponent,
    StatControlComponent,
    DamageMapComponent,
    TraitsSectionComponent,
    AbilitiesSectionComponent,
    IconComponent,
    IconButtonComponent,
  ],
  template: `
    <!-- One "Bestiary Spread", not two cards: read prints it; edit reveals a control *in place* of each value
         (the abilities/traits sections already work this way). Every flat stat keeps a rendered slot in edit,
         so none is unsettable (ADR-0055); editing is gated on EntitySession.writable via {@link edit}. -->
    <article
      class="mx-auto my-6 max-w-[50rem] rounded-md border border-line-strong bg-surface-raised px-8 py-7 shadow-1"
    >
      <header class="border-b-2 border-ink-strong pb-3">
        @if (edit()) {
          <!-- Identity, in place: the Level · organization · role sentence becomes its three controls. -->
          <div class="flex flex-wrap items-center gap-1.5 text-sm">
            <span class="text-ink-muted">{{ 'drawSteel.statBlock.stat.level' | transloco }}</span>
            <span class="w-14" data-testid="stat-level">
              <ds-stat-control
                [field]="field('level')"
                [value]="value('level')"
                [invalid]="invalidKey('level')"
                (valueChange)="setByKey('level', $event)"
              />
            </span>
            <span data-testid="stat-organization">
              <ds-stat-control
                [field]="field('organization')"
                [value]="value('organization')"
                [invalid]="invalidKey('organization')"
                (valueChange)="setByKey('organization', $event)"
              />
            </span>
            <span data-testid="stat-role">
              <ds-stat-control
                [field]="field('role')"
                [value]="value('role')"
                [invalid]="invalidKey('role')"
                (valueChange)="setByKey('role', $event)"
              />
            </span>
          </div>
        } @else {
          <p
            class="m-0 text-xs font-semibold uppercase tracking-[0.35em] text-gold-deep"
            data-testid="stat-block-identity"
          >
            {{ 'drawSteel.statBlock.stat.level' | transloco }} {{ display('level') }}
            {{ titleCase(text('organization')) }} {{ titleCase(text('role')) }}
          </p>
        }
        <div class="mt-1 flex items-end justify-between gap-4">
          <div class="flex min-w-0 items-center gap-2">
            <h2 class="m-0 truncate font-serif text-4xl font-bold italic text-ink-strong" data-testid="stat-block-name">
              {{ name() || ('drawSteel.monster.untitled' | transloco) }}
            </h2>
            @if (writable()) {
              <!-- One toggle for both directions — pencil to start, check to finish. -->
              <button
                appIconButton
                toggle
                size="sm"
                [active]="editing()"
                data-testid="stat-block-edit-toggle"
                [title]="
                  (editing() ? 'drawSteel.statBlock.doneEditing' : 'drawSteel.statBlock.startEditing') | transloco
                "
                [attr.aria-label]="
                  (editing() ? 'drawSteel.statBlock.doneEditing' : 'drawSteel.statBlock.startEditing') | transloco
                "
                (click)="editing.set(!editing())"
              >
                <app-icon [name]="editing() ? 'check' : 'pencil'" [size]="16" />
              </button>
            }
          </div>
          <div
            class="shrink-0 rounded border border-gold/40 bg-gold-soft px-2.5 py-1 text-center leading-none text-gold-deep"
          >
            <div class="text-2xs font-bold uppercase tracking-widest">
              {{ 'drawSteel.statBlock.stat.ev' | transloco }}
            </div>
            @if (edit()) {
              <span class="mt-0.5 block w-16" data-testid="stat-ev">
                <ds-stat-control
                  [field]="field('ev')"
                  [value]="value('ev')"
                  [invalid]="invalidKey('ev')"
                  (valueChange)="setByKey('ev', $event)"
                />
              </span>
            } @else {
              <div class="text-xl font-black">{{ display('ev') }}</div>
            }
            @if (isMinion()) {
              <div class="text-[9px] uppercase opacity-80">{{ 'drawSteel.statBlock.evForMinions' | transloco }}</div>
            }
          </div>
        </div>
        @if (edit()) {
          <div class="mt-1.5" data-testid="stat-keywords">
            <ds-stat-control
              [field]="field('keywords')"
              [value]="value('keywords')"
              [invalid]="invalidKey('keywords')"
              [placeholderKey]="'drawSteel.statBlock.addKeyword'"
              (valueChange)="setByKey('keywords', $event)"
            />
          </div>
        } @else {
          <p class="m-0 mt-0.5 font-serif text-base italic text-ink-muted" data-testid="stat-keywords">
            {{ keywordsText() || '—' }}
          </p>
        }
      </header>

      <div class="mt-5 grid gap-7 md:grid-cols-[15rem_1fr]">
        <!-- Left rail: the spec sheet (glyph-labelled), the characteristic grid, and immunity/weakness. -->
        <aside class="space-y-4">
          <dl class="m-0 divide-y divide-line border-y border-line text-sm">
            @for (row of railRows(); track row.key) {
              <div class="flex items-center justify-between gap-3 py-1.5" [attr.data-testid]="'stat-' + row.key">
                <dt class="flex shrink-0 items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-sea">
                  <app-icon [name]="row.icon" [size]="14" class="text-ink-muted" />
                  {{ row.labelKey | transloco }}
                </dt>
                <dd
                  class="m-0 font-medium text-ink"
                  [class.text-right]="!edit()"
                  [class.min-w-0]="edit()"
                  [class.flex-1]="edit()"
                >
                  @if (edit()) {
                    <ds-stat-slot
                      [field]="field(row.key)"
                      [value]="value(row.key)"
                      [writable]="true"
                      [invalid]="invalidKey(row.key)"
                      [placeholderKey]="row.placeholderKey"
                      (valueChange)="setByKey(row.key, $event)"
                    />
                  } @else {
                    {{ row.value }}
                  }
                </dd>
              </div>
            }
          </dl>

          <!-- Characteristics: the M/A/R/I/P glyph over its signed value (read) or its control (edit). -->
          <div class="grid grid-cols-5 gap-1 rounded-md border border-line bg-surface-sunken p-2 text-center">
            @for (key of characteristicKeys; track key) {
              <div class="flex flex-col items-center gap-0.5" [attr.data-testid]="'stat-' + key">
                <app-icon [name]="charIcon(key)" class="text-2xl text-sea" [label]="abbreviation(key)" />
                @if (edit()) {
                  <ds-stat-slot
                    [field]="field(key)"
                    [value]="value(key)"
                    [writable]="true"
                    [invalid]="invalidKey(key)"
                    [signed]="true"
                    [compact]="true"
                    (valueChange)="setByKey(key, $event)"
                  />
                } @else {
                  <span class="text-sm font-bold text-ink-strong">{{ signed(key) }}</span>
                }
              </div>
            }
          </div>

          <!-- Immunity / weakness: the compact per-type editor (edit), or chips of the set types (read). -->
          @if (edit()) {
            <dl class="m-0 space-y-2 text-sm">
              @for (mapKey of damageSectionKeys; track mapKey) {
                <div [attr.data-testid]="'section-' + mapKey">
                  <dt class="font-semibold text-sea">{{ 'drawSteel.statBlock.section.' + mapKey | transloco }}</dt>
                  <dd class="m-0 mt-1 text-ink">
                    <ds-damage-map
                      [mapKey]="mapKey"
                      [value]="value(mapKey)"
                      [writable]="true"
                      [options]="damageTypes"
                      (valueChange)="setDamage(mapKey, $event.type, $event.value)"
                    />
                  </dd>
                </div>
              }
            </dl>
          } @else if (damageEntries('immunities').length || damageEntries('weaknesses').length) {
            <div class="flex flex-wrap gap-1.5">
              @for (imm of damageEntries('immunities'); track imm.type) {
                <span class="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2.5 py-1 text-positive">
                  <app-icon name="ds-immunity" [size]="12" />
                  <span class="text-2xs font-bold uppercase tracking-wider">{{
                    'drawSteel.statBlock.damage.' + imm.type | transloco
                  }}</span>
                  <span class="text-xs font-black">{{ imm.value }}</span>
                </span>
              }
              @for (weak of damageEntries('weaknesses'); track weak.type) {
                <span class="inline-flex items-center gap-1 rounded-full bg-ember-soft px-2.5 py-1 text-ember">
                  <app-icon name="ds-weakness" [size]="12" />
                  <span class="text-2xs font-bold uppercase tracking-wider">{{
                    'drawSteel.statBlock.damage.' + weak.type | transloco
                  }}</span>
                  <span class="text-xs font-black">{{ weak.value }}</span>
                </span>
              }
            </div>
          }
        </aside>

        <!-- Right column: the active Abilities (#246) lead, then the passive Traits (#245) — [writable] in place. -->
        <div class="min-w-0">
          <ds-abilities-section
            [value]="value('abilities')"
            [writable]="edit()"
            [characteristics]="characteristics()"
            (valueChange)="setByKey('abilities', $event)"
          />
          <ds-traits-section [value]="value('traits')" [writable]="edit()" (valueChange)="setByKey('traits', $event)" />
        </div>
      </div>

      <p class="mt-5 text-xs text-ink-muted">{{ 'drawSteel.monster.loreHint' | transloco }}</p>
    </article>
  `,
})
export class StatBlockViewComponent {
  /** The central store every View of the open Entity reads its slice off and writes back through. */
  private readonly session = inject(ENTITY_SESSION);

  protected readonly writable = this.session.writable;

  /** The Entity name, echoed read-only in the band — it is authored in the page header, not here. */
  protected readonly name = computed(() => this.session.current()?.name ?? '');

  /**
   * The stat-block Field this View renders — {@link DS_STAT_BLOCK_FIELD} re-keyed to {@link VIEW_FIELD_KEY},
   * so it lenses whichever document key the placing Field named (a monster's `stat_block`, or an
   * attachment's own key). The whole block is one value at that key (ADR-0055).
   */
  private readonly field_: Field = { ...DS_STAT_BLOCK_FIELD, id: inject(VIEW_FIELD_KEY) };

  /** The live stat-block value — a lens over the one EntityDocument map, coerced to a bare record. */
  private readonly block = computed<Record<string, unknown>>(() => asBlock(readField(this.session.doc(), this.field_)));

  /** The flat inner stats failing the forward-only gate — a mistyped stat at rest, never an absent one. */
  private readonly invalidKeys = computed(
    () => new Set(validateFields(DS_STAT_FIELDS, this.block(), NO_STRUCTURED_DATA_TYPES).errors.map((e) => e.key)),
  );

  /**
   * Whether the writer has this View in edit mode — a *local* presentation toggle, distinct from
   * {@link EntitySession.writable} (the ADR-0037 permission). It opens closed on an existing block (the
   * clean read card), but open on an empty one, so minting a new monster lands on controls rather than a
   * wall of em dashes.
   */
  protected readonly editing = signal(Object.keys(this.block()).length === 0);

  /** The gate the value controls render behind: editable only when the caller *may* edit and *is* editing. */
  protected readonly edit = computed(() => this.writable() && this.editing());

  /** The stat strip's keys, in printed-card order — a size token then the four numeric defences. */
  protected readonly stripKeys = ['size', 'speed', 'stamina', 'stability', 'free_strike'] as const;
  protected readonly characteristicKeys = DS_CHARACTERISTIC_KEYS;

  /**
   * The five characteristic scores as a map, fed to the Abilities section so a read-view power roll resolves
   * `2d10 + the characteristic` (#252). An absent or ill-typed score is simply omitted — the roll adds `0`.
   */
  protected readonly characteristics = computed<Partial<Record<DsCharacteristicKey, number>>>(() => {
    const block = this.block();
    const map: Partial<Record<DsCharacteristicKey, number>> = {};
    for (const key of DS_CHARACTERISTIC_KEYS) {
      const value = block[key];
      if (typeof value === 'number') map[key] = value;
    }
    return map;
  });
  /** The two damage maps, rendered as their own labelled lines (edit) or chips (read) above movement. */
  protected readonly damageSectionKeys = DS_MAP_KEYS;
  /** The closed damage vocabulary the immunity/weakness editors offer. */
  protected readonly damageTypes = DS_DAMAGE_TYPE_OPTIONS;

  /** A minion is the only organization with a captain and the "for four minions" EV phrasing. */
  protected isMinion(): boolean {
    return this.block()['organization'] === 'minion';
  }

  /** The single-letter abbreviation a characteristic prints in the badge (M/A/R/I/P). */
  protected abbreviation(key: string): string {
    return DS_CHARACTERISTIC_ABBREVIATIONS[key as keyof typeof DS_CHARACTERISTIC_ABBREVIATIONS] ?? key;
  }

  /** The Draw Steel font glyph for a characteristic's rounded badge (`might` → `ds-might`). */
  protected charIcon(key: DsCharacteristicKey) {
    return dsIcon(key);
  }

  /** The stat descriptor for a key — a plain lens Field the control edits through (guaranteed present). */
  protected field(key: string): Field {
    return DS_STAT_FIELDS_BY_KEY.get(key) as Field;
  }

  /** A stat's live raw value off the one block map. */
  protected value(key: string): unknown {
    return this.block()[key];
  }

  /** A stat's transloco label key, for a `dt`/strip caption. */
  protected label(key: string): string {
    return this.field(key)?.labelKey ?? key;
  }

  protected invalidKey(key: string): boolean {
    return this.invalidKeys().has(key);
  }

  /** A stat rendered as read text: its value, or an em dash for an absent one. */
  protected display(key: string): string {
    const value = this.block()[key];
    return value === undefined || value === null || value === '' ? '—' : String(value);
  }

  /** A stat's bare text, blank when absent — for the identity sentence, which omits an unset part. */
  protected text(key: string): string {
    const value = this.block()[key];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  /** A list stat printed joined, raw — movement shows `climb, fly`, the source keys as-is (ds.CONFIG). */
  protected listText(key: string): string {
    const value = this.block()[key];
    return Array.isArray(value) ? value.join(', ') : '';
  }

  /** A characteristic printed signed (`+3`, `0`, `-1`), or an em dash when absent — the Draw Steel convention. */
  protected signed(key: string): string {
    const value = this.block()[key];
    return typeof value === 'number' ? (value >= 0 ? `+${value}` : `${value}`) : '—';
  }

  /** The keyword flavour line ("Angulotl, Humanoid"), joined for legibility. */
  protected keywordsText(): string {
    const value = this.block()['keywords'];
    return Array.isArray(value) ? value.join(', ') : '';
  }

  /** Title-case a raw enum key for the identity sentence — the View shows `ds.CONFIG` keys as-is elsewhere. */
  protected titleCase(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }

  /**
   * The left-rail spec rows, in printed-card order — the defences then (conditionally) movement and the
   * minion captain line, each paired with its Lucide glyph and add-placeholder. In read, movement and
   * captain append only when set, so the rail stays tight rather than showing a run of em dashes; in edit
   * they always render (captain only for a minion, its by-design gate) so no defence stat is unsettable.
   */
  protected railRows(): { key: string; labelKey: string; value: string; icon: string; placeholderKey: string }[] {
    const editing = this.edit();
    const rows = this.stripKeys.map((key) => this.railRow(key));
    if (editing || this.listText('movement_types')) rows.push(this.railRow('movement_types'));
    if (this.isMinion() && (editing || this.text('with_captain'))) rows.push(this.railRow('with_captain'));
    return rows;
  }

  /** One rail row: its glyph/label plus the read-mode printed value and any edit-mode add-placeholder. */
  private railRow(key: string): { key: string; labelKey: string; value: string; icon: string; placeholderKey: string } {
    return {
      key,
      labelKey: this.label(key),
      value:
        key === 'movement_types' ? this.listText(key) : key === 'with_captain' ? this.text(key) : this.display(key),
      icon: SPEC_ICONS[key],
      placeholderKey: key === 'movement_types' ? 'drawSteel.statBlock.addMovement' : '',
    };
  }

  /** The set entries of an immunities/weaknesses map, for the read-view chips — a numeric value per damage type. */
  protected damageEntries(mapKey: string): { type: string; value: number }[] {
    const map = this.block()[mapKey];
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    return Object.entries(map as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([type, value]) => ({ type, value }));
  }

  /**
   * Write a stat back into the block, then the whole block back into the EntityDocument at the Field's one
   * key — through the central store, the channel every View uses (ADR-0055). An emptied stat drops from
   * the block; the block itself stays (an empty object is not a cleared key), so the Field's slice persists.
   */
  protected setByKey(key: string, value: unknown): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft: EntityDocument) => {
      const next = { ...asBlock(readField(draft, this.field_)) };
      if (isEmpty(value)) delete next[key];
      else next[key] = value;
      writeFieldInPlace(draft, this.field_, next);
    });
  }

  /**
   * Write one damage-type modifier into an immunities/weaknesses map. An emptied entry drops from the map,
   * and an emptied map drops from the block — so a cleared section leaves no `{}` husk in the frontmatter.
   */
  protected setDamage(mapKey: string, type: string, value: number | undefined): void {
    if (!this.session.writable()) return;
    this.session.mutate((draft: EntityDocument) => {
      const next = { ...asBlock(readField(draft, this.field_)) };
      const map = { ...asBlock(next[mapKey]) };
      if (isEmpty(value)) delete map[type];
      else map[type] = value;
      if (Object.keys(map).length === 0) delete next[mapKey];
      else next[mapKey] = map;
      writeFieldInPlace(draft, this.field_, next);
    });
  }
}

/** The Lucide glyph each left-rail spec row is labelled with (registered in `providePluginDrawSteel`). */
const SPEC_ICONS: Record<string, string> = {
  size: 'ds-size',
  speed: 'ds-speed',
  stamina: 'ds-stamina',
  stability: 'ds-stability',
  free_strike: 'ds-free-strike',
  movement_types: 'ds-movement',
  with_captain: 'ds-captain',
};

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
