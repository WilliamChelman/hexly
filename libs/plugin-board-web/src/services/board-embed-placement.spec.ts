import { createEnvironmentInjector, EnvironmentInjector, signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Point } from '@hexly/plugin-board';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { DialogRef, DialogService } from '@hexly/web-ui';
import { BoardStore } from './board-store';
import { BoardEmbedPlacement } from './board-embed-placement';
import { EmbedChoice, EmbedPickerData } from '../components/board-embed-picker.component';

/** Records the addEmbed / armTool calls the placement funnels through. */
class FakeStore {
  readonly added: { position: Point; targetEntityId: string; viewInstance: string }[] = [];
  readonly toolArms: string[] = [];
  addEmbed(position: Point, targetEntityId: string, viewInstance: string): string {
    this.added.push({ position, targetEntityId, viewInstance });
    return 'em';
  }
  armTool(id: string): void {
    this.toolArms.push(id);
  }
}

/** A DialogService whose `open` hands back a controllable ref, so a spec drives the chooser's outcome. */
class FakeDialogService {
  opened: { component: Type<unknown>; data: unknown; ref: DialogRef<EmbedPickerData, EmbedChoice> }[] = [];
  open<Data, Result>(component: Type<unknown>, data?: Data): DialogRef<Data, Result> {
    const ref = new DialogRef<EmbedPickerData, EmbedChoice>(data as EmbedPickerData);
    this.opened.push({ component, data, ref });
    return ref as unknown as DialogRef<Data, Result>;
  }
  lastRef(): DialogRef<EmbedPickerData, EmbedChoice> {
    return this.opened[this.opened.length - 1].ref;
  }
}

describe('BoardEmbedPlacement', () => {
  let dialogs: FakeDialogService;
  let store: FakeStore;
  const worldId = signal<string | null>('w1');

  function setup(): BoardEmbedPlacement {
    dialogs = new FakeDialogService();
    store = new FakeStore();
    TestBed.configureTestingModule({
      providers: [
        BoardEmbedPlacement,
        { provide: DialogService, useValue: dialogs },
        { provide: BoardStore, useValue: store },
        { provide: ENTITY_SESSION, useValue: { current: () => (worldId() ? { worldId: worldId() } : null) } },
      ],
    });
    return TestBed.inject(BoardEmbedPlacement);
  }

  it('opens the target chooser for the current World and places an Embed at the confirmed choice', () => {
    worldId.set('w1');
    const placement = setup();

    placement.place({ x: 12, y: 34 });
    expect(dialogs.opened[0].data).toEqual({ worldId: 'w1' });

    dialogs.lastRef().close({ targetEntityId: 'note-1', viewInstance: 'core.view.map:core.grid' });
    expect(store.added).toEqual([
      { position: { x: 12, y: 34 }, targetEntityId: 'note-1', viewInstance: 'core.view.map:core.grid' },
    ]);
    // A successful placement keeps the armed Tool sticky — repeat placement stays one click away.
    expect(store.toolArms).toEqual([]);
  });

  it('places nothing and re-arms Select when the chooser is cancelled — the intent is abandoned', () => {
    worldId.set('w1');
    const placement = setup();

    placement.place({ x: 0, y: 0 });
    dialogs.lastRef().close(); // cancelled → no choice

    expect(store.added).toEqual([]);
    // Without the re-arm, the still-armed Embed Tool reopens the just-dismissed dialog on the next click.
    expect(store.toolArms).toEqual(['select']);
  });

  it('closes an open chooser when its scope is destroyed — the modal must not outlive the board', () => {
    worldId.set('w1');
    setup();
    // The service is route-scoped; a child environment injector stands in for the departing route.
    const env = createEnvironmentInjector([BoardEmbedPlacement], TestBed.inject(EnvironmentInjector));
    const placement = env.get(BoardEmbedPlacement);
    placement.place({ x: 0, y: 0 });
    let completed = false;
    dialogs.lastRef().closed.subscribe({ complete: () => (completed = true) });

    env.destroy();

    // Left open, a late pick would write through the departed session.
    expect(completed).toBe(true);
    expect(store.added).toEqual([]);
  });

  it('is a no-op with no resolved World — nowhere to scope the target search', () => {
    worldId.set(null);
    const placement = setup();

    placement.place({ x: 0, y: 0 });

    expect(dialogs.opened).toEqual([]);
    expect(store.added).toEqual([]);
  });
});
