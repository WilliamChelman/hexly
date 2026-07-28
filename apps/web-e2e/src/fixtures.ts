import { join } from 'node:path';
import { test as base, expect, type APIRequestContext, type Browser, type Page, type Response } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { TEST_GRANTEE } from './test-user';
// The app's own pretty-URL codec (ADR-0042). Imported by file path, not via the @hexly/web-core
// barrel: the barrel re-exports the Angular services layer, which must stay out of the Playwright
// process. The nx module-boundary rule is waived for these pure utils via eslint.config.mjs `allow`.
import { idFromSegment, segment } from '../../../libs/web-core/src/utils/pretty-id';
// Same waiver: the View-instance codec is framework-free.
import { viewInstanceKey } from '../../../libs/web-entity/src/utils/view-instance';

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

/**
 * The Instance Directory this run's server booted against, derived exactly as `e2e-server.mjs` does so the
 * two cannot drift. A spec needs it to reach the same filesystem the API reads (#325).
 */
export const instanceDir = process.env.E2E_INSTANCE_DIR ?? join(__dirname, '..', '..', '..', 'tmp', 'web-e2e');

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
 * the grid is stored: a **Field of a Structured Data Type**'s value in the Entity's body, which **is** the EntityDocument
 * map (ADR-0050, ADR-0051). `core.type.hex-map` declares its grid at `core.field.grid` (ADR-0056); a user-defined
 * type declares its at whatever key its author chose — that is `fieldKey`.
 */
export async function savedGrid(
  request: APIRequestContext,
  entityId: string,
  fieldKey = 'core.field.grid',
): Promise<SavedGrid> {
  const res = await request.get(`/api/entities/${entityId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  return detail.document[fieldKey] as SavedGrid;
}

/**
 * A map View toggle's testid — the View id plus the **Field of a Structured Data Type** it renders (ADR-0050),
 * composed through the app's own {@link viewInstanceKey}.
 */
export function mapViewToggle(fieldKey = 'core.field.grid'): string {
  return viewInstanceKey({ viewId: 'core.view.map', fieldKey });
}

/**
 * A content View toggle's testid (ADR-0051). A prose Field's View is bound to the Field it renders, so
 * an Entity with two prose Fields affords two content Views, each keyed by its Field (`content`,
 * `secrets`) — exactly as a second grid keys the map View. A Type placing the View by id (the Note)
 * keys plain, so `fieldKey` is optional.
 */
export function contentViewToggle(fieldKey?: string): string {
  return viewInstanceKey({ viewId: 'core.view.rich-content', fieldKey });
}

/**
 * The stat-block View toggle's testid (ADR-0055). The stat block is a **Structured Data Type**'s View
 * now, bound to the `dnd.datatype.stat-block` Field that placed it, so it keys `viewId:fieldKey` like the map —
 * `dnd.type.monster` places it at `dnd.field.stat-block`, an attachment at whatever key the Field carries.
 */
export function statBlockViewToggle(fieldKey = 'dnd.field.stat-block'): string {
  return viewInstanceKey({ viewId: 'dnd.view.stat-block', fieldKey });
}

/**
 * Wait for the roaming write a Preferences change fires (ADR-0038). It is fire-and-forget, so a spec
 * whose choice must not outlive it — the e2e account is shared and survives the entities-only reset —
 * arms this before the change, and again before undoing it.
 */
export function preferencesPatched(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) => res.url().endsWith('/api/auth/me/preferences') && res.request().method() === 'PATCH' && res.ok(),
  );
}

/**
 * The Entities `q` returns that are actually *named* `name`. A hit count answers a different question:
 * `q` is full-text over prose (ADR-0035), so a note matches the mention typed into it as soon as an
 * autosave indexes the text — which says nothing about what was created.
 */
export async function entitiesNamed(request: APIRequestContext, name: string): Promise<{ name: string }[]> {
  const found = await (await request.get(`/api/entities?q=${encodeURIComponent(name)}`)).json();
  return (found.items as { name: string }[]).filter((entity) => entity.name === name);
}

/** Wait for a successful entity PUT. There is no Save button (ADR-0026): pair this with Cmd/Ctrl+S. */
export function waitForSave(page: Page): Promise<Response> {
  return page.waitForResponse(
    (res) => res.request().method() === 'PUT' && /\/api\/entities\/[\w-]+$/.test(res.url()) && res.ok(),
  );
}

/**
 * Flush a pending autosave and wait for it to commit: Cmd/Ctrl+S, then confirm the status chip
 * settles on 'Saved'. Returns the *last* PUT Response — an earlier debounced autosave may land in
 * the same window with a stale payload, so the first PUT is not necessarily the flushed one.
 */
export async function flushSave(page: Page): Promise<Response> {
  const saves: Response[] = [];
  const collect = (res: Response) => {
    if (res.request().method() === 'PUT' && /\/api\/entities\/[\w-]+$/.test(res.url()) && res.ok()) saves.push(res);
  };
  page.on('response', collect);
  const first = waitForSave(page);
  await page.keyboard.press('ControlOrMeta+s');
  await first;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  page.off('response', collect);

  // `collect` is registered before the waiter, so the PUT that resolved `first` is already in here —
  // an empty list would mean that invariant broke, not that the caller may get `undefined`.
  const last = saves.at(-1);
  if (!last) throw new Error('flushSave: the save that settled the status chip was not observed');
  return last;
}

/** Open the entity header's actions overflow menu (Visibility, Pin, Share). */
export async function openEntityActions(page: Page): Promise<void> {
  await page.getByTestId('entity-actions').click();
}

/** Grant the second seeded user a role on the open Entity, through the header's Share dialog (ADR-0037). */
export async function shareOpenEntity(page: Page, role: 'editor' | 'viewer'): Promise<void> {
  await openEntityActions(page);
  await page.getByTestId('manage-owners').click();
  await page.getByTestId('grant-add-select').selectOption({ label: TEST_GRANTEE.displayName });
  await page.getByTestId('grant-add-role').selectOption(role);
  const granted = page.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+\/grants$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('grant-add').click();
  await granted;
  await page.getByTestId('owners-close').click();
}

/** Add the second seeded user to a World with `role`, from the World's Settings Access pane. */
export async function addWorldMember(page: Page, worldSeg: string, role: 'contributor' | 'viewer'): Promise<void> {
  await page.goto(`/w/${worldSeg}/settings`);
  // Owner-set and member-set share `add-select`/`add` testids, so scope to the member controls.
  const memberAdd = page.locator('app-member-set');
  await memberAdd.getByTestId('add-select').selectOption({ label: TEST_GRANTEE.displayName });
  await memberAdd.getByTestId('add-role').selectOption(role);
  const added = page.waitForResponse(
    (r) => /\/api\/worlds\/[\w-]+\/members$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await memberAdd.getByTestId('add').click();
  await added;
}

/**
 * Log the second seeded user in through the real UI, in their own cookie-less context — the project's
 * authenticated storage state is the *first* user's, so a second standing needs its own context.
 */
export async function signInGrantee(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_GRANTEE.email);
  await page.getByLabel('Password').fill(TEST_GRANTEE.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveTitle(/Worlds/);
  return page;
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
 * empty World Dashboard. Every Type mints this way, `required` Fields and all (ADR-0074).
 */
export async function createEntity(page: Page, typeId: string): Promise<string> {
  await page.getByTestId('new-entity-menu').click();
  await page.getByTestId(`new-entity-${typeId}`).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  return entityIdFromUrl(page);
}

/** A Field on a user-defined type, as the World Types editor's form takes one. */
export interface AuthoredField {
  /** The `world.`-less key segment the form slugs into a `world.field.<segment>` id/key (ADR-0056). */
  readonly segment: string;
  readonly label: string;
  /** A **Structured Data Type** (`core.datatype.hex-grid`, #201); absent leaves the form's `string`. */
  readonly kind?: string;
}

/**
 * Author a user-defined type in a World's settings, and land back on the types list with it saved.
 * `id` is the bare id the form takes; the World's namespace makes it `world.type.<id>`. `fields` are
 * minted inline; `refs` name already-authored Fields to reference by id (ADR-0054) — the way to give a
 * type a Field whose own flags (`required`, say) the Fields editor set.
 */
export async function authorWorldType(
  page: Page,
  worldId: string,
  type: { id: string; name: string; fields: readonly AuthoredField[]; refs?: readonly string[] },
): Promise<void> {
  await page.goto(`/w/${worldId}/settings`);
  // Settings is a master/detail layout; the type/field editors live under the Schema section.
  await page.getByTestId('settings-nav-schema').click();
  await page.getByTestId('type-new').click();
  await page.getByTestId('type-id-input').fill(type.id);
  await page.getByTestId('type-name-input').fill(type.name);

  // A type *references* Fields by id (ADR-0054): mint each inline from the new-Field modal, which
  // slugs a `world.field.<segment>` Field from the label/segment and references it (ADR-0056). The reference
  // checkbox confirms it landed.
  for (const field of type.fields) {
    await page.getByTestId('new-field').click();
    await page.getByTestId('newfield-name').fill(field.label);
    await page.getByTestId('newfield-key').fill(field.segment);
    if (field.kind) await page.getByTestId(`newfield-kind-option-${field.kind}`).click();
    await page.getByTestId('newfield-save').click();
    await expect(page.getByTestId(`field-ref-checkbox-world.field.${field.segment}`)).toBeChecked();
  }

  for (const id of type.refs ?? []) {
    await page.getByTestId(`field-ref-checkbox-${id}`).click();
    await expect(page.getByTestId(`field-ref-checkbox-${id}`)).toBeChecked();
  }

  await page.getByTestId('type-save').click();
  await expect(page.getByTestId(`type-world.type.${type.id}`)).toBeVisible();
}

/** Open a blank World Field editor, for a spec that reads the form itself rather than a Field it authored. */
export async function openWorldFieldEditor(page: Page, worldId: string): Promise<void> {
  await page.goto(`/w/${worldId}/settings`);
  // Settings is a master/detail layout; the type/field editors live under the Schema section.
  await page.getByTestId('settings-nav-schema').click();
  await page.getByTestId('field-new').click();
}

/**
 * Author a reusable World-defined Field in a World's settings (ADR-0054, #230, ADR-0056), and land back
 * on the Fields list with it saved. `segment` is the `world.`-less key the form slugs into `world.field.<segment>`
 * (its id *and* document key); the label drives it but the fixture sets it explicitly. `kind` defaults to
 * the form's `string`; `options` fills an enum's comma-separated list. `decor` (ADR-0069) checks the
 * "presentation only" box, offered only on an `entityLink` kind. `required` (ADR-0074) checks the box that
 * makes the Field a prompt on the surfaces that render it — never a gate on a write.
 */
export async function authorWorldField(
  page: Page,
  worldId: string,
  field: {
    segment: string;
    label: string;
    kind?: string;
    options?: string;
    decor?: boolean;
    required?: boolean;
  },
): Promise<void> {
  await openWorldFieldEditor(page, worldId);
  await page.getByTestId('field-name-input').fill(field.label);
  await page.getByTestId('field-key-input').fill(field.segment);
  if (field.kind) await page.getByTestId(`field-kind-option-${field.kind}`).click();
  if (field.options !== undefined) await page.getByTestId('field-options').fill(field.options);
  if (field.decor) await page.getByTestId('field-decor').check();
  if (field.required) await page.getByTestId('field-required').check();
  await page.getByTestId('field-save').click();
  await expect(page.getByTestId(`field-world.field.${field.segment}`)).toBeVisible();
}

/**
 * Ensure the shared Details rendering is on screen, so its inline management (`detail-*` testids) is
 * reachable (ADR-0067). A field-only Entity already shows the fallback Details View full-width; anything
 * affording another View needs the Dock's Details Panel opened. Both mount the same `details-panel`.
 */
export async function openDetails(page: Page): Promise<void> {
  // The fallback Details View renders the panel full-width as main content and offers no Dock toggle —
  // the Dock drops the redundant Details Panel there (ADR-0067); every other View puts Details behind a
  // Dock toggle. Wait for whichever this page affords (surviving the post-reload bootstrap race), then
  // open the Dock Panel only when it isn't already the shown one.
  const panel = page.getByTestId('details-panel');
  const toggle = page.getByTestId('details-toggle');
  await panel.or(toggle).first().waitFor();
  if (!(await panel.count())) await toggle.click();
  await expect(panel).toBeVisible();
}

/**
 * Drag the open Dock Panel's grip `by` px to the left — the direction that widens it (ADR-0067). The
 * Panel must already be open, and the width is held to the Dock's own bounds, so a drag past them stops
 * there rather than reporting what it asked for.
 */
export async function widenDockPanel(page: Page, by: number): Promise<void> {
  const grip = await page.getByTestId('dock-resize').boundingBox();
  if (!grip) throw new Error('the Dock resize grip is not laid out');
  const y = grip.y + grip.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(grip.x - by, y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Attach the registered Field `fieldId` to the open Entity through the Details View/Panel's inline
 * management (ADR-0067 — the Edit-fields dialog is retired). The Field must be attachable — not already
 * on the Entity's effective set.
 */
export async function attachField(page: Page, fieldId: string): Promise<void> {
  await openDetails(page);
  await page.getByTestId('detail-field-add').selectOption(fieldId);
  await expect(page.getByTestId(`detail-field-${fieldId}`)).toBeVisible();
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

/** The summary a vault import returns off the wire (ADR-0033, ADR-0073). */
export interface ImportSummary {
  worldId: string;
  notesImported: number;
  linksResolved: number;
  linksCreated: number;
  linksDangling: number;
}

/**
 * Pick a vault on the World Index's hidden file input; `setInputFiles` bypasses the click. The options
 * dialog opens and nothing uploads until {@link confirmImport} (ADR-0073), so every spec picking a vault
 * pairs the two.
 */
export async function pickVault(page: Page, zip: Buffer, name = 'Aldermoor.zip'): Promise<void> {
  await page.getByTestId('import-vault-input').setInputFiles({ name, mimeType: 'application/zip', buffer: zip });
  await expect(page.getByTestId('import-options')).toBeVisible();
}

/** Confirm the options dialog and read the import summary off the wire. */
export async function confirmImport(page: Page): Promise<ImportSummary> {
  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/api/worlds/import') && r.request().method() === 'POST' && r.ok(),
  );
  await page.getByTestId('import-confirm').click();
  return (await (await imported).json()) as ImportSummary;
}

/**
 * Land a one-note vault with auto-creation switched off and open its note, whose sole wikilink — which
 * carries both a heading anchor and a display override — stayed an Unresolved Link. Import is the only
 * producer of one (ADR-0073), so this is the seed every broken-link spec starts from.
 */
export async function importUnresolvedVault(page: Page): Promise<{ worldId: string }> {
  await page.goto('/');
  // A folder-qualified target, which Obsidian writes whenever two notes share a basename: the name a
  // promotion mints is the basename of it, never the path (ADR-0073).
  const keep = 'The northern keep guards the pass against [[bestiary/Zorblax#Lair|the old wyrm]], and holds.';
  await pickVault(page, Buffer.from(zipSync({ 'Keep.md': strToU8(keep) })));
  await page.getByTestId('import-create-unresolved').uncheck();
  const summary = await confirmImport(page);
  expect(summary.linksCreated).toBe(0);
  expect(summary.linksDangling).toBe(1);

  await page.getByTestId('open-imported').click();
  await page.getByRole('link', { name: 'Keep' }).click();
  await expect(page.getByTestId('title')).toHaveText('Keep');
  return { worldId: summary.worldId };
}
