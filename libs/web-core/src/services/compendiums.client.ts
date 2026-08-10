import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CompendiumSummary } from '@hexly/domain';

/**
 * HTTP client for the installed **Compendiums** (CONTEXT.md → Compendium). Outside the World scope,
 * because a Compendium is: Instance-wide, with no members and the same answer for every signed-in
 * caller (ADR-0078).
 *
 * One read, deliberately: the **Library** learns which Containers to name from the World's **Mounts**
 * rather than from what happens to be installed (ADR-0080, #412), so nothing asks for the whole shelf
 * any more.
 */
@Injectable({ providedIn: 'root' })
export class CompendiumsClient {
  private readonly http = inject(HttpClient);

  /**
   * One installed pack — the **Compendium page**'s read, whose session is the whole standing here
   * (ADR-0078). 404 when the id names no pack. Every reader is signed in: the anonymous token read
   * retired with the Public Link (ADR-0084).
   */
  get(id: string): Observable<CompendiumSummary> {
    return this.http.get<CompendiumSummary>(`/api/compendiums/${id}`);
  }
}
