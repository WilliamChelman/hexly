import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, IconComponent, InputComponent, SelectComponent, TextareaComponent } from '@hexly/web-ui';
import {
  Ability,
  DS_ABILITY_TYPE_OPTIONS,
  DS_CHARACTERISTIC_KEYS,
  DS_POWER_ROLL_TIERS,
  DsCharacteristicKey,
  DsTierKey,
  PowerRoll,
} from '@hexly/plugin-draw-steel';
import { TokenListComponent } from './token-list.component';
import { PowerRollDiceComponent } from './power-roll-dice.component';
import { DsGlyphName, DsIconName, dsIcon } from '../ds-glyphs';

/**
 * The active **Abilities** section of the {@link StatBlockViewComponent} (#246). A lens, like the rest of
 * the card: it holds no list, it reads the raw `abilities` value and emits the next `Ability[]` for the
 * View to write back (an empty array clears the key).
 *
 * An Ability either carries a **power roll** (a characteristic and its three flat tier texts) or a flat
 * **effect** — the edit toggle is mutually exclusive, so the printed block reads as one or the other.
 * `distance`/`target`/`cost`/`trigger` are display strings, not typed geometry.
 *
 * Storage stays render-faithful (the tiers are prose), but the read view **resolves a power roll ephemerally**
 * (#252): a {@link PowerRollDiceComponent} rolls `2d10 + the ability's characteristic` in its own bubble and
 * reports back the banded tier, which this section highlights on the matching tier row. The Roll is transient —
 * nothing persists (CONTEXT.md → Dice).
 */
@Component({
  selector: 'ds-abilities-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [
    TranslocoPipe,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SelectComponent,
    TokenListComponent,
    PowerRollDiceComponent,
    IconComponent,
  ],
  template: `
    <section class="border-b border-line py-3" data-testid="section-abilities">
      <h3 class="m-0 mb-2 font-serif text-lg font-bold italic text-gold-deep">
        {{ 'drawSteel.statBlock.section.abilities' | transloco }}
      </h3>

      @if (writable()) {
        <div class="flex flex-col gap-3">
          <!-- Tracked by index: an ability has no stable key and may be blank or duplicate. The nested
               tier loop shadows the loop index, so the ability's own is aliased for its handlers to reach. -->
          @for (ability of abilities(); track $index; let abilityIndex = $index; let first = $first; let last = $last) {
            <div class="rounded border border-line bg-surface-sunken p-2" [attr.data-testid]="'ability-' + $index">
              <div class="flex items-center gap-2">
                <input
                  appInput
                  class="flex-1"
                  data-testid="ability-name"
                  [value]="ability.name"
                  [placeholder]="'drawSteel.statBlock.abilityName' | transloco"
                  (input)="patch($index, { name: inputVal($event) })"
                />
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  data-testid="ability-move-up"
                  [disabled]="first"
                  [title]="'drawSteel.statBlock.moveUp' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.moveUp' | transloco"
                  (click)="moveAbility($index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  data-testid="ability-move-down"
                  [disabled]="last"
                  [title]="'drawSteel.statBlock.moveDown' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.moveDown' | transloco"
                  (click)="moveAbility($index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  icon
                  danger
                  data-testid="ability-remove"
                  [title]="'drawSteel.statBlock.removeAbility' | transloco"
                  [attr.aria-label]="'drawSteel.statBlock.removeAbility' | transloco"
                  (click)="removeAbility($index)"
                >
                  ✕
                </button>
              </div>

              <div class="mt-2 grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                  {{ 'drawSteel.statBlock.abilityType' | transloco }}
                  <select
                    appSelect
                    data-testid="ability-type"
                    [value]="ability.type"
                    (change)="patch($index, { type: selectVal($event) })"
                  >
                    @for (option of abilityTypes; track option) {
                      <option [value]="option" [selected]="option === ability.type">
                        {{ 'drawSteel.statBlock.abilityTypeOption.' + option | transloco }}
                      </option>
                    }
                  </select>
                </label>
                <label class="flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                  {{ 'drawSteel.statBlock.abilityCost' | transloco }}
                  <input
                    appInput
                    data-testid="ability-cost"
                    [value]="ability.cost"
                    [placeholder]="'drawSteel.statBlock.abilityCostHint' | transloco"
                    (input)="patch($index, { cost: inputVal($event) })"
                  />
                </label>
              </div>

              <label class="mt-2 flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                {{ 'drawSteel.statBlock.abilityKeywords' | transloco }}
                <span data-testid="ability-keywords">
                  <ds-token-list
                    [value]="ability.keywords"
                    [placeholderKey]="'drawSteel.statBlock.addKeyword'"
                    (valueChange)="patch($index, { keywords: $event })"
                  />
                </span>
              </label>

              <div class="mt-2 grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                  {{ 'drawSteel.statBlock.abilityDistance' | transloco }}
                  <input
                    appInput
                    data-testid="ability-distance"
                    [value]="ability.distance"
                    [placeholder]="'drawSteel.statBlock.abilityDistanceHint' | transloco"
                    (input)="patch($index, { distance: inputVal($event) })"
                  />
                </label>
                <label class="flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                  {{ 'drawSteel.statBlock.abilityTarget' | transloco }}
                  <input
                    appInput
                    data-testid="ability-target"
                    [value]="ability.target"
                    [placeholder]="'drawSteel.statBlock.abilityTargetHint' | transloco"
                    (input)="patch($index, { target: inputVal($event) })"
                  />
                </label>
              </div>

              <label class="mt-2 flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                {{ 'drawSteel.statBlock.abilityTrigger' | transloco }}
                <input
                  appInput
                  data-testid="ability-trigger"
                  [value]="ability.trigger"
                  [placeholder]="'drawSteel.statBlock.abilityTriggerHint' | transloco"
                  (input)="patch($index, { trigger: inputVal($event) })"
                />
              </label>

              <!-- Power roll vs flat effect: a mutually-exclusive toggle so the printed block reads as one. -->
              @if (ability.powerRoll; as roll) {
                <div class="mt-2 rounded border border-line bg-surface p-2" data-testid="ability-powerroll">
                  <div class="flex items-center justify-between gap-2">
                    <label
                      class="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted"
                    >
                      {{ 'drawSteel.statBlock.powerRoll' | transloco }}
                      <select
                        appSelect
                        data-testid="ability-characteristic"
                        [value]="roll.characteristic"
                        (change)="patchRoll($index, { characteristic: characteristicVal($event) })"
                      >
                        @for (key of characteristicKeys; track key) {
                          <option [value]="key" [selected]="key === roll.characteristic">
                            {{ 'drawSteel.statBlock.stat.' + key | transloco }}
                          </option>
                        }
                      </select>
                    </label>
                    <button
                      type="button"
                      appButton
                      variant="ghost"
                      size="sm"
                      data-testid="ability-powerroll-remove"
                      (click)="patch($index, { powerRoll: undefined })"
                    >
                      {{ 'drawSteel.statBlock.removePowerRoll' | transloco }}
                    </button>
                  </div>
                  @for (tier of tierKeys; track tier.key) {
                    <div class="mt-1.5 flex items-center gap-2">
                      <span class="w-14 shrink-0 text-xs font-semibold text-sea">{{ tier.band }}</span>
                      <input
                        appInput
                        class="flex-1"
                        [attr.data-testid]="'ability-' + tier.key"
                        [value]="roll[tier.key]"
                        (input)="patchRoll(abilityIndex, tierPatch(tier.key, inputVal($event)))"
                      />
                    </div>
                  }
                </div>
              } @else {
                <label
                  class="mt-2 flex flex-col gap-0.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {{ 'drawSteel.statBlock.abilityEffect' | transloco }}
                  <textarea
                    appTextarea
                    data-testid="ability-effect"
                    [value]="ability.effect"
                    [placeholder]="'drawSteel.statBlock.abilityEffectHint' | transloco"
                    (input)="patch($index, { effect: inputVal($event) })"
                  ></textarea>
                </label>
                <div class="mt-1.5">
                  <button
                    type="button"
                    appButton
                    variant="ghost"
                    size="sm"
                    data-testid="ability-powerroll-add"
                    (click)="patch($index, { powerRoll: emptyPowerRoll() })"
                  >
                    {{ 'drawSteel.statBlock.addPowerRoll' | transloco }}
                  </button>
                </div>
              }
            </div>
          }
          <div>
            <button type="button" appButton variant="ghost" size="sm" data-testid="ability-add" (click)="addAbility()">
              {{ 'drawSteel.statBlock.addAbility' | transloco }}
            </button>
          </div>
        </div>
      } @else {
        @if (abilities().length) {
          <div class="space-y-4 text-[15px] leading-relaxed">
            <!-- Aliased: the nested tier loop shadows the loop index, so the ability's own is reached for its roll state. -->
            @for (ability of abilities(); track $index; let abilityIndex = $index) {
              <!-- Gold accent + chip mark the main action / signature ability (#stat-block-oomph). -->
              <div [attr.data-testid]="'ability-' + $index" class="border-l-4 pl-3" [class]="accent(ability)">
                <p class="m-0 flex flex-wrap items-baseline gap-x-2">
                  <span class="flex items-baseline gap-1.5">
                    @if (typeGlyph(ability); as g) {
                      <app-icon [name]="g" class="text-base text-ink-muted" />
                    }
                    <span class="font-serif text-base font-bold" [class]="nameClass(ability)">{{
                      ability.name || '—'
                    }}</span>
                  </span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    [class]="pill(ability)"
                  >
                    {{ 'drawSteel.statBlock.abilityTypeOption.' + ability.type | transloco }}
                  </span>
                  @if (ability.cost) {
                    <span class="text-xs font-bold text-gold-deep">{{ ability.cost }}</span>
                  }
                </p>

                <!-- Distance / target / keyword chips, glyph-marked where the font carries the symbol. -->
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <span class="inline-flex items-center gap-1">
                    @if (distanceGlyph(ability); as g) {
                      <app-icon [name]="g" class="text-sm text-sea" />
                    }
                    {{ ability.distance || '—' }}
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <app-icon name="ds-targets" class="text-sm text-sea" />
                    {{ ability.target || '—' }}
                  </span>
                  @for (kw of ability.keywords; track kw) {
                    <span class="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 text-2xs">
                      @if (keywordGlyph(kw); as g) {
                        <app-icon [name]="g" class="text-sm text-sea" />
                      }
                      {{ kw }}
                    </span>
                  }
                </div>

                @if (ability.trigger) {
                  <p class="m-0 mt-0.5 flex items-baseline gap-1 text-sm italic text-ink-muted">
                    <app-icon name="ds-triggeredAction" class="not-italic text-sea" />{{ ability.trigger }}
                  </p>
                }

                @if (ability.powerRoll; as roll) {
                  <div class="mt-1.5" data-testid="ability-powerroll">
                    <div class="mb-1 flex items-center justify-between gap-2">
                      <span class="text-2xs uppercase tracking-wider text-ink-muted">
                        {{ 'drawSteel.statBlock.powerRoll' | transloco }} ·
                        {{ 'drawSteel.statBlock.stat.' + roll.characteristic | transloco }}
                      </span>
                      <!-- Read-only ephemeral resolution (#252): the roller rolls 2d10 + the characteristic and
                           reports the banded tier back, which we highlight below. Nothing persists. -->
                      <ds-power-roll-dice
                        [modifier]="modifierFor(roll.characteristic)"
                        (resolved)="setActiveTier(abilityIndex, $event)"
                      />
                    </div>
                    <!-- A's tier table: bordered, striped rows, glyph + band + text; the resolved tier highlights. -->
                    <div class="overflow-hidden rounded border border-line">
                      @for (tier of tierKeys; track tier.key; let i = $index) {
                        <div
                          class="flex items-center gap-2 px-2 py-1 text-sm"
                          [class.bg-sea-soft]="activeTier(abilityIndex) === tier.key"
                          [class.bg-surface-sunken]="activeTier(abilityIndex) !== tier.key && i % 2 === 1"
                          [attr.data-testid]="'ability-tier-' + tier.key"
                          [attr.data-active]="activeTier(abilityIndex) === tier.key ? 'true' : null"
                        >
                          <app-icon [name]="tierGlyph(i)" class="text-xl text-gold-deep" />
                          <span class="text-ink">{{ roll[tier.key] || '—' }}</span>
                        </div>
                      }
                    </div>
                  </div>
                } @else if (ability.effect) {
                  <p class="m-0 mt-0.5 text-ink" data-testid="ability-effect">{{ ability.effect }}</p>
                }
              </div>
            }
          </div>
        } @else {
          <p class="m-0 text-sm italic text-ink-faint">{{ 'drawSteel.statBlock.noAbilities' | transloco }}</p>
        }
      }
    </section>
  `,
})
export class AbilitiesSectionComponent {
  /** The raw `abilities` value off the block — a lens, never copied. */
  readonly value = input<unknown>();
  readonly writable = input(false);
  /**
   * The monster's characteristic scores, fed by {@link StatBlockViewComponent} (which holds the block).
   * A read-view power roll resolves `2d10 + characteristics[roll.characteristic]`; an absent value rolls `+ 0`.
   */
  readonly characteristics = input<Partial<Record<DsCharacteristicKey, number>>>({});
  readonly valueChange = output<Ability[]>();

  /**
   * The tier each ability's {@link PowerRollDiceComponent} last resolved, keyed by ability index — drives the
   * in-place row highlight, cleared to `null` when its bubble is dismissed. The Roll state itself lives in the
   * roller; this section keeps only what it needs to highlight (#252).
   */
  private readonly activeTiers = signal<Record<number, DsTierKey | null>>({});

  protected readonly abilities = computed<UiAbility[]>(() => asAbilities(this.value()));

  protected readonly abilityTypes = DS_ABILITY_TYPE_OPTIONS;
  protected readonly characteristicKeys = DS_CHARACTERISTIC_KEYS;
  protected readonly tierKeys = DS_POWER_ROLL_TIERS;

  protected addAbility(): void {
    this.emit([...this.abilities(), emptyAbility()]);
  }

  /** Emitting `[]` for the last ability lets the View clear the key (no `{ abilities: [] }` husk). */
  protected removeAbility(index: number): void {
    this.emit(this.abilities().filter((_, i) => i !== index));
  }

  /** Swap an ability with its neighbour to reorder within the section; a no-op past either end. */
  protected moveAbility(index: number, delta: number): void {
    const next = [...this.abilities()];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    this.emit(next);
  }

  /** The characteristic score added to a power roll (`2d10 + …`); an absent score adds 0 (#252). */
  protected modifierFor(characteristic: DsCharacteristicKey): number {
    return this.characteristics()[characteristic] ?? 0;
  }

  // --- Read-view presentation (#stat-block-oomph): the "Bestiary Spread" ability chrome. -------------

  /** Main actions and signature abilities are the ones a GM reaches for first — give them the gold pop. */
  protected isSignature(a: UiAbility): boolean {
    return a.type === 'main' || /signature/i.test(a.cost);
  }

  /** The ability's left accent bar — gold for signature/main, else a per-type hue. */
  protected accent(a: UiAbility): string {
    return this.isSignature(a) ? 'border-gold' : (ACCENT[a.type] ?? 'border-line');
  }

  /** The type pill's colours — gold for signature/main, else a per-type soft/ink pair. */
  protected pill(a: UiAbility): string {
    return this.isSignature(a) ? 'bg-gold-soft text-gold-deep' : (PILL[a.type] ?? 'bg-surface-sunken text-ink-muted');
  }

  protected nameClass(a: UiAbility): string {
    return this.isSignature(a) ? 'text-gold-deep' : 'text-ink-strong';
  }

  /** The action-type glyph the font ships — activation, triggered, or the villain "malice" mark. */
  protected typeGlyph(a: UiAbility): DsIconName | null {
    const glyph = TYPE_GLYPH[a.type];
    return glyph ? dsIcon(glyph) : null;
  }

  /** A distance glyph inferred from the ability's keywords, then its distance text (melee/ranged/area/burst). */
  protected distanceGlyph(a: UiAbility): DsIconName | null {
    for (const keyword of a.keywords) {
      const glyph = keywordToGlyph(keyword);
      if (glyph) return dsIcon(glyph);
    }
    const distance = keywordToGlyph(a.distance);
    return distance ? dsIcon(distance) : null;
  }

  protected keywordGlyph(keyword: string): DsIconName | null {
    const glyph = keywordToGlyph(keyword);
    return glyph ? dsIcon(glyph) : null;
  }

  protected tierGlyph(index: number): DsIconName {
    return dsIcon((['tier1', 'tier2', 'tier3'] as const)[index] ?? 'tier1');
  }

  /** The tier highlighted for an ability, if its roller has a Roll standing. */
  protected activeTier(index: number): DsTierKey | null {
    return this.activeTiers()[index] ?? null;
  }

  /** The roller reports its banded tier (or `null` on dismiss); we highlight the matching row. */
  protected setActiveTier(index: number, tier: DsTierKey | null): void {
    this.activeTiers.update((tiers) => ({ ...tiers, [index]: tier }));
  }

  protected patch(index: number, change: Partial<UiAbility>): void {
    this.emit(this.abilities().map((ability, i) => (i === index ? { ...ability, ...change } : ability)));
  }

  /** Patch one field of an ability's power roll, leaving the rest of the ability untouched. */
  protected patchRoll(index: number, change: Partial<PowerRoll>): void {
    const roll = this.abilities()[index]?.powerRoll ?? emptyPowerRoll();
    this.patch(index, { powerRoll: { ...roll, ...change } });
  }

  protected emptyPowerRoll(): PowerRoll {
    return emptyPowerRoll();
  }

  /** A tier patch keyed by which tier changed — the template narrows `t1|t2|t3` to a `PowerRoll` slice. */
  protected tierPatch(key: 't1' | 't2' | 't3', value: string): Partial<PowerRoll> {
    return { [key]: value };
  }

  protected inputVal(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected selectVal(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected characteristicVal(event: Event): PowerRoll['characteristic'] {
    return (event.target as HTMLSelectElement).value as PowerRoll['characteristic'];
  }

  /** Normalize the UI shape back to the stored {@link Ability} — empty optionals dropped so no husk persists. */
  private emit(list: UiAbility[]): void {
    this.valueChange.emit(list.map(toStored));
  }
}

/** The always-present UI shape the editor binds to — every slot filled so a control never binds `undefined`. */
interface UiAbility {
  name: string;
  type: string;
  cost: string;
  keywords: string[];
  distance: string;
  target: string;
  trigger: string;
  powerRoll?: PowerRoll;
  effect: string;
}

function emptyAbility(): UiAbility {
  return { name: '', type: 'main', cost: '', keywords: [], distance: '', target: '', trigger: '', effect: '' };
}

function emptyPowerRoll(): PowerRoll {
  return { characteristic: 'might', t1: '', t2: '', t3: '' };
}

/** Store only what was authored: drop blank optionals, and a power roll supersedes a flat effect. */
function toStored(ui: UiAbility): Ability {
  const out: Ability = {
    name: ui.name,
    type: ui.type as Ability['type'],
    keywords: ui.keywords,
    distance: ui.distance,
    target: ui.target,
  };
  if (ui.cost) out.cost = ui.cost;
  if (ui.trigger) out.trigger = ui.trigger;
  if (ui.powerRoll) out.powerRoll = ui.powerRoll;
  else if (ui.effect) out.effect = ui.effect;
  return out;
}

/** Forward-only: a non-array reads empty, and a non-record ability (or ill-typed field) reads blank, never throws. */
function asAbilities(value: unknown): UiAbility[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name: str(item['name']),
      type: str(item['type']) || 'main',
      cost: str(item['cost']),
      keywords: strArray(item['keywords']),
      distance: str(item['distance']),
      target: str(item['target']),
      trigger: str(item['trigger']),
      powerRoll: asPowerRoll(item['powerRoll']),
      effect: str(item['effect']),
    }));
}

/** A stored power roll coerced to the UI shape; a non-record (or absent) roll reads as none. */
function asPowerRoll(value: unknown): PowerRoll | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const roll = value as Record<string, unknown>;
  const characteristic = str(roll['characteristic']) || 'might';
  return {
    characteristic: characteristic as PowerRoll['characteristic'],
    t1: str(roll['t1']),
    t2: str(roll['t2']),
    t3: str(roll['t3']),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The left-accent hue per action type (signature/main are handled apart, in gold). */
const ACCENT: Record<string, string> = {
  maneuver: 'border-sea',
  freeManeuver: 'border-sea',
  triggered: 'border-astra',
  freeTriggered: 'border-astra',
  villain: 'border-ember',
};

/** The type pill's colour pair per action type (signature/main are handled apart, in gold). */
const PILL: Record<string, string> = {
  maneuver: 'bg-sea-soft text-sea',
  freeManeuver: 'bg-sea-soft text-sea',
  triggered: 'bg-astra-soft text-astra',
  freeTriggered: 'bg-astra-soft text-astra',
  villain: 'bg-ember-soft text-ember',
};

/** The action-type glyph the Draw Steel font carries: an activation dot, a triggered mark, or villain "malice". */
const TYPE_GLYPH: Record<string, DsGlyphName> = {
  main: 'activation',
  maneuver: 'activation',
  freeManeuver: 'activation',
  move: 'activation',
  triggered: 'triggeredAction',
  freeTriggered: 'triggeredAction',
  villain: 'malice',
};

/** Map a keyword or distance phrase to the glyph the Draw Steel font carries for it, or null. */
function keywordToGlyph(text: string): DsGlyphName | null {
  const t = text.toLowerCase();
  if (t.includes('melee')) return 'melee';
  if (t.includes('ranged')) return 'ranged';
  if (t.includes('burst')) return 'burst';
  if (t.includes('aura') || t.includes('cube') || t.includes('line') || t.includes('wall') || t.includes('area'))
    return 'area';
  return null;
}
