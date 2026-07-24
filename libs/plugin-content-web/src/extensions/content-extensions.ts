import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { entityLinkNode } from './entity-link-node';
import { calloutNode } from './callout-node';

/**
 * The TipTap extension set — part of the `tiptap-v3` format contract (ADR-0019/0033).
 * ProseMirror JSON is schema-coupled: content for a node type not in this list is
 * silently dropped on load, so adding or removing a node or mark is a format bump +
 * migration, not a transparent edit.
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
