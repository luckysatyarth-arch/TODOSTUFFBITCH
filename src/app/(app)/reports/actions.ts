'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertCanManage, requireSession, requireWorkspace, AuthorizationError,
} from '@/server/auth';
import { generateReport, deliverReport } from '@/server/services/report-delivery';
import { isoDate, uuid } from '@/lib/validation/common';
import { serverEnv } from '@/lib/env';
import type { ActionResult } from '../actions';

/**
 * Manual preview and resend.
 *
 * Both need the service role, because report rows are written server-side and
 * have no client write policy. Access is gated on the workspace admin role,
 * and a personal report can only ever be previewed by its own subject -- an
 * admin cannot read another member's private summary.
 */
export async function previewReport(
  workspaceId: string,
  scope: 'personal' | 'team',
  date?: string,
): Promise<ActionResult<{ reportId: string; text: string | null; status: string }>> {
  try {
    const wsId = uuid.parse(workspaceId);
    const reportDate = date ? isoDate.parse(date) : undefined;

    const session = await requireSession();
    const workspace = await requireWorkspace(session, wsId);
    if (scope === 'team') assertCanManage(workspace);

    const env = serverEnv();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        ok: false,
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not set. Report generation needs it; see .env.example.',
      };
    }

    const result = await generateReport({
      workspaceId: wsId,
      scope,
      // A personal report is always for the caller, never for someone else.
      subjectUserId: scope === 'personal' ? session.userId : null,
      reportDate,
      client: createSupabaseAdminClient(),
    });

    revalidatePath('/reports');
    return {
      ok: true,
      data: { reportId: result.reportId, text: result.text, status: result.status },
    };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not generate the report.',
    };
  }
}

export async function resendReport(reportId: string): Promise<ActionResult<{
  sent: number; failed: number; unsupported: number; skipped: number;
}>> {
  try {
    const id = uuid.parse(reportId);
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();

    // Read through the user's own client first, so RLS decides whether this
    // report is theirs to see at all before the admin client touches it.
    const { data: report } = await supabase
      .from('daily_reports')
      .select('id, workspace_id, scope, subject_user_id')
      .eq('id', id)
      .maybeSingle();

    if (!report) throw new AuthorizationError('Report not found.');

    const workspace = await requireWorkspace(session, report.workspace_id);
    if (report.scope === 'team') assertCanManage(workspace);
    else if (report.subject_user_id !== session.userId) {
      throw new AuthorizationError('That is not your report.');
    }

    const env = serverEnv();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is required to send reports.' };
    }

    const result = await deliverReport(id, createSupabaseAdminClient());
    revalidatePath('/reports');
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not resend the report.',
    };
  }
}
