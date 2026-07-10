import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminUser, CreateUserRequest, ReindexJob } from '@hexly/domain';

/**
 * HTTP client for the Instance Admin surface (ADR-0037, #163): account management.
 * Stateless — the admin panel reads {@link list} and issues the mutations. Unlike the
 * public {@link UsersClient} directory, these rows carry the email (an Admin concern).
 * The Superadmin-only calls live here too — one page, one client — even though they hit
 * a different surface on the server; it refuses them for a plain Admin.
 */
@Injectable({ providedIn: 'root' })
export class AdminClient {
  private readonly http = inject(HttpClient);

  list(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>('/api/admin/users');
  }

  createUser(req: CreateUserRequest): Observable<void> {
    return this.http.post<void>('/api/admin/users', req);
  }

  setDisabled(id: string, disabled: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/disabled`, { disabled });
  }

  resetPassword(id: string, password: string): Observable<void> {
    return this.http.post<void>(`/api/admin/users/${id}/password`, { password });
  }

  setAdmin(id: string, isAdmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/admin`, { isAdmin });
  }

  /** Grant or revoke the World Creation capability (ADR-0040). */
  setCanCreateWorlds(id: string, canCreateWorlds: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/can-create-worlds`, {
      canCreateWorlds,
    });
  }

  setSuperadmin(id: string, isSuperadmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/admin/users/${id}/superadmin`, { isSuperadmin });
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/users/${id}`);
  }

  /**
   * Start recomputing every Entity's document-derived state (ADR-0046). A Superadmin repair
   * action, so it lands on the `superadmin` surface rather than `admin` — the Admin tier reaches
   * no Entity. Returns at once with the job `running`; follow it with {@link reindexStatus}.
   */
  reindex(): Observable<ReindexJob> {
    return this.http.post<ReindexJob>('/api/superadmin/reindex', {});
  }

  /** Where the instance's Reindex stands — polled while it runs, readable before it ever ran. */
  reindexStatus(): Observable<ReindexJob> {
    return this.http.get<ReindexJob>('/api/superadmin/reindex');
  }
}
