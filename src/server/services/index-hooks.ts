import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import {
  indexOneRecord, noteDocument, projectDocument, removeFromIndex, taskDocument,
} from './indexer';
import type { DocumentSource } from '@/server/connectors/types';

/**
 * Fire-and-forget index maintenance for the write paths.
 *
 * Every function here swallows its own errors: a search index that falls
 * behind is a degraded search, but a user's task creation failing because the
 * indexer hiccuped would be a bug. The full reindex repairs any gap.
 *
 * All of these need the service role, because `indexed_documents` has no
 * client write policy -- the index is server-maintained by design, so a client
 * cannot inject a document into someone's search results.
 */

function available(): boolean {
  return Boolean(serverEnv().SUPABASE_SERVICE_ROLE_KEY);
}

export async function onTaskChanged(
  workspaceId: string,
  task: {
    id: string; title: string; description: string | null;
    status: string; priority: string; due_date: string | null;
    projectName?: string | null;
  },
): Promise<void> {
  if (!available()) return;
  try {
    await indexOneRecord(
      createSupabaseAdminClient(), workspaceId, taskDocument(workspaceId, task),
    );
  } catch (error) {
    console.warn('[index] task indexing failed:', error instanceof Error ? error.message : error);
  }
}

export async function onProjectChanged(
  workspaceId: string,
  project: { id: string; name: string; description: string | null; status: string },
): Promise<void> {
  if (!available()) return;
  try {
    await indexOneRecord(
      createSupabaseAdminClient(), workspaceId, projectDocument(workspaceId, project),
    );
  } catch (error) {
    console.warn('[index] project indexing failed:', error instanceof Error ? error.message : error);
  }
}

export async function onNoteChanged(
  workspaceId: string,
  note: { id: string; title: string; body: string },
): Promise<void> {
  if (!available()) return;
  try {
    await indexOneRecord(
      createSupabaseAdminClient(), workspaceId, noteDocument(workspaceId, note),
    );
  } catch (error) {
    console.warn('[index] note indexing failed:', error instanceof Error ? error.message : error);
  }
}

export async function onRecordDeleted(
  workspaceId: string,
  sourceType: DocumentSource,
  sourceRecordId: string,
): Promise<void> {
  if (!available()) return;
  try {
    await removeFromIndex(createSupabaseAdminClient(), workspaceId, sourceType, sourceRecordId);
  } catch (error) {
    console.warn('[index] removal failed:', error instanceof Error ? error.message : error);
  }
}
