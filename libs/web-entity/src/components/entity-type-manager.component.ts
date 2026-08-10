import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityType, Field, NO_STRUCTURED_DATA_TYPES, validateFields, writeField } from '@hexly/domain';
import { ButtonComponent, ChipComponent, ChipTone, IconName, InputComponent } from '@hexly/web-ui';
import { ENTITY_SESSION } from '../models/entity-session';
import { ENTITY_TYPES } from '../models/entity-types';
import { typeTone } from '../models/type-tone';
import { FieldControlComponent } from './field-control.component';

/**
 * The normalization the exact-name reconciliation compares under (#438): trim, accent-fold, lowercase.
 * It folds accents to stay in step with the id slug ({@link slugifyTypeSegment}) — otherwise typing
 * "Déïty" would miss an existing "Deity" and mint `world.type.deity-2`, the visual duplicate US8 forbids.
 */
function normalizeName(name: string): string {
  return name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The one reusable **entity type manager** (#438): the ordered Entity Type set as chips — reorder to
 * set the primary (`types[0]`, ADR-0048), remove (write-gated, never the last, never a System-managed
 * type, ADR-0068) — and a typeahead combobox that fuzzy-filters the creatable types and, for a **World
 * Owner**, offers a **Create "<name>"** row that mints a new User-defined type inline.
 *
 * It reads and writes the live set through the {@link ENTITY_SESSION}/{@link ENTITY_TYPES} seams, so it
 * hosts unchanged on the Details panel (a live Entity) and on a pre-existence surface (the create dialog,
 * over a {@link LocalEntitySession}) — the single control ADR-0067's consolidation asked for, replacing
 * the retired header types-editor dialog.
 *
 * Adding a type whose `required` Fields the document leaves unfilled opens an inline prompt to collect
 * them — informing, never gating: both prompt buttons add the type (ADR-0074). A host that collects
 * those Fields in its own form (the create dialog) binds `promptOnAdd=false`.
 *
 * Inline create is Owner-gated ({@link ENTITY_TYPES.canCreate}) and eager: the Create row activates the
 * concrete registry's mint, which persists Container-wide, registers the type client-side, and returns
 * its id — added to the set, which rides the normal autosave. An **exact, normalized name match** across
 * every creatable type (plugin + user) adds/selects that existing type instead, never a duplicate; a
 * partial match never suppresses the Create row.
 */
@Component({
  selector: 'app-entity-type-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ChipComponent, ButtonComponent, InputComponent, FieldControlComponent],
  host: { class: 'flex flex-col gap-3' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      @for (type of typeRows(); track type.id; let i = $index) {
        <!-- The icon, not the tone, carries the category — hue alone can't separate eight for a
             dichromat (ADR-0075). Primacy is the "· Primary" marker, never the colour. -->
        <app-chip [tone]="type.tone" [icon]="type.icon" [attr.data-testid]="'type-chip-' + type.id">
          {{ type.label }}
          @if (i === 0) {
            <span class="text-2xs opacity-70" data-testid="type-primary"
              >· {{ 'fields.details.primary' | transloco }}</span
            >
          }
          @if (writable()) {
            <!-- Reorder to re-primary; a read-only opener sees just the ordered chips. -->
            @if (i > 0) {
              <button
                type="button"
                class="leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                [attr.aria-label]="'fields.details.moveUp' | transloco: { type: type.label }"
                [attr.data-testid]="'type-move-up-' + type.id"
                (click)="moveUp(i)"
              >
                ↑
              </button>
            }
            @if (i < typeRows().length - 1) {
              <button
                type="button"
                class="leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                [attr.aria-label]="'fields.details.moveDown' | transloco: { type: type.label }"
                [attr.data-testid]="'type-move-down-' + type.id"
                (click)="moveDown(i)"
              >
                ↓
              </button>
            }
            <!-- Never the last type (every Entity keeps a primary, typesSchema.min(1)) and never a
                 System-managed one — the system alone assigns/removes it (ADR-0068). -->
            @if (typeRows().length > 1 && !type.systemManaged) {
              <button
                type="button"
                class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                [attr.aria-label]="'fields.details.removeType' | transloco: { type: type.label }"
                [attr.data-testid]="'type-remove-' + type.id"
                (click)="removeType(type.id)"
              >
                &times;
              </button>
            }
          }
        </app-chip>
      }

      @if (writable() && !pendingType()) {
        <!-- Typeahead combobox: fuzzy-filters the creatable list and always carries the Create row for
             an Owner (#438), so a longer existing name ("Hell Deity") never blocks a shorter mint. -->
        <div class="relative">
          <input
            appInput
            role="combobox"
            data-testid="type-add"
            autocomplete="off"
            [attr.aria-label]="'fields.details.addType' | transloco"
            [attr.aria-expanded]="menuOpen()"
            [value]="query()"
            (input)="onQuery($event)"
            (focus)="focused.set(true)"
            (blur)="focused.set(false)"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="reset()"
          />
          @if (menuOpen()) {
            <ul
              role="listbox"
              data-testid="type-add-menu"
              class="absolute z-10 mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2"
            >
              @for (option of filtered(); track option.id) {
                <li
                  role="option"
                  class="cursor-pointer rounded-sm px-2 py-1 text-sm text-ink hover:bg-surface-sunken"
                  [attr.data-testid]="'type-option-' + option.id"
                  (mousedown)="$event.preventDefault()"
                  (click)="addType(option.id)"
                >
                  {{ option.label }}
                </li>
              }
              @if (canCreateRow()) {
                <li
                  role="option"
                  class="cursor-pointer rounded-sm px-2 py-1 text-sm font-medium text-accent-strong hover:bg-surface-sunken"
                  data-testid="type-create"
                  (mousedown)="$event.preventDefault()"
                  (click)="activateCreate()"
                >
                  {{ 'fields.details.createType' | transloco: { name: query().trim() } }}
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>

    <!-- Add-type prompt: the picked type's unfilled required Fields, offered before the add commits.
         Both add buttons commit it — the prompt informs, it never gates (ADR-0074) — and Cancel adds
         nothing, so a mis-picked type is recoverable without adding then removing it (#338). -->
    @if (pendingType(); as pending) {
      <div
        class="rounded-md border border-line bg-surface-sunken p-3 flex flex-col gap-3"
        data-testid="type-add-prompt"
      >
        <p class="m-0 text-sm text-ink-muted">
          {{ 'fields.details.requiredHeading' | transloco: { type: typeLabel(pending) } }}
        </p>
        <dl class="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-x-4 gap-y-2 m-0">
          @for (field of pendingFields(); track field.id) {
            <dt class="text-sm text-ink-muted">
              {{ fieldLabel(field) }}<span class="text-danger" aria-hidden="true">&nbsp;*</span>
            </dt>
            <dd class="m-0" [attr.data-testid]="'pending-field-' + field.id">
              <app-field-control
                [field]="field"
                [value]="pendingMetadata()[field.id]"
                [invalid]="!!invalidPendingKeys().has(field.id)"
                (valueChange)="setPending(field, $event)"
              />
            </dd>
          }
        </dl>
        <div class="flex justify-end gap-2">
          <button type="button" appButton variant="ghost" size="sm" data-testid="type-add-cancel" (click)="cancelAdd()">
            {{ 'fields.details.cancel' | transloco }}
          </button>
          <button type="button" appButton size="sm" data-testid="type-add-bare" (click)="addWithoutFields()">
            {{ 'fields.details.addWithoutFields' | transloco }}
          </button>
          <button
            type="button"
            appButton
            variant="primary"
            size="sm"
            data-testid="type-add-confirm"
            [attr.aria-disabled]="!pendingValid() || null"
            (click)="confirmAdd()"
          >
            {{ 'fields.details.confirmAdd' | transloco }}
          </button>
        </div>
      </div>
    }
  `,
})
export class EntityTypeManagerComponent {
  protected readonly session = inject(ENTITY_SESSION);
  private readonly types = inject(ENTITY_TYPES);
  private readonly transloco = inject(TranslocoService);

  /**
   * Whether adding a type with unfilled required Fields opens the inline prompt (ADR-0074). The Details
   * panel leaves it on so the author is told what a type expects; a host collecting those Fields in its
   * own form (the create dialog) binds `false`, so an add lands straight in.
   */
  readonly promptOnAdd = input(true);
  /**
   * Whether this host offers inline type creation at all (#438). On by default; a pre-existence surface
   * that only classifies (the create dialog) binds `false`, so no Create row shows even to an Owner.
   */
  readonly allowCreate = input(true);

  /** A read-only opener manages nothing — chips list bare, no reorder/remove/add (ADR-0037). */
  protected readonly writable = this.session.writable;

  /** The current combobox text and focus, together deciding whether the option menu is open. */
  protected readonly query = signal('');
  protected readonly focused = signal(false);
  protected readonly menuOpen = computed(() => this.focused() || this.query().trim().length > 0);

  /** The type the prompt is collecting Fields for, or `null` when no prompt is open. */
  protected readonly pendingType = signal<EntityType | null>(null);
  protected readonly pendingFields = signal<readonly Field[]>([]);
  protected readonly pendingMetadata = signal<Record<string, unknown>>({});

  /**
   * The live type set as chips: label, icon, and derived tone, plus the System-managed flag that drops
   * the remove ×. An unregistered/disabled id (a missing Plugin) reads by its raw id, generic chrome.
   */
  protected readonly typeRows = computed(() => {
    this.transloco.activeLang(); // re-resolve labels on a language switch
    return this.session.types().map((id) => {
      const def = this.types.get(id);
      return {
        id,
        label: this.typeLabel(id),
        icon: (def?.icon ?? 'label') as IconName,
        tone: typeTone(def ?? { id }) as ChipTone,
        systemManaged: !!def?.systemManaged,
      };
    });
  });

  /** The creatable types (ADR-0068) not already carried, fuzzy-filtered by the combobox text (#438). */
  protected readonly filtered = computed(() => {
    this.transloco.activeLang();
    const present = new Set(this.session.types());
    const needle = normalizeName(this.query());
    return this.types
      .creatable()
      .filter((def) => !present.has(def.id))
      .map((def) => ({ id: def.id, label: this.typeLabel(def.id) }))
      .filter((option) => !needle || normalizeName(option.label).includes(needle));
  });

  /** Whether the **Create "<name>"** row shows: an Owner, this host allows it, and something is typed. */
  protected readonly canCreateRow = computed(
    () => this.allowCreate() && this.types.canCreate() && this.query().trim().length > 0,
  );

  /** The forward-only reading of the prompt's collected values. */
  private readonly pendingValidation = computed(() =>
    validateFields(this.pendingFields(), this.pendingMetadata(), NO_STRUCTURED_DATA_TYPES),
  );

  /** Shape violations only (ADR-0074): an empty `required` Field is a reading, never a refusal. */
  protected readonly pendingValid = computed(() => this.pendingValidation().ok);
  protected readonly invalidPendingKeys = computed(() => new Set(this.pendingValidation().errors.map((e) => e.key)));

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Enter picks the first filtered option if any, else mints through the Create row (#438). */
  protected onEnter(event: Event): void {
    event.preventDefault();
    const first = this.filtered()[0];
    if (first) this.addType(first.id);
    else if (this.canCreateRow()) this.activateCreate();
  }

  /**
   * Add an existing type; its unfilled required Fields open the prompt first when prompting (ADR-0074).
   * A no-op if already carried, so an exact-match Create reconciling to a present type adds nothing.
   */
  protected addType(type: EntityType): void {
    if (this.session.types().includes(type)) {
      this.reset();
      return;
    }
    const required = this.types.resolveFields([type]).filter((field) => field.required);
    const unsatisfied = required.filter((field) => {
      const reading = validateFields([field], this.session.doc(), NO_STRUCTURED_DATA_TYPES);
      // What the prompt has to offer — a Field the document leaves empty or ill-shaped. Nothing here
      // decides whether the type is added; both prompt buttons add it (ADR-0074).
      return !reading.ok || reading.incomplete.length > 0;
    });
    if (unsatisfied.length === 0 || !this.promptOnAdd()) {
      this.session.setTypes([...this.session.types(), type]);
      this.reset();
      return;
    }
    this.pendingType.set(type);
    this.pendingFields.set(unsatisfied);
    this.pendingMetadata.set({ ...this.session.doc() });
    this.query.set('');
  }

  /**
   * Activate the **Create** row: an **exact, normalized name match** across every creatable type
   * (plugin + user) adds that existing type instead of minting a duplicate (#438); a fresh name mints
   * bare, then adds the returned id. A bare type has no required Fields, so it never prompts.
   */
  protected async activateCreate(): Promise<void> {
    const label = this.query().trim();
    if (!label) return;
    const needle = normalizeName(label);
    const exact = this.types.creatable().find((def) => normalizeName(this.typeLabel(def.id)) === needle);
    if (exact) {
      this.addType(exact.id);
      return;
    }
    const id = (await this.types.create(label)) as EntityType;
    if (!this.session.types().includes(id)) this.session.setTypes([...this.session.types(), id]);
    this.reset();
  }

  /** Swap a type up one place; reaching index 0 re-primaries it (ADR-0048). */
  protected moveUp(index: number): void {
    if (index > 0) this.swap(index, index - 1);
  }

  protected moveDown(index: number): void {
    if (index < this.session.types().length - 1) this.swap(index, index + 1);
  }

  private swap(a: number, b: number): void {
    const next = [...this.session.types()];
    [next[a], next[b]] = [next[b], next[a]];
    this.session.setTypes(next);
  }

  /** Drop a type — the lens only; its document values persist (CONTEXT.md → Field). Never the last one. */
  protected removeType(type: EntityType): void {
    if (this.session.types().length <= 1) return;
    this.session.setTypes(this.session.types().filter((t) => t !== type));
  }

  protected setPending(field: Field, value: unknown): void {
    this.pendingMetadata.update((meta) => writeField(meta, field, value));
  }

  /** Commit the add carrying the prompt's collected values: write them, then the new set. */
  protected confirmAdd(): void {
    const type = this.pendingType();
    if (!type || !this.pendingValid()) return;
    this.writeMetadata(this.pendingMetadata());
    this.session.setTypes([...this.session.types(), type]);
    this.clearPending();
  }

  /** Add the type carrying none of the prompt's Fields — it lands **Incomplete**, never refused (ADR-0074). */
  protected addWithoutFields(): void {
    const type = this.pendingType();
    if (!type) return;
    this.session.setTypes([...this.session.types(), type]);
    this.clearPending();
  }

  /** Dismiss the prompt, adding nothing — the picked type was the wrong one (#338). */
  protected cancelAdd(): void {
    this.clearPending();
  }

  /** Fold the prompt's collected Field values into the one Entity Document (ADR-0051). */
  private writeMetadata(metadata: Record<string, unknown>): void {
    this.session.mutate((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, metadata);
    });
  }

  private clearPending(): void {
    this.pendingType.set(null);
    this.pendingFields.set([]);
    this.pendingMetadata.set({});
    this.reset();
  }

  protected reset(): void {
    this.query.set('');
    this.focused.set(false);
  }

  /** A friendly type label: a registered type's name; an unknown/disabled id (a missing Plugin) verbatim. */
  protected typeLabel(type: EntityType): string {
    return this.types.get(type) ? this.types.name(type) : type;
  }

  /** A Field's display name: a plugin's translated `labelKey`, else its authored `label` (ADR-0014). */
  protected fieldLabel(field: Field): string {
    return field.labelKey ? this.transloco.translate(field.labelKey) : field.label;
  }
}
