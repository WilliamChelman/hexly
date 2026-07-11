import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserSummary } from '@hexly/domain';

/**
 * HTTP client for the Instance user directory (#158). Stateless — the owner-set
 * UI reads it to name owners and pick a co-Owner. Only id + displayName; the
 * email stays private (ADR-0004). Distinct from the {@link UsersClient}
 * account-management surface, which carries the email and lives under `/api/users`.
 */
@Injectable({ providedIn: 'root' })
export class UserDirectoryClient {
  private readonly http = inject(HttpClient);

  list(): Observable<UserSummary[]> {
    return this.http.get<UserSummary[]>('/api/users/directory');
  }
}
