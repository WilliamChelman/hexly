import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { WorldMember } from '@hexly/domain';
import { WorldsClient, UserDirectoryClient, ToasterService } from '@hexly/web-core';
import { MockWorldsClient, MockUserDirectoryClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { COLLAB_TEST_CATALOGS } from '../i18n/test-catalogs';
import { MemberSetComponent } from './member-set.component';

describe('MemberSet', () => {
  let worlds: MockWorldsClient;
  let users: MockUserDirectoryClient;
  let toaster: ToasterService;

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    users = new MockUserDirectoryClient();
    await TestBed.configureTestingModule({
      imports: [MemberSetComponent, provideTranslocoTesting(COLLAB_TEST_CATALOGS)],
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: UserDirectoryClient, useValue: users },
      ],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    users.list.mockReturnValue(
      of([
        { id: 'u1', displayName: 'Ada' },
        { id: 'u2', displayName: 'Bob' },
        { id: 'u3', displayName: 'Carol' },
      ]),
    );
  });

  function render(id: string, members: WorldMember[], owners: string[] = ['u1']) {
    worlds.members.mockReturnValue(of(members));
    worlds.owners.mockReturnValue(of(owners));
    const fixture = TestBed.createComponent(MemberSetComponent);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  it('names each member from the directory and shows their role', () => {
    const { nativeElement: el } = render('w1', [{ userId: 'u2', role: 'contributor' }]);

    expect($(el, '[data-testid="member-u2"]')?.textContent).toContain('Bob');
    expect(($(el, '[data-testid="role-u2"]') as HTMLSelectElement).value).toBe('contributor');
  });

  it('excludes both existing members and Owners from the add candidates', () => {
    // u1 is an Owner, u2 is already a member — only Carol (u3) remains addable.
    const { nativeElement: el } = render('w1', [{ userId: 'u2', role: 'viewer' }], ['u1']);
    const options = Array.from(($(el, '[data-testid="add-select"]') as HTMLSelectElement).options).map((o) => o.value);

    expect(options).toEqual(['', 'u3']);
  });

  it('adds a member with the chosen role', () => {
    const fixture = render('w1', []);
    const el = fixture.nativeElement as HTMLElement;
    worlds.addMember.mockReturnValue(of([{ userId: 'u3', role: 'viewer' }]));

    const user = $(el, '[data-testid="add-select"]') as HTMLSelectElement;
    user.value = 'u3';
    user.dispatchEvent(new Event('change'));
    const role = $(el, '[data-testid="add-role"]') as HTMLSelectElement;
    role.value = 'viewer';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ($(el, '[data-testid="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worlds.addMember).toHaveBeenCalledWith('w1', 'u3', 'viewer');
    expect($(el, '[data-testid="member-u3"]')?.textContent).toContain('Carol');
  });

  it('changes a member’s role via the row select', () => {
    const fixture = render('w1', [{ userId: 'u2', role: 'contributor' }]);
    const el = fixture.nativeElement as HTMLElement;
    worlds.setMemberRole.mockReturnValue(of([{ userId: 'u2', role: 'viewer' }]));

    const role = $(el, '[data-testid="role-u2"]') as HTMLSelectElement;
    role.value = 'viewer';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(worlds.setMemberRole).toHaveBeenCalledWith('w1', 'u2', 'viewer');
  });

  it('reverts the row select to the known role when a role change is rejected', () => {
    const show = vi.spyOn(toaster, 'show');
    const fixture = render('w1', [{ userId: 'u2', role: 'contributor' }]);
    const el = fixture.nativeElement as HTMLElement;
    worlds.setMemberRole.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    const role = $(el, '[data-testid="role-u2"]') as HTMLSelectElement;
    role.value = 'viewer';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // The server refused, so the select must snap back to the role it still holds.
    expect(role.value).toBe('contributor');
    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('removes a member', () => {
    const fixture = render('w1', [{ userId: 'u2', role: 'contributor' }]);
    const el = fixture.nativeElement as HTMLElement;
    worlds.removeMember.mockReturnValue(of([]));

    ($(el, '[data-testid="remove-u2"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worlds.removeMember).toHaveBeenCalledWith('w1', 'u2');
    expect($(el, '[data-testid="member-u2"]')).toBeNull();
  });

  it('warns instead of throwing when the member set fails to load', () => {
    const show = vi.spyOn(toaster, 'show');
    worlds.members.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    worlds.owners.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(MemberSetComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();

    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});
