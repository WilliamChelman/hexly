import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateUserRequest, InstanceRole, UserAccount } from '@hexly/domain';

/**
 * HTTP client for the user-management (`/api/users`) surface (ADR-0047): account
 * management with zero content powers. Stateless — the users panel reads {@link list}
 * and issues the mutations. Unlike the public {@link UserDirectoryClient} directory,
 * these rows carry the email (a management concern). The Superadmin flag is toggled
 * here too — one page, one client — even though the server refuses it for a plain
 * `manage-users` holder.
 */
@Injectable({ providedIn: 'root' })
export class UsersClient {
  private readonly http = inject(HttpClient);

  list(): Observable<UserAccount[]> {
    return this.http.get<UserAccount[]>('/api/users');
  }

  createUser(req: CreateUserRequest): Observable<void> {
    return this.http.post<void>('/api/users', req);
  }

  setDisabled(id: string, disabled: boolean): Observable<void> {
    return this.http.patch<void>(`/api/users/${id}/disabled`, { disabled });
  }

  resetPassword(id: string, password: string): Observable<void> {
    return this.http.post<void>(`/api/users/${id}/password`, { password });
  }

  /**
   * Replace the account's whole Instance-Role set (ADR-0047) — grant/revoke
   * `manage-users` and `create-worlds` in one write. Superadmin is not a member;
   * it has its own endpoint.
   */
  setRoles(id: string, roles: readonly InstanceRole[]): Observable<void> {
    return this.http.patch<void>(`/api/users/${id}/roles`, { roles });
  }

  setSuperadmin(id: string, isSuperadmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/users/${id}/superadmin`, { isSuperadmin });
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/users/${id}`);
  }
}
