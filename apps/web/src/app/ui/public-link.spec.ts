import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EntitiesClient } from '../core/services/entities.client';
import { MockEntitiesClient } from '../core/testing/entities-client.mock';
import { WorldsClient } from '../core/services/worlds.client';
import { MockWorldsClient } from '../core/testing/worlds-client.mock';
import { ToasterService } from '../core/services/toaster.service';
import { provideTranslocoTesting } from '../core/i18n/transloco-testing';
import { PublicLinkControl, PublicLinkKind } from './public-link';

/**
 * The Public Link control (ADR-0037, #162): mint / show / revoke the one anonymous read-only
 * link for a World or Entity. These specs assert the observable behaviour — which client the
 * `kind` targets, the shareable URL shown, and that a revoke returns to the create state.
 */
describe('PublicLinkControl', () => {
  let entities: MockEntitiesClient;
  let worlds: MockWorldsClient;

  beforeEach(async () => {
    entities = new MockEntitiesClient();
    worlds = new MockWorldsClient();
    await TestBed.configureTestingModule({
      imports: [PublicLinkControl, provideTranslocoTesting()],
      providers: [
        { provide: EntitiesClient, useValue: entities },
        { provide: WorldsClient, useValue: worlds },
      ],
    }).compileComponents();
  });

  function render(kind: PublicLinkKind, id: string) {
    const fixture = TestBed.createComponent(PublicLinkControl);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel) as HTMLElement | null;

  it('shows a Create button when no link is active yet', () => {
    entities.link.mockReturnValue(of(null));
    const { nativeElement: el } = render('entity', 'e1');

    expect($(el, '[data-testid="public-link-create"]')).toBeTruthy();
    expect($(el, '[data-testid="public-link-url"]')).toBeNull();
  });

  it('shows the shareable /public/e URL for an active entity link', () => {
    entities.link.mockReturnValue(of({ token: 'tok-123' }));
    const { nativeElement: el } = render('entity', 'e1');

    const url = $(el, '[data-testid="public-link-url"]') as HTMLInputElement | null;
    expect(url?.value).toBe(`${location.origin}/public/e/tok-123`);
  });

  it('builds the World URL under /public/w for a world link', () => {
    worlds.link.mockReturnValue(of({ token: 'wtok' }));
    const { nativeElement: el } = render('world', 'w1');

    const url = $(el, '[data-testid="public-link-url"]') as HTMLInputElement | null;
    expect(url?.value).toBe(`${location.origin}/public/w/wtok`);
    // A world link reads/writes through the WorldsClient, never the EntitiesClient.
    expect(worlds.link).toHaveBeenCalledWith('w1');
    expect(entities.link).not.toHaveBeenCalled();
  });

  it('mints a link on Create and then shows its URL', () => {
    entities.link.mockReturnValue(of(null));
    entities.mintLink.mockReturnValue(of({ token: 'fresh' }));
    const fixture = render('entity', 'e1');
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid="public-link-create"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.mintLink).toHaveBeenCalledWith('e1');
    expect(($(el, '[data-testid="public-link-url"]') as HTMLInputElement).value).toContain('fresh');
  });

  it('returns to the Create state after a revoke', () => {
    entities.link.mockReturnValue(of({ token: 'tok' }));
    entities.revokeLink.mockReturnValue(of(undefined));
    const fixture = render('entity', 'e1');
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid="public-link-revoke"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(entities.revokeLink).toHaveBeenCalledWith('e1');
    expect($(el, '[data-testid="public-link-create"]')).toBeTruthy();
    expect($(el, '[data-testid="public-link-url"]')).toBeNull();
  });

  it('surfaces a mint failure as an error toast, staying on Create', () => {
    entities.link.mockReturnValue(of(null));
    entities.mintLink.mockReturnValue(throwError(() => new Error('nope')));
    const toaster = TestBed.inject(ToasterService);
    const spy = vi.spyOn(toaster, 'show');
    const fixture = render('entity', 'e1');
    const el = fixture.nativeElement as HTMLElement;

    ($(el, '[data-testid="public-link-create"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(expect.any(String), 'error');
    expect($(el, '[data-testid="public-link-create"]')).toBeTruthy();
  });
});
