# Asset

The bundled plugin contributing the `core.type.asset` Entity type and `core.field.asset` — binary files (images today) wrapped as browsable, shareable Entities whose bytes live behind a capability link. Builds on the **Platform** context (see [CONTEXT-MAP.md](../../CONTEXT-MAP.md)).

## Language

**Asset**:
An Entity carrying the `core.type.asset` type — a binary file (an image today; PDFs, audio later) wrapped as the unit users browse, rename, tag, share, and delete. Two access layers, deliberately distinct: the Entity sits under the ordinary sharing model, while its **bytes** are served by an unguessable capability link.
_Avoid_: Attachment, file, blob, media, upload; Asset Entity (an Asset _is_ an Entity)

**Missing Bytes**:
The state of an Asset whose bytes are not under the resolved Assets root — an unmounted volume, a relocated `assets.dir`, a half-synced folder. A named state, not an error: the Entity, its Asset Stats, and its prose stay intact, and the fix is restoring the file.
_Avoid_: Broken, corrupt, orphaned, dangling (a dead Entity Link, not this), lost

**Asset Stats**:
Mechanical facts derived from an Asset's bytes — an image's dimensions, orientation, and dominant color; later a PDF's page count, an audio file's duration. Computed, never authored.
_Avoid_: Metadata (overloaded), EXIF, properties, stats (bare, in prose about anything else)

**Augmentation**:
An interpretive, machine-produced description or tags on an Asset — a future AI plugin's output. Distinct from Asset Stats (mechanical facts) and Tags (authored labels).
_Avoid_: AI tags, annotation, auto-tags, labels

**Asset Browser**:
The Entity Browser preset to the asset type, presented as thumbnail tiles with upload at hand. Rename, share, and delete are ordinary Entity operations.
_Avoid_: Media library, gallery, asset manager, file manager
