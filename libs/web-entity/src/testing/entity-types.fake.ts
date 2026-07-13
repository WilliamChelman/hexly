import { inject, Provider, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ENTITY_TYPES, EntityTypes } from '../lib/entity-types';
import { TypeDefinition, TypeLabels } from '../lib/type-definition';

/**
 * The note type id, inlined rather than imported: it ships from `@hexly/plugin-content` now (ADR-0051),
 * and `web-entity` cannot depend on a plugin that itself depends on `web-entity` (a project cycle).
 */
const CORE_NOTE = 'core.note';

/**
 * A minimal {@link EntityTypes} over a spec-declared set of types. Names and chrome resolve as the real
 * registry's do: a user-defined type's authored name verbatim, a code type's through its transloco keys.
 */
export class FakeEntityTypes implements EntityTypes {
  private readonly definitions = signal<readonly TypeDefinition[]>([]);
  readonly all = this.definitions.asReadonly();

  constructor(
    definitions: readonly TypeDefinition[],
    private readonly translate: (key: string) => string,
  ) {
    this.definitions.set(definitions);
  }

  name(type: string | null | undefined): string {
    const def = this.get(type);
    return def?.labelText ?? this.translate(`entityBrowser.type.${type}`);
  }

  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string {
    // Resolve as the real registry does: an unregistered id falls back to `core.note`'s chrome, so
    // the header always has *something* to draw (`TypeRegistry.resolve`). A spec whose set omits the
    // note gets the raw lookup rather than a fallback the app would never take.
    const def = this.get(type) ?? this.get(CORE_NOTE);
    if (!def) return this.name(type);
    if (def.labelText) return def.labelText;
    return def.labels ? this.translate(def.labels[key]) : this.name(type);
  }

  private get(type: string | null | undefined): TypeDefinition | undefined {
    return this.definitions().find((d) => d.id === type);
  }
}

/** Bind a {@link FakeEntityTypes} over `definitions` to the {@link ENTITY_TYPES} token. */
export function provideEntityTypesTesting(definitions: readonly TypeDefinition[]): Provider[] {
  return [
    {
      provide: ENTITY_TYPES,
      useFactory: () => {
        const transloco = inject(TranslocoService);
        return new FakeEntityTypes(definitions, (key) => transloco.translate(key));
      },
    },
  ];
}
