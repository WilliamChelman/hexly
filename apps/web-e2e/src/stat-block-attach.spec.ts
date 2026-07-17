import {
  attachField,
  contentViewToggle,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  statBlockViewToggle,
  test,
} from './fixtures';

/** The attached stat block's View toggle, keyed by the `stat_block` Field the attachment carries (ADR-0055). */
const STAT_BLOCK_VIEW = statBlockViewToggle();
/** The note's own content View, placed by id — keys plain. */
const NOTE_VIEW = contentViewToggle();

/**
 * A Field of a **Structured Data Type** attached *directly* to a non-monster auto-affords its View
 * (#236, ADR-0054/0055): a plain `core.note` carrying an instance-attached `dnd.stat-block` Field affords
 * the stat-block View, editing the inner value at its one document key via `VIEW_FIELD_KEY`. The sibling
 * of `attached-grid.spec.ts` — here the structured value is a stat block, not a grid, and its harvested
 * dimensions surface as rail Facets that drill down against siblings.
 */
test('attaches dnd.stat-block to a note, affords its View, and browses its stats as Facets', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  const id = await createEntity(page, 'core.note');
  await expect(page.getByTestId('title')).toBeVisible();
  // A plain note affords its Content View alone — no stat block yet.
  await expect(page.getByTestId(STAT_BLOCK_VIEW)).toHaveCount(0);

  // Attach the `dnd.stat-block` Field — the note's type never named it (CONTEXT.md → Entity).
  await attachField(page, 'dnd.stat_block');

  // The attachment auto-affords the stat-block View, appended after the note's Content View (ADR-0054).
  await expect(page.getByTestId(NOTE_VIEW)).toBeVisible();
  await expect(page.getByTestId(STAT_BLOCK_VIEW)).toBeVisible();
  await page.getByTestId(STAT_BLOCK_VIEW).click();
  await expect(page.getByTestId('stat-block-view')).toBeVisible();

  // Edit the inner value at the one document key — the same laid-out block a monster gets.
  await page.getByTestId('stat-size').locator('select').selectOption('Large');
  await page.getByTestId('stat-creature_type').locator('select').selectOption('aberration');
  await page.getByTestId('stat-challenge_rating').locator('input').fill('10');
  await expect(page.getByTestId('stat-block-subtitle')).toContainText('Large aberration');

  await flushSave(page);

  // The whole block round-trips as one grouped value at the `stat_block` key, and the attachment persists.
  const res = await request.get(`/api/entities/${id}`);
  const detail = await res.json();
  expect(detail.fields).toEqual(['dnd.stat_block']);
  expect(detail.document.stat_block).toMatchObject({
    size: 'Large',
    creature_type: 'aberration',
    challenge_rating: 10,
  });

  // Back in the Library, no active Type filter: the stat block's harvested dimensions surface as Facets,
  // even though this Entity is a plain note (ADR-0055) — faceting keys off the Data Type's harvest.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
  // Rendered with their *translated* labels (ADR-0055): a dimension's labelKey resolves through the
  // active locale, unlike a scalar Field's authored label.
  await expect(page.getByTestId('facet-field-size')).toContainText('Size');
  await expect(page.getByTestId('facet-field-creature_type')).toContainText('Creature type');
  await expect(page.getByTestId('facet-field-challenge_rating')).toContainText('Challenge Rating');

  // The dimensions drill down like any facet: the size value narrows the list to this note.
  await page.getByTestId('facet-field-size-Large').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
});
