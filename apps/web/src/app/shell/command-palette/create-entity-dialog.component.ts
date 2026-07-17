import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
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
import { Button, Field, Input, Dialog } from '@hexly/web-ui';
import { CreateEntityDialogState } from './create-entity-dialog.state';
import { TypeRegistry } from '../../entity-types/type-registry';
import { EntityTypesEditor } from '../../pages/entity/components/entity-types-editor.component';
import { FieldControl } from '@hexly/web-entity';

/**
 * The create-Entity flow behind the `>`-prefix Create Note / Create Map Commands (ADR-0032): name +
 * World select, prefilled to `activeWorld() ?? worlds()[0]`. Mounted once alongside
 * {@link CommandPalette} and driven by {@link CreateEntityDialogState}, so a Command's `run()` can
 * open it without a reference to this component.
 *
 * The Command seeds one primary type; the embedded {@link EntityTypesEditor} lets the author pick
 * more (ADR-0048), and required Fields are collected below, gating Create until they validate.
 */
@Component({
  selector: 'app-create-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog, Field, Input, TranslocoPipe, EntityTypesEditor, FieldControl],
  template: `
    @if (dialogState.types(); as seeded) {
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

        <!-- Required Fields for every picked type, gating Create until supplied (forward-only, #189). -->
        @if (requiredFields().length > 0) {
          <div class="flex flex-col gap-1.5">
            <span class="text-2xs uppercase tracking-wider text-ink-muted">{{
              'entityTypes.requiredFieldsHeading' | transloco
            }}</span>
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
    }
  `,
})
export class CreateEntityDialog {
  protected readonly dialogState = inject(CreateEntityDialogState);
  private readonly typeRegistry = inject(TypeRegistry);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly worldStore = inject(WorldStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly worlds = this.worldStore.worlds;
  protected readonly name = signal('');
  protected readonly worldId = signal<string | null>(null);
  /** The working ordered type set the author builds through the embedded editor. */
  protected readonly types = signal<readonly EntityType[]>([]);
  /** The EntityDocument collected for a picked type's required Fields, sent with the create. */
  protected readonly metadata = signal<EntityDocument>({});

  /** The union of Field schemas the picked types afford (primary first, deduped) — via the registry. */
  private readonly fields = computed(() => this.typeRegistry.resolveFields(this.types()));

  /**
   * The required Fields the author must supply before creating.
   *
   * A **Field of a Structured Data Type** is never among them, whatever it was flagged: it is edited on its own
   * View, not typed into a form row (ADR-0050). Its value is minted empty at create instead.
   */
  protected readonly requiredFields = computed(() =>
    this.fields().filter((field) => field.required && !isStructuredDataType(field.dataType)),
  );

  /** Every picked type's required Fields must validate before the create is allowed (#189). */
  protected readonly valid = computed(
    () => validateFields(this.fields(), this.metadata(), NO_STRUCTURED_DATA_TYPES).ok,
  );

  /** Keys still failing the forward-only gate, so a required control can flag itself invalid. */
  protected readonly invalidKeys = computed(
    () =>
      new Set(
        validateFields(this.fields(), this.metadata(), NO_STRUCTURED_DATA_TYPES).errors.map((error) => error.key),
      ),
  );

  constructor() {
    // Reset to a fresh form every time the dialog opens, seeding the type set from the Command and
    // defaulting the World to the one already in scope (ADR-0032).
    effect(() => {
      const seeded = this.dialogState.types();
      untracked(() => {
        this.name.set('');
        this.types.set(seeded ?? []);
        this.metadata.set({});
        this.worldId.set(seeded ? (this.activeWorld.worldId() ?? this.worldStore.worlds()[0]?.id ?? null) : null);
      });
    });
  }

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
    this.dialogState.close();
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
        this.dialogState.close();
        void this.router.navigate(entityRoute(entity.worldId, entity.id));
      });
  }
}
