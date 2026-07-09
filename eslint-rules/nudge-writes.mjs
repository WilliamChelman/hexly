/**
 * The write choke points, enforced (ADR-0045).
 *
 * `EntityWrites` is the single write handle for `entities` and `entity_grants`; `WorldWrites` is
 * its peer for `worlds` and `world_members`. Each owns the `seq` bump and the post-commit nudge,
 * so a write *cannot* land without telling the resource's live-followers to refetch — or evicting
 * them. `WorldWrites` additionally fans a membership change out to the World's `shared` Entities,
 * whose Rights derive from that membership set.
 *
 * That property is only real if nothing else writes those tables. ADR-0044 enumerated its emit
 * points and the implementation faithfully built what was enumerated; `addGrant`, `removeGrant`,
 * `addOwner` and `removeOwner` emitted nothing, so revoking a Viewer's grant left them live-
 * following a `private` Entity. The World path repeated the mistake one level up: `bumpAndNudge`
 * nudged the World and forgot its shared Entities, so a promoted World Owner kept a read-only
 * Rights array. These rules make that bug class unstatable, in the idiom of the raw-`immer` ban.
 *
 *   no-direct-entity-writes — `insert|update|delete` on `entities` / `entityGrants`, and raw SQL
 *                             writing those tables, outside EntityWrites itself.
 *   no-direct-world-writes  — the same for `worlds` / `worldMembers`, outside WorldWrites itself.
 *
 * Scope is set by the consuming config (apps/api/eslint.config.mjs), which exempts specs — they
 * seed fixtures directly and follow nobody.
 */

/** The drizzle mutation verbs. `select`/`from` are reads and stay open. */
const WRITE_METHODS = new Set(['insert', 'update', 'delete']);

/** The literal text of a string or a template literal with no interpolation. */
function staticText(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis.map((q) => q.value.cooked ?? '').join('');
  return null;
}

/**
 * Build the guard for one choke point.
 *
 * @param tables       drizzle table identifiers whose every change must bump `seq` and nudge.
 *                     Siblings that cascade with the guarded row (`entityDescriptors`,
 *                     `entityLinks`, `worldLinks`) carry no freshness key and are open — a change
 *                     to them rides its owner's `seq` bump.
 * @param sqlTables    the same tables as raw SQL names. Raw SQL escapes the drizzle selector
 *                     entirely (`db.$client.prepare(...)`), and the codebase reaches for it.
 * @param ownerFile    the module that *is* the write handle, identified by path so the exemption
 *                     is testable.
 * @param handle       the write handle's name, for the message.
 * @param entryPoints  its public methods, named so the message says where to go instead.
 */
function chokePoint({ tables, sqlTables, ownerFile, handle, entryPoints }) {
  const guarded = new Set(tables);
  const rawWrite = new RegExp(
    `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+["\`']?(${sqlTables.join('|')})\\b`,
    'i',
  );
  const messages = {
    direct: `Route this through ${handle}: it owns the \`seq\` bump and the post-commit nudge, so a write to \`{{table}}\` cannot land without refreshing or evicting its live-followers (ADR-0045).`,
    rawSql: `Raw SQL writing \`{{table}}\` bypasses ${handle}, which owns the \`seq\` bump and the post-commit nudge (ADR-0045). Use ${entryPoints}.`,
  };

  return {
    meta: {
      type: 'problem',
      docs: { description: `Only ${handle} may write ${tables.join(' and ')} (ADR-0045).` },
      schema: [],
      messages,
    },
    create(context) {
      const filename = context.filename ?? context.getFilename?.() ?? '';
      // The write handle itself may of course write its own tables.
      if (filename.endsWith(ownerFile)) return {};
      return {
        CallExpression(node) {
          // `db.update(entities)`, `tx.delete(entityGrants)` — the receiver is irrelevant, so a
          // transaction handle is no escape hatch.
          const { callee } = node;
          if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            WRITE_METHODS.has(callee.property.name)
          ) {
            const [table] = node.arguments;
            if (table?.type === 'Identifier' && guarded.has(table.name)) {
              context.report({ node, messageId: 'direct', data: { table: table.name } });
              return;
            }
          }
          // Raw SQL: any statically-known string argument that writes a guarded table.
          for (const arg of node.arguments) {
            const text = staticText(arg);
            const match = text && rawWrite.exec(text);
            if (match) {
              context.report({ node: arg, messageId: 'rawSql', data: { table: match[2] } });
              return;
            }
          }
        },
      };
    },
  };
}

const noDirectEntityWrites = chokePoint({
  tables: ['entities', 'entityGrants'],
  sqlTables: ['entities', 'entity_grants'],
  ownerFile: 'entity-writes.ts',
  handle: 'EntityWrites',
  entryPoints: '`EntityWrites.mutate`, `insert`, `cascadeDeleteWorld`, `bumpWorldShared`, or `purgeGrantsOf`',
});

const noDirectWorldWrites = chokePoint({
  tables: ['worlds', 'worldMembers'],
  sqlTables: ['worlds', 'world_members'],
  ownerFile: 'world-writes.ts',
  handle: 'WorldWrites',
  entryPoints: '`WorldWrites.mint`, `update`, `delete`, `membership`, or `purgeMembershipsOf`',
});

export default {
  rules: {
    'no-direct-entity-writes': noDirectEntityWrites,
    'no-direct-world-writes': noDirectWorldWrites,
  },
};
