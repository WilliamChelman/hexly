import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ToasterService } from '@hexly/web-core';
import { ADMIN_TEST_CATALOGS } from '../i18n/test-catalogs';
import { AdminClient } from '../services/admin.client';
import { MockAdminClient, compendiumPack, importRun } from '../testing';
import { CompendiumPacksPanelComponent } from './compendium-packs-panel.component';

/** Matches the panel's own poll interval; one `tick` of it advances the reconcile by one poll. */
const POLL_MS = 1000;

const PACK = 'draw-steel.importer.monsters';

/**
 * The operator's compendium pack panel (#404): it lists the packs the Instance offers, says which are
 * installed and at which revision, and installs / reimports / removes them through the Superadmin
 * `/admin/compendiums` routes. The reconcile outlives the request, so the panel follows it by
 * re-reading the list. These specs drive it through the {@link MockAdminClient} and own the clock.
 */
describe('CompendiumPacksPanel', () => {
  let admin: MockAdminClient;
  let toaster: ToasterService;
  let fixture: ComponentFixture<CompendiumPacksPanelComponent>;

  beforeEach(async () => {
    admin = new MockAdminClient();
    await TestBed.configureTestingModule({
      imports: [CompendiumPacksPanelComponent, provideTranslocoTesting(ADMIN_TEST_CATALOGS)],
      providers: [{ provide: AdminClient, useValue: admin }],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  function render(): void {
    fixture = TestBed.createComponent(CompendiumPacksPanelComponent);
    fixture.detectChanges();
  }

  function el(testid: string): HTMLElement {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLElement;
  }

  function has(testid: string): boolean {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)) !== null;
  }

  function click(testid: string): void {
    el(testid).click();
    fixture.detectChanges();
  }

  const advance = (ms: number) => vi.advanceTimersByTime(ms);

  it('lists an uninstalled pack under its plugin-contributed label, offering only Install', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, label: 'drawSteel.importer.monsters' })]));
    render();

    // The label is resolved through the catalogs — the panel itself names no pack.
    expect(el(`pack-${PACK}`).textContent).toContain('Not installed');
    expect(el(`pack-install-${PACK}`).textContent).toContain('Install');
    // Nothing to remove until something is on the shelf.
    expect(has(`pack-remove-${PACK}`)).toBe(false);
  });

  it('states an installed pack’s pinned revision and entry count', () => {
    admin.packs.mockReturnValue(
      of([
        compendiumPack({
          importer: PACK,
          installed: {
            id: 'c1',
            name: 'Draw Steel: Monsters',
            rev: 'abcdef1234567890',
            entryCount: 412,
            updatedAt: Date.UTC(2026, 0, 2),
          },
        }),
      ]),
    );
    render();

    const line = el(`pack-status-${PACK}`).textContent ?? '';
    expect(line).toContain('abcdef1'); // short rev — "which version of the bestiary is this"
    expect(line).toContain('412');
    // An installed pack is reimported, not installed, and can be removed.
    expect(el(`pack-install-${PACK}`).textContent).toContain('Reimport');
    expect(has(`pack-remove-${PACK}`)).toBe(true);
  });

  it('installs through the operator endpoint and follows the run home', () => {
    admin.packs
      .mockReturnValueOnce(of([compendiumPack({ importer: PACK })])) // idle on load
      .mockReturnValue(
        of([compendiumPack({ importer: PACK, run: importRun({ status: 'succeeded', created: 400, updated: 12 }) })]),
      );
    render();

    click(`pack-install-${PACK}`);
    advance(POLL_MS);

    expect(admin.installPack).toHaveBeenCalledWith(PACK);
    expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('412'))).toBe(true);
  });

  it('rejoins a run that was already going when the page loaded, and refuses a second install', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, run: importRun({ status: 'running' }) })]));
    render();

    // The server's word, not a local latch: a reload mid-install still finds the row busy.
    expect((el(`pack-install-${PACK}`) as HTMLButtonElement).disabled).toBe(true);
    expect(has(`pack-running-${PACK}`)).toBe(true);
    click(`pack-install-${PACK}`);
    expect(admin.installPack).not.toHaveBeenCalled();
  });

  it('holds only the running pack, leaving another free to install', () => {
    const other = 'test.importer.other';
    admin.packs.mockReturnValue(
      of([
        compendiumPack({ importer: PACK, run: importRun({ status: 'running' }) }),
        compendiumPack({ importer: other }),
      ]),
    );
    render();

    // The reconcile serializes per pack (ADR-0079), so a busy shelf is not a busy panel.
    expect((el(`pack-install-${PACK}`) as HTMLButtonElement).disabled).toBe(true);
    expect((el(`pack-install-${other}`) as HTMLButtonElement).disabled).toBe(false);
    click(`pack-install-${other}`);
    expect(admin.installPack).toHaveBeenCalledWith(other);
  });

  it('announces the pack that was pressed, not whichever run finished last', () => {
    const other = 'test.importer.other';
    const finishedElsewhere = compendiumPack({
      importer: other,
      run: importRun({ status: 'failed', finishedAt: Date.UTC(2026, 0, 3) }),
    });
    admin.packs
      .mockReturnValueOnce(of([compendiumPack({ importer: PACK }), finishedElsewhere])) // idle on load
      .mockReturnValue(
        of([
          compendiumPack({ importer: PACK, run: importRun({ status: 'succeeded', created: 5, finishedAt: 1 }) }),
          finishedElsewhere,
        ]),
      );
    render();

    click(`pack-install-${PACK}`);
    advance(POLL_MS);

    // The other pack failed *later*, so a "newest finished run" reading would report a failure here.
    expect(toaster.toasts().at(-1)?.tone).toBe('success');
    expect(toaster.toasts().at(-1)?.message).toContain('5');
  });

  it('renders a distinct failure line for a run that aborted', () => {
    admin.packs.mockReturnValue(
      of([compendiumPack({ importer: PACK, run: importRun({ status: 'failed', error: 'codeload unreachable' }) })]),
    );
    render();

    expect(has(`pack-error-${PACK}`)).toBe(true);
    expect(has(`pack-status-${PACK}`)).toBe(false); // never the success line
  });

  it('states what removing a pack would break, then removes it, re-reads the list, and says so', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, installed: installed() })]));
    admin.packInboundLinks.mockReturnValue(of({ links: 9, worlds: 3 }));
    render();

    click(`pack-remove-${PACK}`);

    // The same pair a World Owner deleting their own Container gets (ADR-0080, #414) — and asking
    // costs nothing, so nothing has been removed yet.
    expect(admin.packInboundLinks).toHaveBeenCalledWith(PACK);
    expect(admin.removePack).not.toHaveBeenCalled();
    expect(el('pack-remove-links').textContent).toContain('9');
    expect(el('pack-remove-links').textContent).toContain('3');

    click('confirm-pack-remove');

    expect(admin.removePack).toHaveBeenCalledWith(PACK);
    expect(admin.packs).toHaveBeenCalledTimes(2); // the load, then the re-read
    expect(toaster.toasts().some((t) => t.tone === 'success')).toBe(true);
    expect(has('pack-remove-modal')).toBe(false);
  });

  it('says nothing points into a pack rather than showing a bare zero', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, installed: installed() })]));
    render();

    click(`pack-remove-${PACK}`);

    // The mock's default is a pack nothing points into.
    expect(el('pack-remove-links').textContent).toContain('Nothing points into this pack');
    expect(el('pack-remove-links').textContent).not.toContain('0');
  });

  it('removes whatever the count says, and removes even when the count would not load', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, installed: installed() })]));
    admin.packInboundLinks.mockReturnValue(throwError(() => new Error('boom')));
    render();

    click(`pack-remove-${PACK}`);

    // The operator is never held hostage by a count: ADR-0080 rejects the veto by name.
    expect(el('pack-remove-links').textContent).toContain("Couldn't count");
    click('confirm-pack-remove');
    expect(admin.removePack).toHaveBeenCalledWith(PACK);
  });

  it('backs out of a pack removal without touching the shelf', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK, installed: installed() })]));
    render();

    click(`pack-remove-${PACK}`);
    click('cancel-pack-remove');

    expect(admin.removePack).not.toHaveBeenCalled();
    expect(has('pack-remove-modal')).toBe(false);
  });

  it('surfaces the structured refusal when the pack is already being installed', () => {
    admin.packs.mockReturnValue(of([compendiumPack({ importer: PACK })]));
    admin.installPack.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'import-running' } })),
    );
    render();

    click(`pack-install-${PACK}`);

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
    expect(toaster.toasts().at(-1)?.message).toContain('already being installed');
  });

  it('says so when the Instance offers no packs at all', () => {
    render();
    expect(fixture.nativeElement.textContent).toContain('No packs available');
  });

  function installed() {
    return { id: 'c1', name: 'Draw Steel: Monsters', rev: 'abcdef1', entryCount: 2, updatedAt: Date.UTC(2026, 0, 2) };
  }
});
