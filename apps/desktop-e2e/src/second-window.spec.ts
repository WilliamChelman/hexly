import { clickMenuItem, expect, test } from './desktop-app';

/**
 * The two facts that make this a native window rather than a browser tab (ADR-0070): a second window on the
 * *same* Instance, so a Note can be read beside the Hex Map that links to it, and the pair reconciling
 * through the nudge bus — which is coherent precisely because live-follow was kept (ADR-0044), so the user's
 * own windows never disagree.
 *
 * The spellchecker is asserted here rather than in a spec of its own: it needs an editable surface in front of
 * it, this launch already has one open, and a launch costs a boot and a migration run.
 */
test('a second window opens on the same Instance, and an edit in one appears live in the other', async ({ launch }) => {
  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);

  // A World and an Entity, so both windows have the same thing open.
  await run.window.getByTestId('create-world').click();
  await run.window.waitForURL(/\/w\/[^/]+/);
  await run.window.getByTestId('new-default-entity').click();
  await run.window.waitForURL(/\/entities\/[\w-]+$/);
  const entityUrl = run.window.url();

  const opening = run.app.waitForEvent('window');
  await clickMenuItem(run.app, 'new-window');
  const second = await opening;
  await second.waitForURL(/\/worlds$/);

  // The same Instance is the whole claim: one API, one database, one session — not a second server, and no
  // login, since the cookie jar is the app's rather than the window's.
  expect(new URL(second.url()).origin).toBe(run.origin);
  await expect(second.getByTestId('worlds-empty')).toHaveCount(0);

  await second.goto(entityUrl);
  await expect(second.getByTestId('note-content')).toBeVisible();

  // The spellchecker: session-wide, so one setting covers Content, a Board's Text Blocks and the name fields.
  const spellchecker = await run.app.evaluate(({ session }) => ({
    enabled: session.defaultSession.spellCheckerEnabled,
    languages: session.defaultSession.getSpellCheckerLanguages(),
  }));
  expect(spellchecker.enabled).toBe(true);
  // That *a* language is set. Which one is the machine's locale — and that it is only ever one — is asserted
  // in `apps/desktop/src/spellcheck.spec.ts`; on macOS this reads the OS's own list back.
  expect(spellchecker.languages.length).toBeGreaterThan(0);

  // The editable nodes themselves, not their wrappers: `note-content` hosts tiptap's `contenteditable` and the
  // name field *is* one. `spellcheck` is inherited, so the count of opt-outs is what proves nothing exempted
  // itself — the Entity title used to carry one.
  expect(
    await run.window.evaluate(() => ({
      content: document.querySelector<HTMLElement>('[data-testid=note-content] [contenteditable]')?.spellcheck,
      name: document.querySelector<HTMLElement>('[data-testid=title]')?.spellcheck,
      optedOut: document.querySelectorAll('[spellcheck=false]').length,
    })),
  ).toEqual({ content: true, name: true, optedOut: 0 });

  // The edit, committed in the first window. Armed before it, so the follower's refetch cannot be missed.
  const followed = second.waitForResponse(
    (res) => /\/api\/entities\/[\w-]+$/.test(res.url()) && res.request().method() === 'GET' && res.ok(),
  );
  await run.window.getByTestId('note-content').click();
  await run.window.keyboard.type('Two windows, one Instance.');
  await run.window.keyboard.press('ControlOrMeta+s');
  await expect(run.window.getByTestId('save-status')).toHaveText('Saved');

  // No reload was issued: the nudge reached the other window and it refetched on its own.
  await followed;
  await expect(second.getByTestId('note-content')).toContainText('Two windows, one Instance.');
});
