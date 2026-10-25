import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { chunkText, embedBatch, embeddingsAvailable } from '@/server/ai/embeddings';
import type { NormalisedDocument } from '@/server/connectors/types';
import type { Database } from '@/lib/supabase/database.types';

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DocumentSource = Database['public']['Enums']['document_source'];

function hashContent(title: string, content: string): string {
  return createHash('sha256').update(`${title}\u0000${content}`).digest('hex');
}

export interface IndexOutcome {
  indexed: number;
  skipped: number;
  embedded: number;
}

/**
 * Upserts documents into the retrieval index.
 *
 * A document whose content hash is unchanged is skipped entirely, so a re-sync
 * does not re-embed material that has not moved -- embeddings are the
 * expensive part. Chunks and embeddings are replaced wholesale when content
 * does change, which avoids orphaned vectors pointing at stale text.
 */
export async function indexDocuments(
  client: Admin,
  workspaceId: string,
  integrationId: string | null,
  ownerId: string | null,
  documents: NormalisedDocument[],
): Promise<IndexOutcome> {
  const outcome: IndexOutcome = { indexed: 0, skipped: 0, embedded: 0 };
  if (documents.length === 0) return outcome;

  for (const doc of documents) {
    const contentHash = hashContent(doc.title, doc.content);

    const { data: existing } = await client
      .from('indexed_documents')
      .select('id, content_hash')
      .eq('workspace_id', workspaceId)
      .eq('source_type', doc.sourceType)
      .eq('source_record_id', doc.sourceRecordId)
      .maybeSingle();

    if (existing?.content_hash === contentHash) {
      outcome.skipped += 1;
      continue;
    }

    const row = {
      workspace_id: workspaceId,
      integration_id: integrationId,
      source_type: doc.sourceType,
      source_record_id: doc.sourceRecordId,
      title: doc.title,
      excerpt: doc.excerpt ?? doc.content.slice(0, 400),
      url: doc.url,
      content: doc.content,
      author: doc.author,
      source_timestamp: doc.sourceTimestamp,
      access_scope: doc.accessScope,
      // The CHECK constraint requires an owner for an owner_only document.
      owner_id: doc.accessScope === 'owner_only' ? ownerId : null,
      metadata: doc.metadata as never,
      content_hash: contentHash,
      indexed_at: new Date().toISOString(),
    };

    const { data: saved, error } = existing
      ? await client.from('indexed_documents').update(row).eq('id', existing.id).select('id').single()
      : await client.from('indexed_documents').insert(row).select('id').single();

    if (error || !saved) continue;
    outcome.indexed += 1;

    // Replace chunks wholesale; embeddings cascade from chunk deletion.
    await client.from('document_chunks').delete().eq('document_id', saved.id);

    const pieces = chunkText(`${doc.title}\n\n${doc.content}`);
    if (pieces.length === 0) continue;

    const { data: chunks } = await client
      .from('document_chunks')
      .insert(
        pieces.map((content, index) => ({
          document_id: saved.id,
          chunk_index: index,
          content,
          token_count: Math.ceil(content.length / 4),
        })),
      )
      .select('id, chunk_index');

    if (!chunks || !embeddingsAvailable()) continue;

    const vectors = await embedBatch(pieces).catch(() => null);
    if (!vectors) continue;

    const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
    const rows = ordered.flatMap((chunk, i) => {
      const vector = vectors[i];
      if (!vector) return [];
      return [{
        chunk_id: chunk.id,
        // pgvector accepts the JSON array form over the wire.
        embedding: JSON.stringify(vector) as unknown as string,
        model: 'text-embedding-3-small',
      }];
    });

    if (rows.length > 0) {
      await client.from('document_embeddings').insert(rows);
      outcome.embedded += rows.length;
    }
  }

  return outcome;
}

/**
 * Indexes the workspace's own records so internal search works before any
 * external connector exists. Tasks, projects, comments and notes are all
 * workspace-scoped, matching the RLS on the tables they came from.
 */
export async function indexWorkspaceRecords(
  client: Admin,
  workspaceId: string,
): Promise<IndexOutcome> {
  const [tasks, projects, comments, notes] = await Promise.all([
    client.from('tasks')
      .select('id, title, description, status, priority, due_date, updated_at, projects(name)')
      .eq('workspace_id', workspaceId).limit(2000),
    client.from('projects')
      .select('id, name, description, status, updated_at')
      .eq('workspace_id', workspaceId).limit(500),
    client.from('task_comments')
      .select('id, body, created_at, task_id, tasks!inner(title, workspace_id)')
      .eq('tasks.workspace_id', workspaceId).limit(2000),
    client.from('notes')
      .select('id, title, body, updated_at')
      .eq('workspace_id', workspaceId).limit(500),
  ]);

  const documents: NormalisedDocument[] = [];

  for (const t of tasks.data ?? []) {
    const project = (t.projects as { name: string } | null)?.name;
    documents.push({
      sourceType: 'internal_task' as DocumentSource,
      sourceRecordId: t.id,
      title: t.title,
      excerpt: t.description?.slice(0, 300) ?? null,
      url: `/tasks/${t.id}?workspace=${workspaceId}`,
      content: [
        t.title,
        t.description ?? '',
        `status: ${t.status}`,
        `priority: ${t.priority}`,
        t.due_date ? `due: ${t.due_date}` : '',
        project ? `project: ${project}` : '',
      ].filter(Boolean).join('\n'),
      author: null,
      sourceTimestamp: t.updated_at,
      accessScope: 'workspace',
      metadata: { status: t.status, priority: t.priority },
    });
  }

  for (const p of projects.data ?? []) {
    documents.push({
      sourceType: 'internal_project' as DocumentSource,
      sourceRecordId: p.id,
      title: p.name,
      excerpt: p.description?.slice(0, 300) ?? null,
      url: `/projects/${p.id}?workspace=${workspaceId}`,
      content: [p.name, p.description ?? '', `status: ${p.status}`].filter(Boolean).join('\n'),
      author: null,
      sourceTimestamp: p.updated_at,
      accessScope: 'workspace',
      metadata: { status: p.status },
    });
  }

  for (const c of comments.data ?? []) {
    const task = c.tasks as { title: string } | null;
    documents.push({
      sourceType: 'internal_comment' as DocumentSource,
      sourceRecordId: c.id,
      title: `Comment on ${task?.title ?? 'a task'}`,
      excerpt: c.body.slice(0, 300),
      url: `/tasks/${c.task_id}?workspace=${workspaceId}`,
      content: c.body,
      author: null,
      sourceTimestamp: c.created_at,
      accessScope: 'workspace',
      metadata: {},
    });
  }

  for (const n of notes.data ?? []) {
    documents.push({
      sourceType: 'internal_note' as DocumentSource,
      sourceRecordId: n.id,
      title: n.title,
      excerpt: n.body.slice(0, 300),
      url: `/notes?workspace=${workspaceId}`,
      content: `${n.title}\n\n${n.body}`,
      author: null,
      sourceTimestamp: n.updated_at,
      accessScope: 'workspace',
      metadata: {},
    });
  }

  return indexDocuments(client, workspaceId, null, null, documents);
}

/**
 * Indexes a single internal record immediately, text only.
 *
 * Called from the task, project and note write paths so internal search is
 * fresh the moment something is created or renamed. Deliberately skips
 * chunking and embeddings: those cost a network round trip and belong in the
 * batch pass, so keyword search is immediate and semantic search is
 * eventually consistent.
 *
 * Best-effort by contract. A failure here must never fail the user's write,
 * so callers swallow the error and the next full reindex repairs the gap.
 */
export async function indexOneRecord(
  client: Admin,
  workspaceId: string,
  document: NormalisedDocument,
  ownerId: string | null = null,
): Promise<void> {
  const contentHash = hashContent(document.title, document.content);

  const { data: existing } = await client
    .from('indexed_documents')
    .select('id, content_hash')
    .eq('workspace_id', workspaceId)
    .eq('source_type', document.sourceType)
    .eq('source_record_id', document.sourceRecordId)
    .maybeSingle();

  if (existing?.content_hash === contentHash) return;

  const row = {
    workspace_id: workspaceId,
    integration_id: null,
    source_type: document.sourceType,
    source_record_id: document.sourceRecordId,
    title: document.title,
    excerpt: document.excerpt ?? document.content.slice(0, 400),
    url: document.url,
    content: document.content,
    author: document.author,
    source_timestamp: document.sourceTimestamp,
    access_scope: document.accessScope,
    // An `owner_only` row without an owner is rejected by the table's CHECK,
    // so the scope and the owner have to be set from the same decision.
    owner_id: document.accessScope === 'owner_only' ? ownerId : null,
    metadata: document.metadata as never,
    content_hash: contentHash,
    indexed_at: new Date().toISOString(),
  };

  if (existing) {
    await client.from('indexed_documents').update(row).eq('id', existing.id);
    // The content changed, so any chunks and embeddings now describe stale
    // text. Drop them; the batch pass rebuilds them.
    await client.from('document_chunks').delete().eq('document_id', existing.id);
  } else {
    await client.from('indexed_documents').insert(row);
  }
}

/** Removes an internal record from the index when it is deleted. */
export async function removeFromIndex(
  client: Admin,
  workspaceId: string,
  sourceType: DocumentSource,
  sourceRecordId: string,
): Promise<void> {
  await client
    .from('indexed_documents')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('source_type', sourceType)
    .eq('source_record_id', sourceRecordId);
}

/** Shapes a task row for the index. Shared by the inline and batch paths. */
export function taskDocument(
  workspaceId: string,
  task: {
    id: string; title: string; description: string | null;
    status: string; priority: string; due_date: string | null;
    updated_at?: string | null; projectName?: string | null;
  },
): NormalisedDocument {
  return {
    sourceType: 'internal_task',
    sourceRecordId: task.id,
    title: task.title,
    excerpt: task.description?.slice(0, 300) ?? null,
    url: `/tasks/${task.id}?workspace=${workspaceId}`,
    content: [
      task.title,
      task.description ?? '',
      `status: ${task.status}`,
      `priority: ${task.priority}`,
      task.due_date ? `due: ${task.due_date}` : '',
      task.projectName ? `project: ${task.projectName}` : '',
    ].filter(Boolean).join('\n'),
    author: null,
    sourceTimestamp: task.updated_at ?? new Date().toISOString(),
    accessScope: 'workspace',
    metadata: { status: task.status, priority: task.priority },
  };
}

export function projectDocument(
  workspaceId: string,
  project: {
    id: string; name: string; description: string | null;
    status: string; updated_at?: string | null;
  },
): NormalisedDocument {
  return {
    sourceType: 'internal_project',
    sourceRecordId: project.id,
    title: project.name,
    excerpt: project.description?.slice(0, 300) ?? null,
    url: `/projects/${project.id}?workspace=${workspaceId}`,
    content: [project.name, project.description ?? '', `status: ${project.status}`]
      .filter(Boolean).join('\n'),
    author: null,
    sourceTimestamp: project.updated_at ?? new Date().toISOString(),
    accessScope: 'workspace',
    metadata: { status: project.status },
  };
}

export function noteDocument(
  workspaceId: string,
  note: { id: string; title: string; body: string; updated_at?: string | null },
): NormalisedDocument {
  return {
    sourceType: 'internal_note',
    sourceRecordId: note.id,
    title: note.title,
    excerpt: note.body.slice(0, 300),
    url: `/notes?workspace=${workspaceId}`,
    content: `${note.title}\n\n${note.body}`,
    author: null,
    sourceTimestamp: note.updated_at ?? new Date().toISOString(),
    accessScope: 'workspace',
    metadata: {},
  };
}
