import { provideTranslocoTesting } from '../../../../../../testing/transloco-testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ImporterSummary, ImportRunSummary } from '@hexly/domain';
import { ToasterService, WorldsClient } from '@hexly/web-core';
import { MockWorldsClient } from '@hexly/web-core/testing';
import { WorldImportsPanelComponent } from './world-imports-panel.component';

/** Matches the panel's own poll interval; one `tick` of it advances the reconcile by one poll. */
const POLL_MS = 1000;

/** Build an {@link ImportRunSummary} over the idle baseline; the reconcile outlives the request, so specs own the clock. */
function runSummary(partial: Partial<ImportRunSummary> = {}): ImportRunSummary {
  return {
    importer: null,
    rev: null,
    status: 'idle',
    total: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: [],
    startedAt: null,
    finishedAt: null,
    error: null,
    ...partial,
  };
}

/**
 * The generic Imports panel (#260): it lists whatever Importers the enabled Plugins registered and
 * runs / removes them through the World-scoped endpoints, following the one reconcile per World by
 * polling. These specs drive it through the {@link MockWorldsClient}.
 */
describe('WorldImportsPanel', () => {
  let worlds: MockWorldsClient;
  let toaster: ToasterService;
  let fixture: ComponentFixture<WorldImportsPanelComponent>;

  // Draw Steel's real Importer: its label is a transloco key resolved through the plugin's web catalogs.
  const monsters: ImporterSummary = { id: 'draw-steel.monsters', label: 'drawSteel.importer.monsters' };

  beforeEach(async () => {
    worlds = new MockWorldsClient();
    worlds.importers.mockReturnValue(of<ImporterSummary[]>([monsters]));
    // Idle on load so the run button is live; a spec that rejoins a run overrides this.
    worlds.importStatus.mockReturnValue(of(runSummary()));
    await TestBed.configureTestingModule({
      imports: [WorldImportsPanelComponent, provideTranslocoTesting()],
      providers: [{ provide: WorldsClient, useValue: worlds }],
    }).compileComponents();
    toaster = TestBed.inject(ToasterService);
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  function render(): void {
    fixture = TestBed.createComponent(WorldImportsPanelComponent);
    fixture.componentRef.setInput('id', 'w1');
    fixture.detectChanges();
  }

  function el(testid: string): HTMLElement {
    return fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLElement;
  }

  function click(testid: string): void {
    el(testid).click();
    fixture.detectChanges();
  }

  const advance = (ms: number) => vi.advanceTimersByTime(ms);

  it('lists the World’s importers, resolving each plugin-contributed label from its catalog', () => {
    render();
    // The Draw Steel key resolved to its localized copy — the panel itself names no plugin.
    expect(el('importer-draw-steel.monsters').textContent).toContain('Draw Steel — Monsters');
  });

  it('runs the chosen importer through the World-scoped endpoint at the selected visibility', () => {
    worlds.runImport.mockReturnValue(of(runSummary({ importer: monsters.id, status: 'running' })));
    render();

    // Default visibility is shared; switch to private before running.
    const select = el('importer-visibility-draw-steel.monsters') as HTMLSelectElement;
    select.value = 'private';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    click('importer-run-draw-steel.monsters');

    expect(worlds.runImport).toHaveBeenCalledWith('w1', 'draw-steel.monsters', 'private');
  });

  it('follows a run to completion and toasts the landed count', () => {
    worlds.runImport.mockReturnValue(of(runSummary({ importer: monsters.id, status: 'running' })));
    worlds.importStatus
      .mockReturnValueOnce(of(runSummary())) // idle on load
      .mockReturnValue(of(runSummary({ importer: monsters.id, status: 'succeeded', created: 5, updated: 2 })));
    render();

    click('importer-run-draw-steel.monsters');
    advance(POLL_MS);

    expect(toaster.toasts().some((t) => t.tone === 'success' && t.message.includes('7'))).toBe(true);
  });

  it('shows a last-run status line with revision, count, and timestamp', () => {
    worlds.importStatus.mockReturnValue(
      of(
        runSummary({
          importer: monsters.id,
          status: 'succeeded',
          rev: 'abcdef1234567890',
          created: 3,
          updated: 1,
          finishedAt: Date.UTC(2026, 0, 2),
        }),
      ),
    );
    render();

    const line = el('importer-status-draw-steel.monsters').textContent ?? '';
    expect(line).toContain('abcdef1'); // short rev
    expect(line).toContain('4'); // created + updated
  });

  it('disables the controls while a reconcile is in flight, and rejoins one running on load', () => {
    worlds.importStatus
      .mockReturnValueOnce(of(runSummary({ importer: monsters.id, status: 'running' })))
      .mockReturnValue(of(runSummary({ importer: monsters.id, status: 'succeeded', created: 1, updated: 0 })));
    render();

    expect((el('importer-run-draw-steel.monsters') as HTMLButtonElement).disabled).toBe(true);
    expect(worlds.runImport).not.toHaveBeenCalled(); // It rejoined; it did not start one.

    advance(POLL_MS);
    expect(toaster.toasts().some((t) => t.tone === 'success')).toBe(true);
  });

  it('surfaces the structured refusal when a run is already in flight for the World', () => {
    worlds.runImport.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'import-running' } })),
    );
    render();

    click('importer-run-draw-steel.monsters');

    const toast = toaster.toasts().at(-1);
    expect(toast?.tone).toBe('error');
    expect(toast?.message).toContain('already running');
  });

  it('removes an importer’s set through the endpoint and confirms it', () => {
    worlds.removeImporter.mockReturnValue(of(undefined));
    render();

    click('importer-remove-draw-steel.monsters');

    expect(worlds.removeImporter).toHaveBeenCalledWith('w1', 'draw-steel.monsters');
    expect(toaster.toasts().some((t) => t.tone === 'success')).toBe(true);
  });

  it('toasts when the importer list cannot be loaded', () => {
    worlds.importers.mockReturnValue(throwError(() => new Error('boom')));
    render();

    expect(toaster.toasts().at(-1)?.tone).toBe('error');
  });
});
