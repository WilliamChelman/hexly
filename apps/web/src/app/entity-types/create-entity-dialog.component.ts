import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  EntityDetail,
  EntityType,
  Field as FieldDef,
  isStructuredDataType,
  EntityDocument,
  NO_STRUCTURED_DATA_TYPES,
  validateFields,
  writeField,
} from '@hexly/domain';
import { ActiveWorld, EntitiesClient, WorldStore } from '@hexly/web-core';
import {
  ButtonComponent,
  ChipComponent,
  FieldComponent,
  InputComponent,
  DialogComponent,
  DialogRef,
} from '@hexly/web-ui';
import { TypeRegistry } from './type-registry';
import { EntityTypesEditorComponent } from '../pages/entity/components/entity-types-editor.component';
import { withTags } from '../pages/entity/components/tag-suggestions';
import { FieldControlComponent } from '@hexly/web-entity';

/** What a create Command hands the dialog when it opens it: the seeded primary type (ADR-0048, #189). */
export interface CreateEntityDialogData {
  readonly type: EntityType;
  /**
   * Pins the World and locks its select. A caller creating from inside an Entity passes that Entity's
   * World, because minting elsewhere would author a cross-World link as a side effect of typing
   * (ADR-0073). Omitted, the author picks.
   */
  readonly worldId?: string;
  /** Prefills the name — what an `@` mention already typed before asking for the dialog (ADR-0073). */
  readonly name?: string;
  /** Prefills the tags — Inline Creation's `entities.inlineTag`, editable before the Entity exists. */
  readonly tags?: readonly string[];
}

/** What the dialog closes with on a create — `undefined` on cancel. */
export type CreateEntityDialogResult = EntityDetail;

/**
 * The create-Entity flow behind the `>`-prefix Create Note / Create Map Commands (ADR-0032): name +
 * World select, prefilled to `activeWorld() ?? worlds()[0]`. Opened on demand through
 * {@link DialogService}, seeded via its {@link DialogRef} — so a Command's `run()` launches it with
 * no reference to this component and no shared open-state signal to bridge them.
 *
 * It **returns** the created Entity and navigates nowhere — routing is its caller's concern, and a
 * caller may seed the name and Tags and pin the World (ADR-0073).
 *
 * The Command seeds one primary type; the embedded {@link EntityTypesEditorComponent} lets the author pick
 * more (ADR-0048), and the picked types' `required` Fields are collected below as a prompt, not a gate —
 * only a *present* ill-typed value holds Create back (ADR-0074).
 */
@Component({
  selector: 'app-create-entity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    ChipComponent,
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
          [disabled]="locked"
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

      <!-- Tags, set before the thing exists: a mention seeds the Instance's inline Tag here and the
           author may drop it or add their own (ADR-0073). Free text, no vocabulary picker — the
           World's existing tags are the entity page's affordance, not the create form's. -->
      <div appField [label]="'entityTags.heading' | transloco">
        <div class="flex flex-wrap items-center gap-2" data-testid="create-entity-tags">
          @for (tag of tags(); track tag) {
            <app-chip>
              {{ tag }}
              <button
                type="button"
                class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
                [attr.aria-label]="'entityTags.removeLabel' | transloco: { tag }"
                [attr.data-testid]="'create-tag-remove-' + tag"
                (click)="removeTag(tag)"
              >
                &times;
              </button>
            </app-chip>
          }
          <input
            type="text"
            data-testid="create-entity-tag-input"
            class="min-w-32 flex-1 bg-transparent border-0 text-sm text-ink outline-none placeholder:text-ink-muted"
            [attr.aria-label]="'entityTags.addLabel' | transloco"
            [attr.placeholder]="'entityTags.addPlaceholder' | transloco"
            (keydown.enter)="addTags($event)"
            (blur)="addTags($event)"
          />
        </div>
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
      <!-- The failure is reported *here*, not as a toast: a native <dialog> owns the top layer, so a
           toast would sit behind it — and a caller may be waiting on this dialog (ADR-0073). -->
      @if (failed()) {
        <p role="alert" data-testid="create-entity-error" class="m-0 text-sm text-danger">
          {{ 'entityTypes.createError' | transloco }}
        </p>
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
  private readonly dialogRef = inject(DialogRef) as DialogRef<CreateEntityDialogData, CreateEntityDialogResult>;
  private readonly typeRegistry = inject(TypeRegistry);
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly worldStore = inject(WorldStore);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly worlds = this.worldStore.worlds;
  protected readonly name = signal(this.dialogRef.data.name ?? '');
  /** The Tag set to mint with, seeded by the caller (ADR-0073) and editable before the Entity exists. */
  protected readonly tags = signal<readonly string[]>(this.dialogRef.data.tags ?? []);
  /** A caller that pinned the World gets a locked select, not an offer (ADR-0073). */
  protected readonly locked = this.dialogRef.data.worldId !== undefined;
  // Default the World to the caller's pin, else the one already in scope, else the first loaded
  // (ADR-0032). A fresh instance per open means these are plain initial values, not a reset effect.
  protected readonly worldId = signal<string | null>(
    this.dialogRef.data.worldId ?? this.activeWorld.worldId() ?? this.worldStore.worlds()[0]?.id ?? null,
  );
  /** The working ordered type set the author builds through the embedded editor, seeded by the Command. */
  protected readonly types = signal<readonly EntityType[]>([this.dialogRef.data.type]);
  /** The EntityDocument collected for a picked type's required Fields, sent with the create. */
  protected readonly metadata = signal<EntityDocument>({});

  /** Whether the last create came back a failure — the dialog stays open on one, with what was typed. */
  protected readonly failed = signal(false);

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

  /**
   * Add the typed tag(s) and clear the input. Blur as well as Enter, so a tag typed and not confirmed
   * isn't lost to a click on Create (#88).
   */
  protected addTags(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    input.value = '';
    this.tags.update((tags) => withTags(tags, raw));
  }

  protected removeTag(tag: string): void {
    this.tags.update((tags) => tags.filter((t) => t !== tag));
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
    const tags = this.tags();
    this.failed.set(false);
    this.entitiesClient
      .create(name, types, worldId, Object.keys(metadata).length ? metadata : undefined, tags.length ? tags : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entity) => this.dialogRef.close(entity),
        // Staying open with the message is the whole fix: a mention is holding the author's typed text
        // until this dialog closes (ADR-0073), so a silent failure strands both — Retry or Cancel, and
        // Cancel settles the caller as a decline does.
        error: () => this.failed.set(true),
      });
  }
}
