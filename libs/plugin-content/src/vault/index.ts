/**
 * The Content plugin's vault surface (ADR-0051): the `core.rich-content` data-type with its Markdown
 * converter, for the host that runs a vault import/export — the API. A separate entry point, off the
 * framework-free barrel, so the converter's toolchain never reaches the web (which registers the
 * converter-free `RICH_CONTENT_DATA_TYPE`) — as `/web` keeps TipTap out of it.
 */
export { RICH_CONTENT_DATA_TYPE_VAULT } from '../lib/rich-content-vault';
