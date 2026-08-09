import {
  enterEntities,
  expect,
  flushSave,
  setEntityVisibility,
  setWorldOpen,
  signInGrantee,
  entityIdFromUrl,
  test,
} from './fixtures';
// The pretty-URL codec (ADR-0042), imported by path like the other framework-free e2e utils.
import { segment } from '../../../libs/web-core/src/utils/pretty-id';

/**
 * The successor to the retired Public Link's live-follow (ADR-0084, ADR-0044): a signed-in non-member
 * reading a `shared` Entity in an Open World is a first-class live-follow participant. Its page updates
 * on the author's edit without a reload — the cookie principal now, never a token.
 */
test('a signed-in non-member live-follows an Open World edit — no reload', async ({ page, browser }) => {
  // The author authors a note, marks it `shared`, and Opens its World.
  const worldSeg = await enterEntities(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const entityId = entityIdFromUrl(page);

  await page.getByTestId('note-content').click();
  await page.keyboard.type('The lighthouse keeper guards a secret.');
  await flushSave(page);
  await setEntityVisibility(page, 'shared');
  await setWorldOpen(page, worldSeg, true);

  // A second signed-in account that is NOT a member opens the Entity by its canonical URL — reachable
  // only because the World is Open. The read is the ordinary authenticated one, on the session cookie.
  const visitor = await signInGrantee(browser);
  await visitor.goto(`/w/${worldSeg}/entities/${segment(entityId)}`);
  await expect(visitor.getByTestId('note-content')).toContainText('secret');

  // The author returns to the Entity and edits it (setWorldOpen left them on Settings). The save nudges
  // the non-member follower, whose page refetches the Entity (a real authenticated GET, no token) and
  // re-renders — arm the wait BEFORE the edit so we catch it.
  await page.goto(`/w/${worldSeg}/entities/${segment(entityId)}`);
  const surface = page.getByTestId('note-content');
  await expect(surface).toContainText('lighthouse');
  const followRefetch = visitor.waitForResponse(
    (r) => /\/api\/entities\/[\w-]+$/.test(r.url()) && r.request().method() === 'GET' && r.ok(),
  );
  await surface.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' The tower burned at dawn.');
  await flushSave(page);

  // The visitor's page updated live — no reload was issued.
  await followRefetch;
  await expect(visitor.getByTestId('note-content')).toContainText('burned at dawn');

  await visitor.context().close();
});
