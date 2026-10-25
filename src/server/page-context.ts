import { requireSession, requireWorkspace, type SessionContext, type WorkspaceSummary } from './auth';

export interface PageContext {
  session: SessionContext;
  workspace: WorkspaceSummary;
}

/**
 * Resolves the session and the workspace named in the query string.
 *
 * Every page calls this. The workspace id arrives from the URL, so it is
 * authorized here on every request rather than trusted; requireWorkspace
 * throws for an id the user does not belong to instead of falling back to a
 * different workspace, which would silently show the wrong data.
 */
export async function resolvePageContext(
  searchParams: Promise<Record<string, string | string[] | undefined>>,
): Promise<PageContext & { params: Record<string, string | string[] | undefined> }> {
  const session = await requireSession();
  const params = await searchParams;
  const requested = typeof params.workspace === 'string' ? params.workspace : undefined;
  const workspace = await requireWorkspace(session, requested);
  return { session, workspace, params };
}

/** First value of a possibly-repeated query parameter. */
export function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** All values of a possibly-repeated query parameter, comma-split. */
export function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}
