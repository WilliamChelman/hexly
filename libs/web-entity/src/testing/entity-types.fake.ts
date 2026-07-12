import { inject, Provider, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { CORE_NOTE } from '@hexly/domain';
import { ENTITY_TYPES, EntityTypes } from '../lib/entity-types';
import { TypeDefinition, TypeLabels } from '../lib/type-definition';

/**
 * A minimal {@link EntityTypes} for a spec that renders a control reading the type registry — the
 * {@link EntityLinkPicker} and its hosts. It stands in for the app's `TypeRegistry` exactly as
 * `FakeEntitySession` stands in for its concrete session: a spec declares the types it wants to see
 * and never boots the app to get them.
 *
 * Names and chrome resolve the way the real registry's do — a user-defined type's authored name
 * verbatim, a code type's through its transloco keys — so a spec asserting translated copy exercises
 * the real path.
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
