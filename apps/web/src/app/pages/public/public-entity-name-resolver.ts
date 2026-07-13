import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntityNameResolver } from '@hexly/plugin-content/web';

/**
 * The {@link EntityNameResolver} for a Public Link page (ADR-0037): resolves nothing.
 *
 * A Public Link's token grants exactly its own scope. Resolving an in-content Entity Link reads
 * *another* Entity's summary, so a link to B inside a shared A would turn A's token into a peek at
 * B. Every in-content Entity Link therefore renders as its frozen label, non-navigable — never a
 * scope-widening read. (It also sidesteps the authenticated `/api/entities` calls the base resolver
 * makes, which 401 for an anonymous reader.)
 */
@Injectable()
export class PublicEntityNameResolver extends EntityNameResolver {
  protected override fetchByIds(_ids: string[]): Observable<EntitySummary[]> {
    return of([]);
  }
}
