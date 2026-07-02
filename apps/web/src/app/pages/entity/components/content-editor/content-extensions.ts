import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { entityLinkNode } from './entity-link-node';
import { calloutNode } from './callout-node';

/**
 * The TipTap extension set — part of the format contract (ADR-0019). ProseMirror
 * JSON is schema-coupled: content for a node type not in this list is silently
 * dropped on load, so adding/removing a node or mark is a format bump + migration,
 * not a transparent edit. `entityLink` (ADR-0023) made this set `tiptap-v2`; the
 * Obsidian-import nodes/mark below — `image`, `table`, `taskList`, and the
 * `highlight` mark (plus the `callout` node) — make it `tiptap-v3` (ADR-0033).
 */
export const CONTENT_EXTENSIONS: Extensions = [
  StarterKit,
  entityLinkNode,
  calloutNode,
  Highlight,
  Image,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem,
];
