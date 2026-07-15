import { test as base, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
// The app's own pretty-URL codec (ADR-0042). Imported by file path, not via the @hexly/web-core
// barrel: the barrel re-exports the Angular services layer, which must stay out of the Playwright
// process. The nx module-boundary rule is waived for these pure utils via eslint.config.mjs `allow`.
import { idFromSegment, segment } from '../../../libs/web-core/src/utils/pretty-id';
// Same waiver: the View-instance codec is framework-free.
import { viewInstanceKey } from '../../../libs/web-entity/src/lib/view-instance';

/**
 * The base test for the authenticated suite. An auto fixture resets the database before each test
 * (ADR-0009); the reset keeps users and sessions, so the shared login from `auth.setup.ts` survives.
 *
 * A fixture, not a top-level `beforeEach`: a shared module is evaluated once, so a top-level hook
 * would register against only the first importer's suite — an auto fixture runs per test regardless.
 *
 * The reset POST is unauthenticated (`TestController` has no guard), so it also works for the
 * logged-out auth journey.
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

/** The open Entity's canonical id, decoded from the last pretty URL segment `slug-base62(id)` (ADR-0042). */
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
 * The grid a Hex Map has actually persisted, fetched from the API. The one place a test knows *where*
 * the grid is stored: a **Structured Field**'s value in the Entity's body, which **is** the EntityDocument
 * map (ADR-0050, ADR-0051). `core.hexmap` declares its grid at `grid`; a user-defined type declares
 * its at whatever key its author chose — that is `fieldKey`.
 */
export async function savedGrid(request: APIRequestContext, entityId: string, fieldKey = 'grid'): Promise<SavedGrid> {
  const res = await request.get(`/api/entities/${entityId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  return detail.document[fieldKey] as SavedGrid;
}

/**
 * A map View toggle's testid — the View id plus the **Structured Field** it renders (ADR-0050),
 * composed through the app's own {@link viewInstanceKey}.
 */
export function mapViewToggle(fieldKey = 'grid'): string {
  return viewInstanceKey({ viewId: 'core.view.map', fieldKey });
}

/**
 * A content View toggle's testid (ADR-0051). A prose Field's View is bound to the Field it renders, so
 * an Entity with two prose Fields affords two content Views, each keyed by its Field (`content`,
 * `secrets`) — exactly as a second grid keys the map View. A Type placing the View by id (the Note)
 * keys plain, so `fieldKey` is optional.
 */
export function contentViewToggle(fieldKey?: string): string {
  return viewInstanceKey({ viewId: 'core.view.content', fieldKey });
}

/** Wait for a successful entity PUT. There is no Save button (ADR-0026): pair this with Cmd/Ctrl+S. */
export function waitForSave(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/entities\/[\w-]+$/.test(res.url()) && res.ok(),
  );
}

/**
 * Flush a pending autosave and wait for it to commit: Cmd/Ctrl+S, await the PUT, and confirm the
 * status chip settles on 'Saved'. Returns the PUT Response, whose body carries the saved payload.
 */
export async function flushSave(page: Page): Promise<Response> {
  const saved = waitForSave(page);
  await page.keyboard.press('ControlOrMeta+s');
  const res = await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  return res;
}

/** Open the entity header's actions overflow menu (Visibility, Pin, Share). */
export async function openEntityActions(page: Page): Promise<void> {
  await page.getByTestId('entity-actions').click();
}

/**
 * Open an Entity by id through the World-agnostic `/entities/:id` link, which the redirect guard
 * heals into its canonical `/w/:worldId/entities/:id` route (ADR-0025, ADR-0042). Lets a spec that
 * seeded an Entity over the API land on its page without threading the World id through.
 */
export async function openEntity(page: Page, entityId: string): Promise<void> {
  await page.goto(`/entities/${segment(entityId)}`);
  await page.waitForURL(/\/w\/[\w-]+\/entities\/[^/]+$/);
}

/**
 * Enter a reachable World's Entity browser via the World Index at `/` (ADR-0028), and return the
 * entered World's id. The reset clears Entities only, never Worlds, so the Index is never empty here.
 */
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
 * Create an Entity of `typeId` through the "New" split button's type menu, open it, and return its
 * canonical id. The caller must already be on a surface carrying the button — `enterLibrary`, or an
 * empty World Dashboard. A Type declaring a *required* Field opens the create dialog instead, and is
 * not creatable through this helper (see `dnd-monster.spec.ts`).
 */
export async function createEntity(page: Page, typeId: string): Promise<string> {
  await page.getByTestId('new-entity-menu').click();
  await page.getByTestId(`new-entity-${typeId}`).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  return entityIdFromUrl(page);
}

/** A Field on a user-defined type, as the World Types editor's form takes one. */
export interface AuthoredField {
  readonly key: string;
  readonly label: string;
  /** A **Structured Field**'s data-type (`core.hex-grid`, #201); absent leaves the form's `string`. */
  readonly kind?: string;
}

/**
 * Author a user-defined type in a World's settings, and land back on the types list with it saved.
 * `id` is the bare id the form takes; the World's namespace makes it `world.<id>`.
 */
export async function authorWorldType(
  page: Page,
  worldId: string,
  type: { id: string; name: string; fields: readonly AuthoredField[] },
): Promise<void> {
  await page.goto(`/w/${worldId}/settings`);
  await page.getByTestId('type-new').click();
  await page.getByTestId('type-id-input').fill(type.id);
  await page.getByTestId('type-name-input').fill(type.name);

  for (const [index, field] of type.fields.entries()) {
    await page.getByTestId('add-field').click();
    const row = page.getByTestId(`field-${index}`);
    await row.getByTestId('field-key').fill(field.key);
    await row.getByTestId('field-label').fill(field.label);
    if (field.kind) await row.getByTestId('field-kind').selectOption(field.kind);
  }

  await page.getByTestId('type-save').click();
  await expect(page.getByTestId(`type-world.${type.id}`)).toBeVisible();
}

/**
 * Add `typeId` to the open Entity through the header's Edit-types dialog, minting the defaults its
 * Fields declare. Only for a type whose Fields are all optional: one declaring a *required* Field
 * prompts for it before the add commits, which a spec drives itself.
 */
export async function addType(page: Page, typeId: string): Promise<void> {
  await openEntityActions(page);
  await page.getByTestId('edit-types').click();
  await page.getByTestId('type-add').selectOption(typeId);
  await page.getByTestId('types-close').click();
}
