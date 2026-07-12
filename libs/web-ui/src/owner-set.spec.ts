import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthClient, WorldsClient, EntitiesClient, UserDirectoryClient, ToasterService } from '@hexly/web-core';
import {
  MockAuthClient,
  MockWorldsClient,
  MockEntitiesClient,
  MockUserDirectoryClient,
  provideTranslocoTesting,
} from '@hexly/web-core/testing';
import { WEB_UI_TEST_CATALOGS } from './i18n/test-catalogs';
import { OwnerSet } from './owner-set';

describe('OwnerSet', () => {
  let worlds: MockWorldsClient;
  let entities: MockEntitiesClient;
  let users: MockUserDirectoryClient;
  let auth: MockAuthClient;
  let toaster: ToasterService;

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    entities = new MockEntitiesClient();
    users = new MockUserDirectoryClient();
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [OwnerSet, provideTranslocoTesting(WEB_UI_TEST_CATALOGS)],
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: EntitiesClient, useValue: entities },
        { provide: UserDirectoryClient, useValue: users },
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    auth.setUser({
      id: 'u1',
      email: 'ada@hexly.test',
      displayName: 'Ada',
      preferences: {},
      roles: ['create-worlds'],
      isSuperadmin: false,
    });
    users.list.mockReturnValue(
      of([
        { id: 'u1', displayName: 'Ada' },
        { id: 'u2', displayName: 'Bob' },
        { id: 'u3', displayName: 'Carol' },
      ]),
    );
  });

  function render(kind: 'world' | 'entity', id: string, owners: string[]) {
    (kind === 'world' ? worlds : entities).owners.mockReturnValue(of(owners));
    const fixture = TestBed.createComponent(OwnerSet);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  it('names each Owner from the directory', () => {
    const { nativeElement: el } = render('world', 'w1', ['u1', 'u2']);

    expect($(el, '[data-testid="owner-u1"]')?.textContent).toContain('Ada');
    expect($(el, '[data-testid="owner-u2"]')?.textContent).toContain('Bob');
    expect($(el, '[data-testid="owner-u3"]')).toBeNull();
  });

  it('warns instead of throwing when the owner set fails to load', () => {
    const show = vi.spyOn(toaster, 'show');
    worlds.owners.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const fixture = TestBed.createComponent(OwnerSet);
    fixture.componentRef.setInput('kind', 'world');
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();

    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('adds a co-Owner picked from the directory', () => {
    const fixture = render('world', 'w1', ['u1']);
    const el = fixture.nativeElement as HTMLElement;
    worlds.addOwner.mockReturnValue(of(['u1', 'u3']));

    const select = $(el, '[data-testid="add-select"]') as HTMLSelectElement;
    select.value = 'u3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ($(el, '[data-testid="add"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worlds.addOwner).toHaveBeenCalledWith('w1', 'u3');
    expect($(el, '[data-testid="owner-u3"]')?.textContent).toContain('Carol');
  });

  it('removes another Owner', () => {
    const fixture = render('world', 'w1', ['u1', 'u2']);
    const el = fixture.nativeElement as HTMLElement;
    worlds.removeOwner.mockReturnValue(of(['u1']));

    ($(el, '[data-testid="remove-u2"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worlds.removeOwner).toHaveBeenCalledWith('w1', 'u2');
    expect($(el, '[data-testid="owner-u2"]')).toBeNull();
  });

  it('resigns own ownership and emits so the host can leave', () => {
    const fixture = render('world', 'w1', ['u1', 'u2']);
    const el = fixture.nativeElement as HTMLElement;
    const resigned = vi.fn();
    fixture.componentInstance.resigned.subscribe(resigned);
    worlds.removeOwner.mockReturnValue(of(['u2']));

    ($(el, '[data-testid="resign-u1"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(worlds.removeOwner).toHaveBeenCalledWith('w1', 'u1');
    expect(resigned).toHaveBeenCalled();
  });

  it('keeps the set and warns when the server refuses the last Owner', () => {
    const fixture = render('world', 'w1', ['u1']);
    const el = fixture.nativeElement as HTMLElement;
    const resigned = vi.fn();
    fixture.componentInstance.resigned.subscribe(resigned);
    const show = vi.spyOn(toaster, 'show');
    worlds.removeOwner.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));

    ($(el, '[data-testid="resign-u1"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(show).toHaveBeenCalledWith(expect.any(String), 'error');
    expect($(el, '[data-testid="owner-u1"]')).not.toBeNull();
    expect(resigned).not.toHaveBeenCalled();
  });

  it('offers resign, not remove, on the current user’s own row', () => {
    const { nativeElement: el } = render('world', 'w1', ['u1', 'u2']);

    expect($(el, '[data-testid="remove-u1"]')).toBeNull();
    expect($(el, '[data-testid="resign-u1"]')).not.toBeNull();
    expect($(el, '[data-testid="resign-u2"]')).toBeNull();
  });
});
