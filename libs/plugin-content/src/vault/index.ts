/**
 * The Content plugin's vault surface (ADR-0051): the `core.rich-content` data-type carrying its
 * Markdown converter, for the host that runs a vault import/export — the API. It is a *separate* entry
 * point, deliberately kept out of the framework-free barrel (`@hexly/plugin-content`), because its
 * converter drags in the `unified`/`remark`/`yaml` toolchain (~160 kB) that the browser never runs. The
 * web imports the barrel's converter-free `RICH_CONTENT_DATA_TYPE` instead, so the toolchain cannot
 * reach the initial web bundle through a shared barrel — the same way `/web` keeps TipTap out of it.
 */
export { RICH_CONTENT_DATA_TYPE_VAULT } from '../lib/rich-content-vault';
