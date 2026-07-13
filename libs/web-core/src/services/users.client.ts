import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateUserRequest, InstanceRole, UserAccount } from '@hexly/domain';

/**
 * HTTP client for the user-management (`/api/users`) surface (ADR-0047). Unlike the public
 * {@link UserDirectoryClient} directory, these rows carry the email. {@link setSuperadmin} lives
 * here too, though the server refuses it for a plain `manage-users` holder.
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
   * Replace the account's whole Instance-Role set (ADR-0047). Superadmin is not a member of
   * the set; it has its own endpoint.
   */
  setRoles(id: string, roles: readonly InstanceRole[]): Observable<void> {
    return this.http.patch<void>(`/api/users/${id}/roles`, { roles });
  }

  setSuperadmin(id: string, isSuperadmin: boolean): Observable<void> {
    return this.http.patch<void>(`/api/users/${id}/superadmin`, {
      isSuperadmin,
    });
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`/api/users/${id}`);
  }
}
