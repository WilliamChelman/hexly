import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  type AssetStorageMoveOutcome,
  type AssetStorageMoveProgress,
  DESKTOP_BRIDGE,
  DesktopBridge,
} from '@hexly/web-core';
import { DialogRef } from '@hexly/web-ui';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { MoveAssetStorageDialogComponent } from './move-asset-storage-dialog.component';

/** Main's side of the move: a copy this spec drives report by report, and answers when it chooses. */
class FakeBridge {
  cancelled = 0;
  private report?: (progress: AssetStorageMoveProgress) => void;
  private settle?: (outcome: AssetStorageMoveOutcome) => void;

  renewSession = (): Promise<void> => Promise.resolve();
  onMenuCommand = (): (() => void) => () => undefined;

  moveAssetStorage = (onProgress: (progress: AssetStorageMoveProgress) => void): Promise<AssetStorageMoveOutcome> => {
    this.report = onProgress;
    return new Promise((resolve) => (this.settle = resolve));
  };

  cancelAssetStorageMove = (): void => void this.cancelled++;

  /** A file going past, as main reports it. */
  progress(progress: Partial<AssetStorageMoveProgress> = {}): void {
    this.report?.({
      file: 'world-1/aaa.png',
      copiedFiles: 1,
      totalFiles: 4,
      copiedBytes: 250,
      totalBytes: 1000,
      ...progress,
    });
  }

  /** How the move ended. */
  finish(outcome: AssetStorageMoveOutcome): void {
    this.settle?.(outcome);
  }
}

describe('MoveAssetStorageDialogComponent', () => {
  let bridge: FakeBridge;
  let closed: Subject<void>;
  let closes: number;

  /** Mount the dialog the way `DialogService` does: an element injector carrying the `DialogRef`. */
  function render() {
    bridge = new FakeBridge();
    closed = new Subject<void>();
    closes = 0;
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        { provide: DESKTOP_BRIDGE, useValue: bridge as unknown as DesktopBridge },
        { provide: DialogRef, useValue: { data: undefined, closed, close: () => void closes++ } },
      ],
    });
    const fixture = TestBed.createComponent(MoveAssetStorageDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ReturnType<typeof render>, testId: string): string | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;
  }

  it('waits on the native picker before it has anything to measure', () => {
    const fixture = render();

    expect(text(fixture, 'asset-move-choosing')).toBeTruthy();
    expect(text(fixture, 'asset-move-progress')).toBeNull();
  });

  it('reports the count and the file, and measures the bar in bytes', () => {
    const fixture = render();

    bridge.progress();
    fixture.detectChanges();

    expect(text(fixture, 'asset-move-progress')).toContain('1');
    expect(text(fixture, 'asset-move-file')).toBe('world-1/aaa.png');
    // Bytes, not files: 1 of 4 files but a quarter of the bytes — a file count would say the same by luck here,
    // so the assertion is on the byte fraction the element carries.
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('25');
  });

  it('cancels the copy in flight and keeps the dialog up until main answers', async () => {
    const fixture = render();
    bridge.progress();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="asset-move-cancel"]').click();
    fixture.detectChanges();

    expect(bridge.cancelled).toBe(1);
    expect(text(fixture, 'asset-move-cancelling')).toBeTruthy();
    expect(closes).toBe(0);

    bridge.finish({ status: 'cancelled' });
    await fixture.whenStable();

    // Nothing to report: the user asked, and the Assets are exactly where they were.
    expect(closes).toBe(1);
  });

  /** Escape must not leave a gigabyte-scale copy running with a relaunch waiting at the end of it. */
  it('treats being dismissed before the move settles as a cancel', () => {
    const fixture = render();
    bridge.progress();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('dialog').dispatchEvent(new Event('close'));
    fixture.detectChanges();

    expect(bridge.cancelled).toBe(1);
  });

  it('closes itself when the user dismisses the picker without choosing', async () => {
    const fixture = render();

    bridge.finish({ status: 'dismissed' });
    await fixture.whenStable();

    expect(closes).toBe(1);
  });

  it('says the app is about to restart, since that is what applies the new folder', async () => {
    const fixture = render();

    bridge.finish({ status: 'moved', to: '/Volumes/Big/hexly-assets', files: 1204, bytes: 8_000_000_000 });
    await fixture.whenStable();
    fixture.detectChanges();

    const done = text(fixture, 'asset-move-done');
    expect(done).toContain('/Volumes/Big/hexly-assets');
    expect(done).toContain('restart');
    // Stays up: the window is going away on its own, and a dialog that vanished first would read as a crash.
    expect(closes).toBe(0);
  });

  /** Our own refusal has copy of its own, because unlike a filesystem message it is ours to translate. */
  it('says a refusal in the app’s own words rather than passing a sentence through from the shell', async () => {
    const fixture = render();

    bridge.finish({ status: 'refused', refusal: 'same-folder' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture, 'asset-move-reason')).toBe('That folder is already where Hexly keeps your Assets.');
  });

  it('names what failed and says the Assets were left alone', async () => {
    const fixture = render();

    bridge.finish({ status: 'failed', reason: 'ENOSPC: no space left on device' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture, 'asset-move-reason')).toContain('ENOSPC');
    // True of every unsuccessful outcome, the copied-but-unswitched one included: nothing switched.
    expect(text(fixture, 'asset-move-failed')).toContain('still using the Asset folder it was using before');
    // Dismissed by hand, not automatically: a message nobody read is the same as no message.
    fixture.nativeElement.querySelector('[data-testid="asset-move-close"]').click();
    expect(closes).toBe(1);
  });
});
