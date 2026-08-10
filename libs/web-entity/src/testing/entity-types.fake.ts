import { computed, inject, Provider, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { deriveWorldTypeId, EntityType, Field, isFacetableField } from '@hexly/domain';
import { ENTITY_TYPES, EntityTypes } from '../models/entity-types';
import { TypeDefinition, TypeLabels } from '../models/type-definition';

/**
 * The note type id, inlined rather than imported: it ships from `@hexly/plugin-content` now (ADR-0051),
 * and `web-entity` cannot depend on a plugin that itself depends on `web-entity` (a project cycle).
 */
const CORE_NOTE = 'core.type.note';

/**
 * A minimal {@link EntityTypes} over a spec-declared set of types. Names and chrome resolve as the real
 * registry's do: a user-defined type's authored name verbatim, a code type's through its transloco keys.
 */
export class FakeEntityTypes implements EntityTypes {
  private readonly definitions = signal<readonly TypeDefinition[]>([]);
  readonly all = this.definitions.asReadonly();
  /** Mirror the real registry: a System-managed Type (ADR-0068) is never user-creatable. */
  readonly creatable = computed(() => this.all().filter((def) => !def.systemManaged));

  /** The Owner gate a spec flips through {@link setCanCreate}; false by default (a non-Owner). */
  private readonly _canCreate = signal(false);
  /** The labels {@link create} was called with, in order — for a spec to assert an inline mint fired. */
  readonly created: string[] = [];

  /** The spec's registered Fields by id (ADR-0054) — what a type's `fieldRefs` and an attached `fieldIds` resolve against. */
  private readonly fieldsById: Map<string, Field>;

  constructor(
    definitions: readonly TypeDefinition[],
    private readonly translate: (key: string) => string,
    fields: readonly Field[] = [],
  ) {
    this.definitions.set(definitions);
    this.fieldsById = new Map(fields.map((field) => [field.id, field]));
  }

  name(type: string | null | undefined): string {
    const def = this.get(type);
    if (def?.labelText) return def.labelText;
    if (def?.labels) return this.translate(def.labels.name);
    return this.translate(`entityBrowser.type.${type}`);
  }

  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string {
    // Resolve as the real registry does: an unregistered id falls back to `core.type.note`'s chrome, so
    // the header always has *something* to draw (`TypeRegistry.resolve`). A spec whose set omits the
    // note gets the raw lookup rather than a fallback the app would never take.
    const def = this.get(type) ?? this.get(CORE_NOTE);
    if (!def) return this.name(type);
    if (def.labelText) return def.labelText;
    return def.labels ? this.translate(def.labels[key]) : this.name(type);
  }

  resolveFields(types: readonly string[] | null | undefined): Field[] {
    return this.effectiveFields(types, []);
  }

  effectiveFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const byId = new Map<string, Field>();
    const consider = (id: string) => {
      const field = this.fieldsById.get(id);
      if (field && !byId.has(field.id)) byId.set(field.id, field);
    };
    // Attached Fields first, then each type's `fieldRefs` primary-first (ADR-0054); deduped by id (ADR-0056).
    for (const id of fieldIds ?? []) consider(id);
    for (const type of types ?? []) {
      const def = this.get(type);
      for (const id of def?.fieldRefs ?? []) consider(id);
    }
    return [...byId.values()];
  }

  canCreate(): boolean {
    return this._canCreate();
  }

  /** Test helper: flip the Owner gate {@link canCreate} reads (#438). */
  setCanCreate(canCreate: boolean): void {
    this._canCreate.set(canCreate);
  }

  /**
   * Mirror the real registry's eager mint (#438): derive the id from the label (disambiguated against
   * the current user-defined ids), register a bare type so its name resolves, and resolve to the id.
   */
  async create(label: string): Promise<string> {
    this.created.push(label);
    const existing = this.all().map((def) => def.id);
    const id = deriveWorldTypeId(label, existing) as EntityType;
    this.definitions.update((defs) => [...defs, { id, icon: 'label', views: [], labelText: label, fieldRefs: [] }]);
    return id;
  }

  get(type: string | null | undefined): TypeDefinition | undefined {
    return this.definitions().find((d) => d.id === type);
  }

  field(id: string): Field | undefined {
    return this.fieldsById.get(id);
  }

  /** The spec's facetable Fields (ADR-0082); no Structured Data Types, a fake registering no plugins. */
  facetKeys(): string[] {
    return [...this.fieldsById.values()].filter(isFacetableField).map((field) => field.id);
  }

  attachableFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const present = new Set(this.effectiveFields(types, fieldIds).map((field) => field.id));
    // Mirror the real registry: a System-managed Field (ADR-0068) is never user-attachable.
    return [...this.fieldsById.values()].filter((field) => !present.has(field.id) && !field.systemManaged);
  }
}

/**
 * Bind a {@link FakeEntityTypes} over `definitions` to the {@link ENTITY_TYPES} token. `fields` are the
 * registered Fields a type's `fieldRefs` (and an attached `fieldIds`) resolve against (ADR-0054).
 */
export function provideEntityTypesTesting(
  definitions: readonly TypeDefinition[],
  fields: readonly Field[] = [],
): Provider[] {
  return [
    {
      provide: ENTITY_TYPES,
      useFactory: () => {
        const transloco = inject(TranslocoService);
        return new FakeEntityTypes(definitions, (key) => transloco.translate(key), fields);
      },
    },
  ];
}
