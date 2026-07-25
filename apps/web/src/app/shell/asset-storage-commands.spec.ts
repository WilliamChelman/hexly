import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { CommandDirectory } from '@hexly/command-palette-web';
import { DESKTOP_BRIDGE, DesktopBridge } from '@hexly/web-core';
import { DialogService } from '@hexly/web-ui';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { AssetStorageCommands, MOVE_ASSET_STORAGE } from './asset-storage-commands';
import { MoveAssetStorageDialogComponent } from './move-asset-storage-dialog.component';

/** Only the two members this Command's story needs; the dialog is what actually drives them. */
const bridge = {
  moveAssetStorage: () => Promise.resolve({ status: 'dismissed' as const }),
  cancelAssetStorageMove: () => undefined,
} as unknown as DesktopBridge;

describe('AssetStorageCommands', () => {
  let opened: Type<unknown>[];

  function appWith(desktop: DesktopBridge | null): AssetStorageCommands {
    opened = [];
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        { provide: DESKTOP_BRIDGE, useValue: desktop },
        { provide: DialogService, useValue: { open: (component: Type<unknown>) => void opened.push(component) } },
      ],
    });
    return TestBed.inject(AssetStorageCommands);
  }

  it('offers the move in the Palette, and opens the dialog that drives it', async () => {
    const commands = appWith(bridge);

    const listed = await firstValueFrom(commands.search(''));

    expect(listed.map((command) => command.id)).toEqual([MOVE_ASSET_STORAGE]);
    listed[0].run();
    expect(opened).toEqual([MoveAssetStorageDialogComponent]);
  });

  /** The native menu names this id at launch, so the Directory has to hold it for the click to land. */
  it('registers the id the native menu names', () => {
    appWith(bridge);

    expect(TestBed.inject(CommandDirectory).invoke(MOVE_ASSET_STORAGE)).toBe(true);
    expect(opened).toEqual([MoveAssetStorageDialogComponent]);
  });

  it('offers nothing in a browser, where there is no picker and no hexly.yml to rewrite', async () => {
    // A capability check, not a read of the Deployment Profile (ADR-0071): absent, not disabled.
    const commands = appWith(null);

    expect(await firstValueFrom(commands.search(''))).toEqual([]);
    expect(TestBed.inject(CommandDirectory).invoke(MOVE_ASSET_STORAGE)).toBe(false);
  });

  it('matches the typed query, so it hides behind an unrelated one', async () => {
    const commands = appWith(bridge);

    expect(await firstValueFrom(commands.search('asset'))).toHaveLength(1);
    expect(await firstValueFrom(commands.search('dragon'))).toEqual([]);
  });
});
