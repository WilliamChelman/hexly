import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from '../../core/services/auth.client';
import { WorldsClient } from '../../core/services/worlds.client';
import { WorldStore } from '../../core/services/world.store';
import { MockAuthClient } from '../../core/testing/mock-auth-client';
import { MockWorldsClient } from '../../core/testing/mock-worlds-client';
import { ToasterService } from '../../core/services/toaster.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { WorldIndex } from './world-index';

function summary(id: string, name = id, ownerId = 'u1'): WorldSummary {
  return { id, name, ownerId, createdAt: 1, updatedAt: 1 };
}

function detail(id: string, name = id, entityCount = 1): WorldDetail {
  return { ...summary(id, name), homeEntityId: `home-${id}`, entityCount };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('WorldIndex', () => {
  let worlds: MockWorldsClient;
  let auth: MockAuthClient;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    auth = new MockAuthClient();
    await TestBed.configureTestingModule({
      imports: [WorldIndex, provideTranslocoTesting()],
      providers: [
        provideRouter([]),
        { provide: WorldsClient, useValue: worlds },
        { provide: AuthClient, useValue: auth },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // The caller (u1) — used to tell owned Worlds from member Worlds.
    auth.setUser({ id: 'u1', email: 'ada@hexly.test', displayName: 'Ada' });
    // Construct the real store and settle its reset effect before the component loads.
    TestBed.inject(WorldStore);
    TestBed.flushEffects();
  });

  /** Render the Index over a resolved World list (the real store, a mocked client). */
  async function render(list: WorldSummary[]) {
    worlds.list.mockReturnValue(of(list));
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // store.load() -> worlds.list()
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  const $ = (el: HTMLElement, sel: string) => el.querySelector(sel);

  it('lists every reachable World by name', async () => {
    const el = (
      await render([summary('w1', 'Aldermoor'), summary('w2', 'Whisperwood', 'someone-else')])
    ).nativeElement as HTMLElement;

    const names = Array.from(el.querySelectorAll('[data-testid^=world-]')).map(
      (n) => (n as HTMLElement).textContent ?? '',
    );
    expect(names.join(' ')).toContain('Aldermoor');
    expect(names.join(' ')).toContain('Whisperwood');
  });

  it('distinguishes owned Worlds from member Worlds', async () => {
    const el = (
      await render([summary('w1', 'Aldermoor'), summary('w2', 'Whisperwood', 'someone-else')])
    ).nativeElement as HTMLElement;

    expect($(el, '[data-testid=owned-w1]')).not.toBeNull();
    expect($(el, '[data-testid=member-w1]')).toBeNull();
    expect($(el, '[data-testid=member-w2]')).not.toBeNull();
    expect($(el, '[data-testid=owned-w2]')).toBeNull();
  });

  it('links a World’s card to its Entity browser', async () => {
    const el = (await render([summary('w1', 'Aldermoor')])).nativeElement as HTMLElement;

    expect(
      ($(el, '[data-testid=world-w1]') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/w/w1/entities');
  });

  it('shows an empty state with a create affordance when there are no Worlds', async () => {
    const el = (await render([])).nativeElement as HTMLElement;

    expect($(el, '[data-testid=worlds-empty]')).not.toBeNull();
    expect($(el, '[data-testid=create-world]')).not.toBeNull();
  });

  it('creating a World opens its Home Entity', async () => {
    const el = (await render([])).nativeElement as HTMLElement;
    worlds.create.mockReturnValue(of(detail('w3', 'Untitled world')));

    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();
    await tick();

    expect(navigate).toHaveBeenCalledWith(['/w', 'w3', 'entities', 'home-w3']);
  });

  it('offers rename + delete on owned Worlds only, not on member Worlds', async () => {
    const el = (
      await render([summary('w1', 'Aldermoor'), summary('w2', 'Whisperwood', 'someone-else')])
    ).nativeElement as HTMLElement;

    expect($(el, '[data-testid=rename-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=delete-world-w1]')).not.toBeNull();
    expect($(el, '[data-testid=rename-world-w2]')).toBeNull();
    expect($(el, '[data-testid=delete-world-w2]')).toBeNull();
  });

  it('renames an owned World from the Index, updating the list', async () => {
    const fixture = await render([summary('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;
    worlds.rename.mockReturnValue(of(detail('w1', 'The Reach of Aldermoor')));

    ($(el, '[data-testid=rename-world-w1]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = $(el, '[data-testid=rename-world-input-w1]') as HTMLInputElement;
    input.value = 'The Reach of Aldermoor';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();
    fixture.detectChanges();

    expect($(el, '[data-testid=world-w1]')?.textContent).toContain('The Reach of Aldermoor');
    expect(worlds.rename).toHaveBeenCalledWith('w1', 'The Reach of Aldermoor');
  });

  it('opens a delete modal that shows the count of Entities to be destroyed', async () => {
    const fixture = await render([summary('w1', 'Aldermoor')]);
    const el = fixture.nativeElement as HTMLElement;
    // Home + two more Entities = a count of 3 (#120).
    worlds.get.mockReturnValue(of(detail('w1', 'Aldermoor', 3)));

    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    await tick();
    fixture.detectChanges();

    expect($(el, '[data-testid=delete-modal]')).not.toBeNull();
    expect($(el, '[data-testid=delete-count]')?.textContent).toContain('3');
  });

  /** Open the delete modal for w1 and resolve its entity count. */
  async function openDeleteModal(name: string, count = 2) {
    const fixture = await render([summary('w1', name)]);
    const el = fixture.nativeElement as HTMLElement;
    worlds.get.mockReturnValue(of(detail('w1', name, count)));
    ($(el, '[data-testid=delete-world-w1]') as HTMLButtonElement).click();
    await tick();
    fixture.detectChanges();
    return fixture;
  }

  it('enables Delete only once the typed name matches the World exactly', async () => {
    const fixture = await openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;
    const armed = () =>
      ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).getAttribute(
        'aria-disabled',
      ) === null;
    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;

    expect(armed()).toBe(false);

    input.value = 'Aldermor'; // typo → still locked
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(false);

    input.value = 'Aldermoor'; // exact match → armed
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(armed()).toBe(true);
  });

  it('deletes the World on confirm, removing it from the Index', async () => {
    const fixture = await openDeleteModal('Aldermoor');
    const el = fixture.nativeElement as HTMLElement;

    const input = $(el, '[data-testid=delete-confirm-input]') as HTMLInputElement;
    input.value = 'Aldermoor';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    ($(el, '[data-testid=confirm-delete]') as HTMLButtonElement).click();
    await tick();
    fixture.detectChanges();

    expect($(el, '[data-testid=world-w1]')).toBeNull();
    expect($(el, '[data-testid=delete-modal]')).toBeNull();
    expect(worlds.delete).toHaveBeenCalledWith('w1');
  });

  it('renders its empty state in French when French is the active language', async () => {
    const fixture = await render([]);
    TestBed.inject(TranslocoService).setActiveLang('fr');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Aucun monde pour l'instant.",
    );
  });

  it('shows an error state (not the empty state) when the World list fails to load', async () => {
    worlds.list.mockReturnValue(throwError(() => new Error('down')));
    const fixture = TestBed.createComponent(WorldIndex);
    fixture.detectChanges(); // store.load() → worlds.list()
    await tick();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect($(el, '[data-testid=load-error]')).not.toBeNull();
    expect($(el, '[data-testid=worlds-empty]')).toBeNull();
  });

  it('surfaces an error toast when creating a World fails', async () => {
    const el = (await render([])).nativeElement as HTMLElement;
    worlds.create.mockReturnValue(throwError(() => new Error('boom')));

    ($(el, '[data-testid=create-world]') as HTMLButtonElement).click();
    await tick();

    expect(TestBed.inject(ToasterService).toasts().map((t) => t.tone)).toEqual(['error']);
  });
});
