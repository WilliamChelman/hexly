import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ButtonComponent, InputComponent, SelectComponent, TextareaComponent } from '@hexly/web-ui';
import { Ability, DS_ABILITY_TYPE_OPTIONS, DS_CHARACTERISTIC_KEYS, PowerRoll } from '@hexly/plugin-draw-steel';
import { TokenListComponent } from './token-list.component';

/**
 * The active **Abilities** section of the {@link StatBlockViewComponent} (#246). A lens, like the rest of
 * the card: it holds no list, it reads the raw `abilities` value and emits the next `Ability[]` for the
 * View to write back (an empty array clears the key).
 *
 * Render-faithful, never resolvable: an Ability either carries a **power roll** (a characteristic and its
 * three flat tier texts) or a flat **effect** — the edit toggle is mutually exclusive, so the printed block
 * reads as one or the other. `distance`/`target`/`cost`/`trigger` are display strings, not typed geometry.
 */
@Component({
  selector: 'ds-abilities-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
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
            @for (ability of abilities(); track $index) {
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
                  <dl class="m-0 mt-1" data-testid="ability-powerroll">
                    <div class="text-2xs uppercase tracking-wider text-ink-muted">
                      {{ 'drawSteel.statBlock.powerRoll' | transloco }} ·
                      {{ 'drawSteel.statBlock.stat.' + roll.characteristic | transloco }}
                    </div>
                    @for (tier of tierKeys; track tier.key) {
                      <div class="flex gap-2">
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
  readonly valueChange = output<Ability[]>();

  protected readonly abilities = computed<UiAbility[]>(() => asAbilities(this.value()));

  protected readonly abilityTypes = DS_ABILITY_TYPE_OPTIONS;
  protected readonly characteristicKeys = DS_CHARACTERISTIC_KEYS;
  /** The three power-roll tiers, in printed order, with the band a stat block prints beside each. */
  protected readonly tierKeys = [
    { key: 't1', band: '≤11' },
    { key: 't2', band: '12–16' },
    { key: 't3', band: '17+' },
  ] as const;

  protected addAbility(): void {
    this.emit([...this.abilities(), emptyAbility()]);
  }

  /** Emitting `[]` for the last ability lets the View clear the key (no `{ abilities: [] }` husk). */
  protected removeAbility(index: number): void {
    this.emit(this.abilities().filter((_, i) => i !== index));
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
