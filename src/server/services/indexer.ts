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
