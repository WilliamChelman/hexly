import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EntityGrant } from '@hexly/domain';
import { EntitiesClient, UserDirectoryClient, ToasterService } from '@hexly/web-core';
import { MockEntitiesClient, MockUserDirectoryClient, provideTranslocoTesting } from '@hexly/web-core/testing';
import { GrantSet } from './grant-set';

describe('GrantSet', () => {
  let entities: MockEntitiesClient;
  let users: MockUserDirectoryClient;
  let toaster: ToasterService;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    users = new MockUserDirectoryClient();
    await TestBed.configureTestingModule({
      imports: [GrantSet, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: entities },
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

  function render(id: string, grants: EntityGrant[], owners: string[] = ['u1']) {
    entities.grants.mockReturnValue(of(grants));
    entities.owners.mockReturnValue(of(owners));
    const fixture = TestBed.createComponent(GrantSet);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  it('names each grantee from the directory and shows their role', () => {
    const { nativeElement: el } = render('e1', [{ userId: 'u2', role: 'viewer' }]);

    expect($(el, '[data-testid="grant-u2"]')?.textContent).toContain('Bob');
    expect(($(el, '[data-testid="grant-role-u2"]') as HTMLSelectElement).value).toBe('viewer');
  });

  it('excludes both existing grantees and the Entity’s Owners from the add candidates', () => {
    // u1 is an Owner, u2 is already a grantee — only Carol (u3) remains addable.
    const { nativeElement: el } = render('e1', [{ userId: 'u2', role: 'editor' }], ['u1']);
    const options = Array.from(($(el, '[data-testid="grant-add-select"]') as HTMLSelectElement).options).map(
      (o) => o.value,
    );

    expect(options).toEqual(['', 'u3']);
  });

  it('grants a person with the chosen role', () => {
    const fixture = render('e1', []);
    const el = fixture.nativeElement as HTMLElement;
    entities.addGrant.mockReturnValue(of([{ userId: 'u3', role: 'editor' }]));

    const user = $(el, '[data-testid="grant-add-select"]') as HTMLSelectElement;
    user.value = 'u3';
    user.dispatchEvent(new Event('change'));
    const role = $(el, '[data-testid="grant-add-role"]') as HTMLSelectElement;
    role.value = 'editor';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ($(el, '[data-testid="grant-add"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.addGrant).toHaveBeenCalledWith('e1', 'u3', 'editor');
    expect($(el, '[data-testid="grant-u3"]')?.textContent).toContain('Carol');
  });

  it('changes a grantee’s role via the row select (an upsert)', () => {
    const fixture = render('e1', [{ userId: 'u2', role: 'viewer' }]);
    const el = fixture.nativeElement as HTMLElement;
    entities.addGrant.mockReturnValue(of([{ userId: 'u2', role: 'editor' }]));

    const role = $(el, '[data-testid="grant-role-u2"]') as HTMLSelectElement;
    role.value = 'editor';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(entities.addGrant).toHaveBeenCalledWith('e1', 'u2', 'editor');
  });

  it('reverts the row select to the known role when a role change is rejected', () => {
    const show = vi.spyOn(toaster, 'show');
    const fixture = render('e1', [{ userId: 'u2', role: 'viewer' }]);
    const el = fixture.nativeElement as HTMLElement;
    entities.addGrant.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    const role = $(el, '[data-testid="grant-role-u2"]') as HTMLSelectElement;
    role.value = 'editor';
    role.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // The server refused, so the select must snap back to the role it still holds.
    expect(role.value).toBe('viewer');
    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('revokes a grant', () => {
    const fixture = render('e1', [{ userId: 'u2', role: 'viewer' }]);
    const el = fixture.nativeElement as HTMLElement;
    entities.removeGrant.mockReturnValue(of([]));

    ($(el, '[data-testid="grant-revoke-u2"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.removeGrant).toHaveBeenCalledWith('e1', 'u2');
    expect($(el, '[data-testid="grant-u2"]')).toBeNull();
  });

  it('warns instead of throwing when the grant set fails to load', () => {
    const show = vi.spyOn(toaster, 'show');
    entities.grants.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    entities.owners.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(GrantSet);
    fixture.componentRef.setInput('id', 'e1');
    fixture.detectChanges();

    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});
