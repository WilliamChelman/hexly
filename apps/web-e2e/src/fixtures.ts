import { test as base, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
// Reuse the app's own pretty-URL codec (ADR-0042): URL segments are `slug-base62(id)`,
// so specs decode a segment back to the canonical id and build loose matchers from it.
// A direct file import (not the @hexly/web-core barrel) keeps the Playwright process off the
// Angular services layer the barrel re-exports — pretty-id is a pure util. The nx
// module-boundary rule is waived for these pure utils via eslint.config.mjs `allow`.
import { idFromSegment, segment } from '../../../libs/web-core/src/utils/pretty-id';
// Same waiver: the View-instance codec is framework-free, and a View's key is what a toggle's testid
// and the `?view=` param carry — so a spec shares the encoder rather than re-spelling it.
import { viewInstanceKey } from '../../../libs/web-entity/src/lib/view-instance';

/**
 * The base test for the authenticated suite. An auto fixture resets the database
 * to a clean slate (maps only) before each test via the e2e-only reset endpoint,
 * so no test ever sees another test's maps (ADR-0009). The reset keeps users and
 * sessions, so the shared login from `auth.setup.ts` survives it.
 *
 * This is a fixture, not a top-level `beforeEach`: a shared module is evaluated
 * once, so a top-level hook would register against only the first importer's
 * suite — an auto fixture runs per test regardless.
 *
 * The reset POST is intentionally unauthenticated and relies on `TestController`
 * having no guard, so it works even for the logged-out auth journey.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      const res = await request.post('/api/test/reset');
      expect(res.ok()).toBeTruthy();
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * The open Entity's canonical id, decoded from the pretty URL segment (ADR-0042).
 * The last path segment is `slug-base62(id)`; specs need the raw id for testid
 * selectors (`open-<id>`) and `/api/entities/<id>` calls.
 */
export function entityIdFromUrl(page: Page): string {
  return idFromSegment(page.url().split('/').pop()!);
}

/**
 * A regex fragment matching a pretty URL segment (`slug-base62(id)` or bare code)
 * carrying `id` (ADR-0042). The base62 suffix is alnum-only, so it needs no escaping;
 * the `[^/]*` absorbs the optional cosmetic slug prefix.
 */
export function segRe(id: string): string {
  return `[^/]*${segment(id)}`;
}

/** A Hex Map's grid, as the map specs read it back off the server. */
interface SavedGrid {
  hexes: Record<string, { terrain: string; name?: string; entityId?: string; feature?: { ref: string } }>;
  regions: Array<{ id: string; name: string; color: string; hexes: Record<string, true>; entityId?: string }>;
  labels: Array<{ id: string; text: string; position: { x: number; y: number }; size: number; rotation?: number }>;
}

/**
 * The grid a Hex Map has actually persisted, fetched from the API — what a map spec checks after a
 * save, beyond what the reloaded canvas already shows.
 *
 * The one place a test knows *where* the grid is stored (the `grid` Field's value in the Entity's
 * Metadata, ADR-0050), so moving it again is a one-line change rather than a sweep.
 */
export async function savedGrid(request: APIRequestContext, entityId: string): Promise<SavedGrid> {
  const res = await request.get(`/api/entities/${entityId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  return detail.document.metadata.grid as SavedGrid;
}

/**
 * A map View toggle's testid — the View id plus the **Structured Field** it renders (ADR-0050).
 * `core.hexmap` declares its grid at `grid`; a user-defined type declares its own at whatever key its
 * author chose. Composed through the app's own {@link viewInstanceKey}, so a spec can never disagree
 * with the header about how a View instance is spelled.
 */
export function mapViewToggle(fieldKey = 'grid'): string {
  return viewInstanceKey({ viewId: 'core.view.map', fieldKey });
}

/**
 * Wait for a successful entity PUT. Since the Save button is gone (ADR-0026),
 * this is used with Cmd/Ctrl+S to flush autosave immediately.
 */
export function waitForSave(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/entities\/[\w-]+$/.test(res.url()) && res.ok(),
  );
}

/**
 * Flush a pending autosave and wait for it to commit (ADR-0026 — no Save button): press
 * Cmd/Ctrl+S, await the PUT, and confirm the status chip settles on 'Saved'. Returns the
 * PUT Response for the specs that read the saved payload straight off it.
 */
export async function flushSave(page: Page): Promise<Response> {
  const saved = waitForSave(page);
  await page.keyboard.press('ControlOrMeta+s');
  const res = await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return res;
}

/**
 * Enter a reachable World's Entity browser via the World Index (ADR-0028). The
 * active World is a URL fact now (`/w/:worldId/entities`), not a remembered
 * selection, so a test reaches its library by choosing a World from the Index at
 * `/`. The seeded World always survives the entities-only reset (only Entities are
 * cleared, never Worlds), so the Index is never empty here. Returns the entered
 * World's id for specs that want to assert the URL scope.
 */
/**
 * Open the entity header's actions overflow menu (Visibility, Pin, Share). The three
 * are gathered behind one trigger, so a spec opens the menu before addressing an item.
 */
export async function openEntityActions(page: Page): Promise<void> {
  await page.getByTestId('entity-actions').click();
}

export async function enterLibrary(page: Page): Promise<string> {
  await page.goto('/');
  // The card lands on the World Dashboard — the World root (ADR-0043); the rail's
  // Library link enters the Entity browser from there.
  await page
    .getByTestId(/^world-/)
    .first()
    .click();
  await page.getByRole('link', { name: 'Library' }).click();
  await page.waitForURL(/\/w\/[\w-]+\/entities$/);
  return page.url().match(/\/w\/([\w-]+)\/entities/)![1];
}

/**
 * Create an Entity of `typeId` through the "New" split button's type menu, and open it (#195).
 * The menu lists every registered Entity Type and derives each item's testid from the type id,
 * so the next plugin's create affordance is reachable here with no new helper. Returns the new
 * Entity's canonical id.
 *
 * The caller must already be on a surface carrying the button — `enterLibrary`, or an empty
 * World Dashboard. A Type declaring a *required* Field opens the create dialog instead, so it
 * is created through that (see `dnd-monster.spec.ts`), not through this helper.
 */
export async function createEntity(page: Page, typeId: string): Promise<string> {
  await page.getByTestId('new-entity-menu').click();
  await page.getByTestId(`new-entity-${typeId}`).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  return entityIdFromUrl(page);
}
