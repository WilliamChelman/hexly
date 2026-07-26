import { TestBed } from '@angular/core/testing';
import { Injector, Type } from '@angular/core';
import { AuthClient } from '@hexly/web-core';
import { MockAuthClient } from '@hexly/web-core/testing';
import { EntityDock, DOCK_PANEL_WIDTH, DOCK_STORAGE_KEY, DOCK_WIDTH_STORAGE_KEY } from './entity-dock';
import { PanelDefinition } from '../models/panel-definition';

/** A stub component class — the Dock never instantiates it here, so a bare class suffices. */
class StubPanel {}

const panel = (id: string): PanelDefinition => ({
  id: id as PanelDefinition['id'],
  icon: 'link',
  labelKey: `${id}.label`,
  component: StubPanel as Type<unknown>,
});

const REFERENCES = panel('core.panel.references');
const OUTLINE = panel('core.panel.outline');

/**
 * The page-owned Dock's slot state (ADR-0067): at most one Panel open, the choice remembered per user
 * across sessions, filtered by the Panels the current View makes available, closing — never
 * substituting — when the remembered Panel is unavailable.
 */
describe('EntityDock', () => {
  function configure(): void {
    TestBed.configureTestingModule({
      providers: [EntityDock, { provide: AuthClient, useValue: new MockAuthClient() }],
    });
  }

  function make(): EntityDock {
    return TestBed.inject(EntityDock);
  }

  /** A genuinely new instance over the same storage — what a page reload gives the next session. */
  function reload(): EntityDock {
    TestBed.resetTestingModule();
    configure();
    return TestBed.inject(EntityDock);
  }

  beforeEach(() => {
    localStorage.clear();
    configure();
  });

  afterEach(() => localStorage.clear());

  it('opens nothing by default, with no remembered choice', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);

    expect(dock.openPanel()).toBeNull();
    expect(dock.isOpen()).toBe(false);
  });

  it('toggles a Panel open, and toggling the open one closes the Dock', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);

    dock.toggle(REFERENCES.id);
    expect(dock.openPanel()?.id).toBe(REFERENCES.id);

    dock.toggle(REFERENCES.id);
    expect(dock.openPanel()).toBeNull();
  });

  it('opening a second Panel replaces the first — one slot only', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);

    dock.toggle(REFERENCES.id);
    dock.toggle(OUTLINE.id);

    expect(dock.openPanel()?.id).toBe(OUTLINE.id);
  });

  it('opens the Panel remembered from a previous session once it is available', () => {
    localStorage.setItem(`hexly-u:${DOCK_STORAGE_KEY}`, REFERENCES.id);
    const dock = make();

    // Nothing is open until the available set is known — the strip is derived, then filtered.
    expect(dock.openPanel()).toBeNull();

    dock.setAvailable([REFERENCES, OUTLINE]);
    expect(dock.openPanel()?.id).toBe(REFERENCES.id);
  });

  it('persists the choice so it survives a reload', () => {
    const dock = make();
    dock.setAvailable([REFERENCES]);
    dock.toggle(REFERENCES.id);

    expect(localStorage.getItem(`hexly-u:${DOCK_STORAGE_KEY}`)).toBe(REFERENCES.id);

    // A fresh service (a reload) restores the same open Panel.
    const reloaded = reload();
    reloaded.setAvailable([REFERENCES]);
    expect(reloaded.openPanel()?.id).toBe(REFERENCES.id);
  });

  it('closes — never substitutes — when the remembered Panel is unavailable on the current View', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);
    dock.toggle(OUTLINE.id);
    expect(dock.openPanel()?.id).toBe(OUTLINE.id);

    // Switch to a View that offers References but not the Outline: the Dock closes rather than
    // opening References in its place.
    dock.setAvailable([REFERENCES]);
    expect(dock.openPanel()).toBeNull();

    // Switching back to a View that offers the Outline reopens it — the choice was kept, not cleared.
    dock.setAvailable([REFERENCES, OUTLINE]);
    expect(dock.openPanel()?.id).toBe(OUTLINE.id);
  });

  it('never opens a remembered Panel that is not in the available set', () => {
    localStorage.setItem(`hexly-u:${DOCK_STORAGE_KEY}`, 'core.panel.inspector');
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);

    expect(dock.openPanel()).toBeNull();
  });

  it('takes a programmatic claim without overwriting the remembered choice', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);
    dock.toggle(REFERENCES.id);

    // A View claims the slot (e.g. a selection opens an Inspector): it shows, but the user's
    // remembered choice is untouched and persisted as it was.
    dock.claim(OUTLINE.id);
    expect(dock.openPanel()?.id).toBe(OUTLINE.id);
    expect(localStorage.getItem(`hexly-u:${DOCK_STORAGE_KEY}`)).toBe(REFERENCES.id);

    // Releasing the claim falls back to the remembered choice.
    dock.releaseClaim();
    expect(dock.openPanel()?.id).toBe(REFERENCES.id);
  });

  it('a user toggle supersedes a programmatic claim', () => {
    const dock = make();
    dock.setAvailable([REFERENCES, OUTLINE]);
    dock.claim(OUTLINE.id);

    dock.toggle(REFERENCES.id);
    expect(dock.openPanel()?.id).toBe(REFERENCES.id);
  });

  describe('Panel width', () => {
    const key = `hexly-u:${DOCK_WIDTH_STORAGE_KEY}`;

    it('starts at the default width', () => {
      expect(make().panelWidth()).toBe(DOCK_PANEL_WIDTH.default);
    });

    it('holds a resize to the bounds, so no drag can leave the Dock unseatable', () => {
      const dock = make();

      dock.resizePanel(DOCK_PANEL_WIDTH.min - 200);
      expect(dock.panelWidth()).toBe(DOCK_PANEL_WIDTH.min);

      dock.resizePanel(DOCK_PANEL_WIDTH.max + 200);
      expect(dock.panelWidth()).toBe(DOCK_PANEL_WIDTH.max);
    });

    it('remembers the width the gesture ends on — not every frame of it', () => {
      const dock = make();

      dock.beginResize();
      expect(dock.resizing()).toBe(true);
      dock.resizePanel(400);
      dock.resizePanel(420);
      // Mid-drag the Panel has moved, but nothing is remembered yet.
      expect(dock.panelWidth()).toBe(420);
      expect(localStorage.getItem(key)).toBeNull();

      dock.endResize();
      expect(dock.resizing()).toBe(false);
      expect(localStorage.getItem(key)).toBe('420');

      // A fresh service (a reload) restores it.
      expect(reload().panelWidth()).toBe(420);
    });

    it('falls back to the default when the stored width is unusable', () => {
      localStorage.setItem(key, 'wide');
      expect(make().panelWidth()).toBe(DOCK_PANEL_WIDTH.default);

      localStorage.setItem(key, String(DOCK_PANEL_WIDTH.max + 1000));
      expect(reload().panelWidth()).toBe(DOCK_PANEL_WIDTH.default);
    });
  });

  it('carries the running View’s injector for hosting View-contributed Panels (ADR-0067, #294)', () => {
    const dock = make();
    // None until the outlet mounts a View and hands its injector over.
    expect(dock.viewInjector()).toBeNull();

    const injector = Injector.create({ providers: [] });
    dock.setViewInjector(injector);
    expect(dock.viewInjector()).toBe(injector);

    // Cleared when the View degrades to the card/dangling fallback (no body mounted).
    dock.setViewInjector(null);
    expect(dock.viewInjector()).toBeNull();
  });
});
