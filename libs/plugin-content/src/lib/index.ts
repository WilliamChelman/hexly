export * from './content-node';
export * from './entity-link';
export * from './extract-text';
export * from './extract-outline';
export * from './content';
export * from './asset-extensions';
// The Markdown↔ProseMirror converters are deliberately NOT re-exported here: they pull in the
// `unified`/`remark`/`micromark`/`yaml` toolchain (~160 kB), and this barrel is imported by the eager
// web app. Their sole consumers — the `/vault` entry's data-type and the round-trip specs — reach them
// by relative path, so the toolchain stays out of the initial web bundle (ADR-0051).
export * from './rich-content';
export * from './note-type';
