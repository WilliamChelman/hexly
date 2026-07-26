import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityType,
  Field as FieldDef,
  isStructuredDataType,
  EntityDocument,
  NO_STRUCTURED_DATA_TYPES,
  validateFields,
  writeField,
} from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldStore, entityRoute } from '@hexly/web-core';
import { ButtonComponent, FieldComponent, InputComponent, DialogComponent, DialogRef } from '@hexly/web-ui';
import { TypeRegistry } from './type-registry';
import { EntityTypesEditorComponent } from '../pages/entity/components/entity-types-editor.component';
import { FieldControlComponent } from '@hexly/web-entity';

/** What a create Command hands the dialog when it opens it: the seeded primary type (ADR-0048, #189). */
export interface CreateEntityDialogData {
  readonly type: EntityType;
}

/**
 * The create-Entity flow behind the `>`-prefix Create Note / Create Map Commands (ADR-0032): name +
 * World select, prefilled to `activeWorld() ?? worlds()[0]`. Opened on demand through
 * {@link DialogService}, seeded via its {@link DialogRef} — so a Command's `run()` launches it with
 * no reference to this component and no shared open-state signal to bridge them.
 *
 * The Command seeds one primary type; the embedded {@link EntityTypesEditorComponent} lets the author pick
 * more (ADR-0048), and the picked types' `required` Fields are collected below — as a prompt, not a gate:
 * they are marked with a `*` and Create stays live while they are empty (ADR-0074). Only a *present*
 * ill-typed value holds the create back.
 */
@Component({
  selector: 'app-create-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    DialogComponent,
    FieldComponent,
    InputComponent,
    TranslocoPipe,
    EntityTypesEditorComponent,
    FieldControlComponent,
  ],
  template: `
    <app-dialog [open]="true" [heading]="createLabel(types())" (closed)="cancel()">
      <label appField [label]="'commandPalette.nameLabel' | transloco">
        <input
          appInput
          appAutofocus
          data-testid="create-entity-name"
          [value]="name()"
          (input)="onName($event)"
          (keydown.enter)="submit()"
        />
      </label>
      <label appField [label]="'commandPalette.worldLabel' | transloco">
        <select
          class="w-full py-2 px-3 text-sm text-ink-strong bg-surface-sunken border border-line-strong rounded-md shadow-inset"
          data-testid="create-entity-world"
          (change)="onWorld($event)"
        >
          <!-- [selected] per-option, not [value] on the select: the select's
               own value binding would apply before its <option> children
               exist in the same change-detection pass and silently no-op. -->
          @for (world of worlds(); track world.id) {
            <option [value]="world.id" [selected]="world.id === worldId()">
              {{ world.name }}
            </option>
          }
        </select>
      </label>
      <div class="flex flex-col gap-1.5">
        <span class="text-2xs uppercase tracking-wider text-ink-muted">{{ 'entityTypes.heading' | transloco }}</span>
        <!-- promptOnAdd=false: added types go straight in and all required Fields are collected
             below, so the seeded primary type the picker prompt never sees is covered too (#189). -->
        <app-entity-types-editor
          [types]="types()"
          [metadata]="metadata()"
          [promptOnAdd]="false"
          (typesChange)="types.set($event)"
          (metadataChange)="metadata.set($event)"
        />
      </div>

      <!-- Required Fields for every picked type: the asterisk tells the author what this kind of thing
           expects; leaving one empty never holds Create back (ADR-0074). -->
      @if (requiredFields().length > 0) {
        <div class="flex flex-col gap-1.5">
          <span class="text-2xs uppercase tracking-wider text-ink-muted">{{
            'entityTypes.requiredFieldsHeading' | transloco
          }}</span>
          <p class="m-0 text-xs text-ink-muted">{{ 'entityTypes.requiredFieldsHint' | transloco }}</p>
          <dl class="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-x-4 gap-y-2 m-0">
            @for (field of requiredFields(); track field.id) {
              <dt class="text-sm text-ink-muted">
                {{ field.label }}<span class="text-danger" aria-hidden="true">&nbsp;*</span>
              </dt>
              <dd class="m-0" [attr.data-testid]="'create-field-' + field.id">
                <app-field-control
                  [field]="field"
                  [value]="metadata()[field.id]"
                  [invalid]="invalidKeys().has(field.id)"
                  (valueChange)="setField(field, $event)"
                />
              </dd>
            }
          </dl>
        </div>
      }
      <button dialogFooter type="button" appButton data-testid="create-entity-cancel" (click)="cancel()">
        {{ 'common.cancel' | transloco }}
      </button>
      <button
        dialogFooter
        type="button"
        appButton
        variant="primary"
        data-testid="create-entity-submit"
        [attr.aria-disabled]="!worldId() || !valid() || null"
        (click)="submit()"
      >
        {{ 'common.create' | transloco }}
      </button>
    </app-dialog>
  `,
})
export class CreateEntityDialogComponent {
  private readonly dialogRef = inject(DialogRef) as DialogRef<CreateEntityDialogData>;
  private readonly typeRegistry = inject(TypeRegistry);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly worldStore = inject(WorldStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly worlds = this.worldStore.worlds;
  protected readonly name = signal('');
  // Default the World to the one already in scope, else the first loaded (ADR-0032). A fresh
  // instance per open means these are plain initial values, not a reset effect.
  protected readonly worldId = signal<string | null>(
    this.activeWorld.worldId() ?? this.worldStore.worlds()[0]?.id ?? null,
  );
  /** The working ordered type set the author builds through the embedded editor, seeded by the Command. */
  protected readonly types = signal<readonly EntityType[]>([this.dialogRef.data.type]);
  /** The EntityDocument collected for a picked type's required Fields, sent with the create. */
  protected readonly metadata = signal<EntityDocument>({});

  /** The union of Field schemas the picked types afford (primary first, deduped) — via the registry. */
  private readonly fields = computed(() => this.typeRegistry.resolveFields(this.types()));

  /**
   * The `required` Fields the dialog prompts for — what this kind of thing is expected to carry, not a
   * precondition of creating it (ADR-0074).
   *
   * A **Field of a Structured Data Type** is never among them, whatever it was flagged: it is edited on its own
   * View, not typed into a form row (ADR-0050). Its value is minted empty at create instead.
   */
  protected readonly requiredFields = computed(() =>
    this.fields().filter((field) => field.required && !isStructuredDataType(field.dataType)),
  );

  /** The forward-only reading of the collected EntityDocument. */
  private readonly validation = computed(() =>
    validateFields(this.fields(), this.metadata(), NO_STRUCTURED_DATA_TYPES),
  );

  /**
   * Whether the collected EntityDocument may be created. Shape violations only (ADR-0074): a typed value
   * that doesn't inhabit its data-type breaks every reader of that key, while an empty `required` Field is
   * an **Incomplete** reading the author may leave for later.
   */
  protected readonly valid = computed(() => this.validation().ok);

  /** Keys carrying an ill-typed value, so their control can flag itself invalid — an empty one is not. */
  protected readonly invalidKeys = computed(() => new Set(this.validation().errors.map((error) => error.key)));

  /**
   * The create-dialog heading for the primary (first) type — already resolved, not a transloco key:
   * a user-defined type's heading is its authored name, which must never be translated (#191).
   */
  protected createLabel(types: readonly EntityType[]): string {
    return this.typeRegistry.chromeLabel(types[0], 'create');
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onWorld(event: Event): void {
    this.worldId.set((event.target as HTMLSelectElement).value);
  }

  /** Collect a required Field's value into the initial EntityDocument, clearing an emptied key (#189). */
  protected setField(field: FieldDef, value: unknown): void {
    this.metadata.update((meta) => writeField(meta, field, value));
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    const worldId = this.worldId();
    const types = this.types();
    if (!worldId || types.length === 0 || !this.valid()) return;
    const name = this.name().trim() || this.typeRegistry.chromeLabel(types[0], 'untitled');
    const metadata = this.metadata();
    this.entitiesClient
      .create(name, types, worldId, Object.keys(metadata).length ? metadata : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entity) => {
        this.dialogRef.close();
        void this.router.navigate(entityRoute(entity.worldId, entity.id));
      });
  }
}
