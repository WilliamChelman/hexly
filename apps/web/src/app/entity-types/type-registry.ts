import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import {
  CreateUserDefinedTypeRequest,
  deriveWorldTypeId,
  EntityType,
  Field,
  facetCategoryOf,
  isFacetableField,
  isStructuredDataType,
} from '@hexly/domain';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import {
  CORE_VIEW_DETAILS,
  EntityTypes,
  GENERIC_TYPE_DEFINITION,
  PLUGIN_TYPES,
  TypeDefinition,
  TypeLabels,
  ViewId,
  ViewInstance,
  viewInstanceKey,
} from '@hexly/web-entity';
import { PluginRegistry } from './plugin-registry';
import { ViewRegistry } from './view-registry';
// Resolved lazily through the injector in `create()` (never injected as a field): the loader injects
// this registry, so a field injection here would form a DI cycle. The import is type/token only.
import { WorldTypesLoader } from './world-types-loader';

/**
 * The pre-rename id of the Details View (ADR-0067), which user types persisted in their `views` list
 * before it became fallback-only. No data is migrated, so a stale placement may still name it; it is
 * treated as inert here, exactly as the current {@link CORE_VIEW_DETAILS} placement would be.
 */
const LEGACY_CORE_VIEW_FIELDS = 'core.view.fields';

/**
 * Root registry where Entity Types make themselves known to the type-specific UI: the one place the
 * entity page, header, card, dashboard, graph, and create surfaces read per-type icon, labels, and
 * afforded view surfaces. `register()` returns an unregister fn.
 *
 * The app seeds **no** type of its own (ADR-0051): every code type arrives through {@link PLUGIN_TYPES}
 * — `core.type.note` from the content plugin, `core.type.hex-map` from the map plugin — and a World's user-defined
 * types join at runtime, projected by {@link WorldTypesLoader}.
 *
 * Implements {@link EntityTypes}, the read contract a lib injects (bound to {@link ENTITY_TYPES} in
 * `app.config.ts`), so a shared control can ask what types exist without depending on `apps/web`.
 */
@Injectable({ providedIn: 'root' })
export class TypeRegistry implements EntityTypes {
  private readonly transloco = inject(TranslocoService);
  /** Read only from {@link viewsFor}, to resolve a placed Field's data-type to the View that renders it. */
  private readonly views = inject(ViewRegistry);
  /** Owns the enablement predicate (`isTypeActive`) the reactive outputs filter through (ADR-0052, Seam 3). */
  private readonly plugins = inject(PluginRegistry);
  /** The active World's id + Rights — the source of the {@link canCreate} Owner gate and the mint's scope. */
  private readonly active = inject(ActiveWorld);
  private readonly worlds = inject(WorldsClient);
  /** Resolves {@link WorldTypesLoader} lazily in {@link create}: it injects *this*, so eager injection would cycle. */
  private readonly injector = inject(Injector);
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /**
   * The active World's user-defined **Fields** (ADR-0054, #230), projected by {@link WorldFieldsLoader}
   * and composed over the Plugin fields by {@link resolveField}. A World Field is always active — it is
   * data, owned by no Plugin — so it never rides the enablement gate.
   */
  private readonly worldFields = signal<readonly Field[]>([]);
  private readonly worldFieldsById = computed(() => new Map(this.worldFields().map((field) => [field.id, field])));
  /** Whether a World Fields read is in flight — see {@link fieldsResolved}. */
  private readonly awaitingWorldFields = signal(false);

  /**
   * Whether the Field vocabulary is **settled**: false from {@link awaitWorldFields} until the read
   * answers. A **Facet Token** resolves its key here, synchronously, and a late response may never
   * change what a filter means (ADR-0082) — so until this reads true a key this registry does not hold
   * is *unresolved*, which is not the same as unresolvable, and no surface may report it as a miss or
   * browse as though it had never been typed.
   */
  readonly fieldsResolved = computed(() => !this.awaitingWorldFields());

  /** Every *enabled* definition, in registration order (the bundled plugins', then World types). */
  readonly all = computed(() => this.definitions().filter((def) => this.plugins.isTypeActive(def.id)));

  /**
   * The types a user may create — {@link all} minus the **System-managed** ones (ADR-0068), which the
   * system alone mints. What every create surface (split button, palette command) offers.
   */
  readonly creatable = computed(() => this.all().filter((def) => !def.systemManaged));

  /**
   * Whether the caller may **mint** a user-defined type inline (#438) — the Owner gate, the `manage`
   * right the active World's Detail carries (the same right World Settings → Types is gated on, ADR-0078).
   * A non-Owner, or a surface with no World in scope, gets `false`.
   */
  canCreate(): boolean {
    return !!this.active.world()?.rights?.includes('manage');
  }

  /**
   * Eagerly mint a **bare** user-defined type from the typed `label` (#438): derive its immutable
   * `world.type.<slug>` id (disambiguated against the existing user-defined ids), POST it Container-wide
   * (empty Fields, no Views → the generic View), then reload the World types loader so it is registered
   * client-side before the caller stages the id — referential integrity, since the entity save that
   * follows references it. Returns the new id. Owner-gated: only call when {@link canCreate}.
   */
  async create(label: string): Promise<string> {
    const worldId = this.active.worldId();
    if (!worldId) throw new Error('Cannot create a type with no active World');
    // Only user-defined ids can collide — a plugin id is in a reserved namespace it can never take.
    const existing = this.definitions().map((def) => def.id);
    const id = deriveWorldTypeId(label, existing);
    await firstValueFrom(
      this.worlds.createType(worldId, { id, label, fieldRefs: [] } satisfies CreateUserDefinedTypeRequest),
    );
    await this.injector.get(WorldTypesLoader).reloadAndSettle();
    return id;
  }

  constructor() {
    // Every code type is a bundled plugin's (ADR-0051); a disabled one drops from every output here.
    for (const def of inject(PLUGIN_TYPES, { optional: true }) ?? []) this.register(def);
  }

  register(definition: TypeDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () => this.definitions.update((list) => list.filter((d) => d !== definition));
  }

  /**
   * Swap the active World's user-defined Field set (ADR-0054, #230) — called by {@link WorldFieldsLoader}
   * on a World change or an authoring reload, so one World's Fields never linger into another.
   */
  setWorldFields(fields: readonly Field[]): void {
    this.worldFields.set(fields);
    this.awaitingWorldFields.set(false);
  }

  /**
   * The active World's Fields are being read; {@link setWorldFields} ends the wait. Called by
   * {@link WorldFieldsLoader} the moment it asks, so the gap between a cold render and the response is
   * a state a caller can see ({@link fieldsResolved}) rather than one indistinguishable from a World
   * that defines no Fields. The Fields already held stay readable through it: they label what is on
   * screen, and blanking them would flicker every chip that reads them.
   */
  awaitWorldFields(): void {
    this.awaitingWorldFields.set(true);
  }

  /**
   * Resolve one Field id → its definition, composing the active World's user-defined Fields over the
   * Plugin fields (ADR-0054, #230). A World Field wins its id (its namespace is reserved), and is always
   * active; a Plugin field rides the enablement gate, so a disabled Plugin's Field degrades to `undefined`.
   */
  private resolveField(id: string): Field | undefined {
    return this.worldFieldsById().get(id) ?? this.plugins.fieldResolver(id);
  }

  /**
   * The definition for `type`, or `undefined` for an absent, unregistered, **or disabled** id — a
   * disabled Plugin's Type reads as absent, so callers see uniform absence with no branch (ADR-0052).
   */
  get(type: string | null | undefined): TypeDefinition | undefined {
    if (type == null) return undefined;
    const def = this.definitions().find((d) => d.id === type);
    return def && this.plugins.isTypeActive(def.id) ? def : undefined;
  }

  /**
   * The definition for an Entity's primary `type`, or {@link GENERIC_TYPE_DEFINITION} for an absent,
   * unregistered, or disabled id — so chrome always resolves, never `undefined`, never a throw. The
   * `core.type.note` fallback is gone: content is a disableable Plugin now, no longer guaranteed (ADR-0052).
   */
  resolve(type: string | null | undefined): TypeDefinition {
    return this.get(type) ?? GENERIC_TYPE_DEFINITION;
  }

  /**
   * The ordered, de-duplicated {@link ViewInstance}s an Entity affords, resolved over its **effective
   * Field set** (`types`' defaults + attached `fieldIds`, ADR-0054): every type's placed views in
   * `types` order (primary first), then any attached Fields' Views. `types[0]`'s first view is the
   * default. Drives the header view toggle.
   *
   * A View is an **instance**, not a bare id: a Type's own View names no Field, while a **Structured
   * Data Type**'s View is bound to the Field it renders. A type places a Field's View by listing
   * `{ field: key }` among its views, resolved against the effective set → data-type `kind` → the View
   * the {@link ViewRegistry} holds for that kind — so two grids afford two map Views.
   *
   * A placement that cannot resolve — a Field the effective set lacks, a built-in data-type (a form
   * row, not a View), or a structured one whose plugin this build omits — contributes nothing.
   *
   * The **Details View is fallback-only** (ADR-0067): it is never a placed toggle sitting beside
   * another View, so it is appended once, at the end, *only* when nothing else was afforded. An
   * **unregistered** type (a plugin this build does not bundle) affords no View of its own and a plain
   * attached Field affords none either — both fall to that fallback, where their values stay readable.
   */
  viewsFor(
    types: readonly string[] | null | undefined,
    fieldIds?: readonly string[] | null | undefined,
  ): ViewInstance[] {
    const seen = new Map<string, ViewInstance>();
    const afford = (instance: ViewInstance) => {
      const key = viewInstanceKey(instance);
      if (!seen.has(key)) seen.set(key, instance);
    };
    // A placement resolves its Field against the whole effective set (a type default or an attachment).
    const byKey = new Map(this.effectiveFields(types, fieldIds).map((field) => [field.id, field] as const));
    const affordField = (field: Field | undefined) => {
      const view = this.views.forDataType(field?.dataType.kind);
      if (field && view) afford({ viewId: view.id, fieldKey: field.id });
    };

    for (const type of types ?? []) {
      const def = this.get(type);
      // An unregistered type affords no View of its own; the Details fallback below covers its values.
      if (!def) continue;
      for (const placement of def.views) {
        if (typeof placement === 'string') {
          // The Details View is the fallback alone, never a placed toggle beside another View (ADR-0067);
          // a stale pre-rename `core.view.fields` string from a persisted type reads through here the same.
          if (placement === CORE_VIEW_DETAILS || placement === LEGACY_CORE_VIEW_FIELDS) continue;
          // The domain keeps a string placement opaque; `viewPlacementSchema` already pinned it to `namespace.view.name`.
          afford({ viewId: placement as ViewId });
          continue;
        }
        affordField(byKey.get(placement.field));
      }
    }
    // Attached Fields append their View after the types' (CONTEXT.md → View); dedup drops a re-placed one.
    for (const id of fieldIds ?? []) {
      const field = this.resolveField(id);
      // A Field of a Structured Data Type appends its own bound View; a plain attached Field affords no
      // View at all now (ADR-0067) — it is managed in the Details View/Panel, not a toggle of its own.
      if (field && isStructuredDataType(field.dataType)) affordField(field);
    }
    // The fallback main content: an Entity affording no other View opens full-width on the Details View (ADR-0067).
    if (seen.size === 0) afford({ viewId: CORE_VIEW_DETAILS });
    return [...seen.values()];
  }

  /**
   * The union of Fields an Entity carrying `types` affords — every registered type's default Fields,
   * primary type first, deduped by id. The type-only projection of {@link effectiveFields} (no
   * attachments), for the create and type-authoring surfaces.
   */
  resolveFields(types: readonly string[] | null | undefined): Field[] {
    return this.effectiveFields(types, []);
  }

  /**
   * An Entity's **effective Field set** (CONTEXT.md → Entity, ADR-0054/ADR-0056): its attached Fields
   * (`fieldIds`) unioned with its types' defaults, deduped by `id`. Mirrors the server's
   * `WorldTypeFields.effectiveFields`.
   */
  effectiveFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const byId = new Map<string, Field>();
    const consider = (field: Field | undefined) => {
      if (field && !byId.has(field.id)) byId.set(field.id, field);
    };
    for (const id of fieldIds ?? []) consider(this.resolveField(id));
    for (const type of types ?? []) {
      const def = this.get(type);
      // A type declares its default Fields by id only (`fieldRefs`, ADR-0054) — one resolution path.
      for (const id of def?.fieldRefs ?? []) consider(this.resolveField(id));
    }
    return [...byId.values()];
  }

  /**
   * Resolve one registered Field by its `id` (ADR-0054) — a **World Field** or a **Plugin Field**, or
   * `undefined` for an unknown or disabled one. What the fields editor reads to label an Entity's
   * attached Field chips.
   */
  field(id: string): Field | undefined {
    return this.resolveField(id);
  }

  /**
   * Every registered Field a World Owner may reference (ADR-0054): its World-defined Fields (always
   * active) plus the enabled Plugin Fields — the offer the World Types editor's reference picker reads.
   * A disabled Plugin's Fields drop out; a reference to one would only degrade to a plain value.
   */
  availableFields(): Field[] {
    return [...this.worldFields(), ...this.plugins.fields.filter((field) => this.plugins.isFieldActive(field.id))];
  }

  /**
   * Every **Facet** key a Facet Token may name (ADR-0082): each facetable scalar Field's id, then the
   * dimensions this build's **Structured Data Types** harvest — the same two sources, in the same order,
   * the server's facet read draws its keys from (ADR-0055).
   */
  facetKeys(): string[] {
    const keys = new Set<string>();
    for (const field of this.availableFields()) if (isFacetableField(field)) keys.add(field.id);
    for (const dataType of this.plugins.structuredDataTypes.values())
      for (const dimension of dataType.facetDimensions ?? []) keys.add(dimension.key);
    return [...keys];
  }

  /**
   * Whether this registry can say **yet** what `key` means as a Facet (ADR-0082). A reserved name is
   * decided the moment it is typed — no read widens or narrows it — while a Field key is only decided
   * once {@link fieldsResolved}: `$cr:5` on a cold load names a Field that may be about to exist, and a
   * surface that answered it now would report a miss, and browse unfiltered, until the response corrected
   * both. Read per key rather than wholesale, so `$type:npc` never waits on the Fields read.
   */
  facetKeySettled(key: string): boolean {
    return this.fieldsResolved() || facetCategoryOf(key) !== undefined;
  }

  /**
   * The registered Fields an Entity carrying `types`/`fieldIds` may still **attach directly** (ADR-0054):
   * every World-defined Field and enabled Plugin Field whose `id` its effective set does not already cover
   * — so the attach picker never offers a Field a type default already places, or one already attached.
   * World Fields come first (always active); a disabled Plugin's Fields drop out (they would only degrade
   * to a plain value). A **System-managed** Field (ADR-0068) is never attachable: the system alone attaches it.
   */
  attachableFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const present = new Set(this.effectiveFields(types, fieldIds).map((field) => field.id));
    return this.availableFields().filter((field) => !present.has(field.id) && !field.systemManaged);
  }

  /**
   * A type's **display name** — the noun every surface shows for it ("Note", "Map", "Deity").
   * A **user-defined type's name is authored data, never a transloco key**: its `labelText` is
   * returned verbatim. A code-registered type's noun is its own `labels.name` copy, shipped in its
   * plugin's catalog — the app catalog cannot know every plugin's types (#312), so the
   * `entityBrowser.type.<id>` lookup is only the unregistered-type last resort.
   *
   * Read it through the `typeName` pipe in a template; call it directly from a `computed` that also
   * tracks `transloco.activeLang()`, so the name re-resolves on a language switch.
   */
  name(type: string | null | undefined): string {
    const def = this.get(type);
    if (def?.labelText) return def.labelText;
    if (def?.labels) return this.transloco.translate(def.labels.name);
    return this.transloco.translate(`entityBrowser.type.${type}`);
  }

  /**
   * One of a type's **chrome** labels — the create heading, the untitled default, the header eyebrow,
   * the editor's accessible name. A code-registered type declares these as transloco keys; a
   * user-defined type has no copy at all, so every one of its chrome labels resolves to its authored
   * name (again, never translated).
   */
  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string {
    const def = this.resolve(type);
    if (def.labelText) return def.labelText;
    return def.labels ? this.transloco.translate(def.labels[key]) : this.name(type);
  }

  /**
   * The type ids that afford `view` — e.g. `typeIdsForView('core.view.map')` backs the dashboard/list
   * "maps" filter. Asks {@link viewsFor} rather than reading the declared list, because a type affords
   * the map View by *placing a grid Field*, which is the only way any type does.
   */
  typeIdsForView(view: ViewId): EntityType[] {
    return this.all()
      .filter((d) => this.viewsFor([d.id]).some((v) => v.viewId === view))
      .map((d) => d.id);
  }
}
