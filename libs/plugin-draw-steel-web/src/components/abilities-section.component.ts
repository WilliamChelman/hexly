import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, InputComponent, SelectComponent, TextareaComponent } from '@hexly/web-ui';
import {
  Ability,
  DS_ABILITY_TYPE_OPTIONS,
  DS_CHARACTERISTIC_KEYS,
  DsCharacteristicKey,
  PowerRoll,
} from '@hexly/plugin-draw-steel';
import { DICE_RNG, evaluate, formatRoll, parse } from '@hexly/dice-web';
import { TokenListComponent } from './token-list.component';

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
 * (#252): a roll button rolls `2d10 + the ability's characteristic`, the total bands to a tier (Draw Steel
 * owns that mapping — the dice lib stays generic), and the result rides a bubble anchored above the button
 * while its tier row highlights in place. The Roll is transient — nothing persists (CONTEXT.md → Dice) — and
 * a document click dismisses it.
 */
@Component({
  selector: 'ds-abilities-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A click anywhere outside a bubble dismisses it; the button/bubble handlers stop propagation to survive.
  host: { class: 'contents', '(document:click)': 'dismissAll()' },
  imports: [TranslocoPipe, ButtonComponent, InputComponent, TextareaComponent, SelectComponent, TokenListComponent],
  template: `
    <section class="border-b border-line py-3 last:border-b-0" data-testid="section-abilities">
      <h3 class="m-0 mb-1 text-sm font-semibold text-sea">{{ 'drawSteel.statBlock.section.abilities' | transloco }}</h3>

      @if (writable()) {
        <div class="flex flex-col gap-3">
          <!-- Tracked by index: an ability has no stable key and may be blank or duplicate. The nested
               tier loop shadows the loop index, so the ability's own is aliased for its handlers to reach. -->
          @for (ability of abilities(); track $index; let abilityIndex = $index) {
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
          <div class="flex flex-col gap-3 text-sm">
            <!-- Aliased: the nested tier loop shadows the loop index, so the ability's own is reached for its roll state. -->
            @for (ability of abilities(); track $index; let abilityIndex = $index) {
              <div [attr.data-testid]="'ability-' + $index">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-semibold text-ink">{{ ability.name || '—' }}</span>
                  <span class="shrink-0 text-2xs uppercase tracking-wider text-ink-muted">
                    {{ 'drawSteel.statBlock.abilityTypeOption.' + ability.type | transloco }}
                    @if (ability.cost) {
                      · {{ ability.cost }}
                    }
                  </span>
                </div>
                @if (ability.keywords.length) {
                  <p class="m-0 text-xs italic text-ink-muted">{{ ability.keywords.join(', ') }}</p>
                }
                <p class="m-0 text-xs text-ink-muted">
                  <span class="font-semibold text-sea">{{ 'drawSteel.statBlock.abilityDistance' | transloco }}</span>
                  {{ ability.distance || '—' }}
                  <span class="ml-2 font-semibold text-sea">{{ 'drawSteel.statBlock.abilityTarget' | transloco }}</span>
                  {{ ability.target || '—' }}
                </p>
                @if (ability.trigger) {
                  <p class="m-0 text-xs text-ink-muted">
                    <span class="font-semibold text-sea">{{ 'drawSteel.statBlock.abilityTrigger' | transloco }}</span>
                    {{ ability.trigger }}
                  </p>
                }
                @if (ability.powerRoll; as roll) {
                  <dl class="relative m-0 mt-1" data-testid="ability-powerroll">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-2xs uppercase tracking-wider text-ink-muted">
                        {{ 'drawSteel.statBlock.powerRoll' | transloco }} ·
                        {{ 'drawSteel.statBlock.stat.' + roll.characteristic | transloco }}
                      </div>
                      <!-- Read-only ephemeral resolution (#252): rolls 2d10 + the characteristic, never persisted. -->
                      <button
                        type="button"
                        appButton
                        variant="ghost"
                        size="sm"
                        data-testid="ability-roll"
                        [title]="'dice.rollAction' | transloco"
                        [attr.aria-label]="'dice.rollAction' | transloco"
                        (click)="rollAbility(abilityIndex, roll, $event)"
                      >
                        🎲 {{ 'dice.rollAction' | transloco }}
                      </button>
                    </div>

                    <!-- Anchored within the card (no overlay primitive): the Roll Result sits above the button. -->
                    @if (rollFor(abilityIndex); as state) {
                      <div
                        class="absolute bottom-full right-0 z-10 mb-1 w-max max-w-[16rem] rounded-md border border-line bg-surface p-2 text-left shadow-2"
                        role="status"
                        data-testid="ability-roll-bubble"
                        (click)="$event.stopPropagation()"
                      >
                        <div class="flex items-center justify-between gap-3">
                          <span class="text-2xs uppercase tracking-wider text-ink-muted">
                            {{ 'dice.rollResult' | transloco }}
                          </span>
                          <button
                            type="button"
                            class="leading-none text-ink-muted hover:text-ink"
                            data-testid="ability-roll-dismiss"
                            [title]="'dice.dismiss' | transloco"
                            [attr.aria-label]="'dice.dismiss' | transloco"
                            (click)="dismiss(abilityIndex, $event)"
                          >
                            ✕
                          </button>
                        </div>
                        <div class="mt-0.5 flex items-baseline gap-2">
                          <span class="text-lg font-bold text-ink-strong" data-testid="ability-roll-total">{{
                            state.total
                          }}</span>
                          <span class="text-xs font-semibold text-sea" data-testid="ability-roll-tier">
                            {{ 'drawSteel.statBlock.tier.' + state.tier | transloco }}
                          </span>
                        </div>
                        <div class="mt-0.5 text-2xs text-ink-muted" data-testid="ability-roll-breakdown">
                          {{ state.detail }}
                        </div>
                      </div>
                    }

                    @for (tier of tierKeys; track tier.key) {
                      <div
                        class="flex gap-2 rounded px-1"
                        [class.bg-sea-soft]="rollFor(abilityIndex)?.tier === tier.key"
                        [attr.data-testid]="'ability-tier-' + tier.key"
                        [attr.data-active]="rollFor(abilityIndex)?.tier === tier.key ? 'true' : null"
                      >
                        <dt class="w-14 shrink-0 font-semibold text-sea">{{ tier.band }}</dt>
                        <dd class="m-0 text-ink">{{ roll[tier.key] || '—' }}</dd>
                      </div>
                    }
                  </dl>
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

  /** Overridable RNG so a spec seeds the Roll (issue #249); production takes `Math.random`. */
  private readonly rng = inject(DICE_RNG);

  /** Per-ability last-roll state, keyed by ability index — sticky until re-roll, dismiss, or an outside click. */
  private readonly rolls = signal<Record<number, AbilityRoll>>({});

  protected readonly abilities = computed<UiAbility[]>(() => asAbilities(this.value()));

  protected readonly abilityTypes = DS_ABILITY_TYPE_OPTIONS;
  protected readonly characteristicKeys = DS_CHARACTERISTIC_KEYS;
  /** The three power-roll tiers, in printed order — one source for both the printed band and {@link resolveTier}. */
  protected readonly tierKeys = TIER_BANDS;

  protected addAbility(): void {
    this.emit([...this.abilities(), emptyAbility()]);
  }

  /** Emitting `[]` for the last ability lets the View clear the key (no `{ abilities: [] }` husk). */
  protected removeAbility(index: number): void {
    this.emit(this.abilities().filter((_, i) => i !== index));
  }

  /** The last Roll resolved for an ability, if any — drives its bubble and the highlighted tier row. */
  protected rollFor(index: number): AbilityRoll | undefined {
    return this.rolls()[index];
  }

  /**
   * Resolve a power roll ephemerally (#252): `2d10 + the characteristic` (an absent value adds `0`), banded
   * to a Draw Steel tier. The click stops here — it would otherwise bubble to {@link dismissAll} and clear
   * the bubble it just opened. A re-roll replaces the ability's previous state in one click; nothing persists.
   */
  protected rollAbility(index: number, roll: PowerRoll, event: Event): void {
    event.stopPropagation();
    const modifier = this.characteristics()[roll.characteristic] ?? 0;
    const expression = modifier < 0 ? `2d10 - ${-modifier}` : `2d10 + ${modifier}`;
    const ast = parse(expression);
    if (ast.isErr()) return;
    const result = evaluate(ast.value, this.rng);
    const { detail } = formatRoll(expression, result);
    this.rolls.update((rolls) => ({
      ...rolls,
      [index]: { total: result.total, tier: resolveTier(result.total), detail },
    }));
  }

  /** Explicit dismiss of one ability's bubble; stops the click reaching {@link dismissAll}. */
  protected dismiss(index: number, event: Event): void {
    event.stopPropagation();
    this.rolls.update((rolls) => {
      const next = { ...rolls };
      delete next[index];
      return next;
    });
  }

  /** An outside click clears every bubble at once (the document listener). */
  protected dismissAll(): void {
    if (Object.keys(this.rolls()).length) this.rolls.set({});
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

/**
 * The three power-roll tiers, in printed order: the `key` its stored tier text and highlight ride, the printed
 * `band`, and the inclusive `max` a resolved total falls under. One source of truth so the printed band and the
 * roll-time mapping can never drift (#252). `max: Infinity` makes the top tier the open-ended catch-all.
 */
const TIER_BANDS = [
  { key: 't1', band: '≤11', max: 11 },
  { key: 't2', band: '12–16', max: 16 },
  { key: 't3', band: '17+', max: Infinity },
] as const;

type TierKey = (typeof TIER_BANDS)[number]['key'];

/** A resolved read-time Roll for one ability — the total, its banded tier, and the breakdown the bubble shows. */
interface AbilityRoll {
  readonly total: number;
  readonly tier: TierKey;
  readonly detail: string;
}

/**
 * Draw Steel owns the tier mapping (the dice lib stays generic): a resolved total bands to a {@link TIER_BANDS}
 * tier — the same bands the stored tiers print beside (#252).
 */
function resolveTier(total: number): TierKey {
  return (TIER_BANDS.find((tier) => total <= tier.max) ?? TIER_BANDS[TIER_BANDS.length - 1]).key;
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
