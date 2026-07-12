import { inject, Pipe, PipeTransform } from '@angular/core';
import { TypeRegistry } from './type-registry';

/**
 * Renders an Entity Type id as its display name ("Note", "Hex Map", "Deity") through
 * {@link TypeRegistry.name} — so a **user-defined type's authored name is shown verbatim**, never
 * run through transloco as if it were a copy key (#191).
 *
 * Impure, for the same reason {@link HexlyDatePipe} is: the name derives from registry and Transloco
 * state, not from the input alone, so a language switch — or a World's types arriving — must
 * re-render the names already on screen. It only re-runs when its (OnPush) host is change-detected.
 */
@Pipe({ name: 'typeName', pure: false })
export class TypeNamePipe implements PipeTransform {
  private readonly types = inject(TypeRegistry);

  transform(type: string | null | undefined): string {
    return this.types.name(type);
  }
}
