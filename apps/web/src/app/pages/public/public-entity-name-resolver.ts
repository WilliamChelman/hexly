import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntityNameResolver } from '@hexly/content-editor';

/**
 * The {@link EntityNameResolver} for a Public Link page (ADR-0037, #162): resolves nothing.
 *
 * A Public Link is a capability — possession of the token grants exactly its own scope and no
 * more. Resolving an in-content Entity Link would read *another* Entity's summary, so a link to
 * B inside a shared A could turn A's token into a peek at B (possibly shared to someone else, or
 * not at all). We refuse that lookup entirely: every in-content Entity Link renders as its frozen
 * label, non-navigable — deliberately "broken" rather than any scope-widening read. (This also
 * sidesteps the authenticated `/api/entities` calls the base resolver makes, which 401 for an
 * anonymous reader.)
 */
@Injectable()
export class PublicEntityNameResolver extends EntityNameResolver {
  protected override fetchByIds(_ids: string[]): Observable<EntitySummary[]> {
    return of([]);
  }
}
