import type { Database } from '@/lib/supabase/database.types';

export type Provider = Database['public']['Enums']['integration_provider'];
export type DocumentSource = Database['public']['Enums']['document_source'];
export type AccessScope = Database['public']['Enums']['access_scope'];

/**
 * What a connector can do, declared rather than assumed.
 *
 * The integrations screen renders from this, so a capability a provider does
 * not have is never shown as working. `notes` carries the honest caveats --
 * API limitations, permission scenarios that cannot be supported -- which the
 * brief requires be made explicit rather than glossed over.
 */
export interface ConnectorCapabilities {
  search: boolean;
  incrementalSync: boolean;
  /** Can return a deep link back to the record in the source system. */
  deepLinks: boolean;
  /** Content is indexed, not just metadata. */
  fullContent: boolean;
  /** Inbound capture into the approval inbox. */
  capture: boolean;
  notes: string[];
}

/** The normalised shape every source is reduced to before indexing. */
export interface NormalisedDocument {
  sourceType: DocumentSource;
  /** Stable id in the source system. Paired with sourceType for dedup. */
  sourceRecordId: string;
  title: string;
  excerpt: string | null;
  url: string | null;
  content: string;
  author: string | null;
  sourceTimestamp: string | null;
  /**
   * 'owner_only' keeps a document out of every other member's results, which
   * is how one person's mail or private file cannot leak into a team answer.
   */
  accessScope: AccessScope;
  metadata: Record<string, unknown>;
}

export interface SyncContext {
  integrationId: string;
  workspaceId: string;
  ownerId: string | null;
  /** Provider delta token from the previous run, when supported. */
  cursor: string | null;
  accessToken: string | null;
  limit: number;
}

export interface SyncOutcome {
  documents: NormalisedDocument[];
  cursor: string | null;
  /** True when the provider has more pages waiting. */
  hasMore: boolean;
}

export interface Connector {
  readonly provider: Provider;
  readonly label: string;
  readonly capabilities: ConnectorCapabilities;
  /** Whether the deployment has the client credentials this provider needs. */
  isConfigured(): boolean;
  /** OAuth entry point, or null for a connector that is not OAuth-based. */
  authorizationUrl(state: string, redirectUri: string): string | null;
  /** Required scopes, shown on the integrations screen before connecting. */
  scopes(): string[];
  sync(context: SyncContext): Promise<SyncOutcome>;
}

/**
 * Raised when a connector is asked to do real work without credentials.
 * Callers record it against the integration rather than failing a page render.
 */
export class ConnectorNotConfiguredError extends Error {
  constructor(public provider: Provider, detail: string) {
    super(detail);
    this.name = 'ConnectorNotConfiguredError';
  }
}

export class ConnectorNotImplementedError extends Error {
  constructor(public provider: Provider, detail: string) {
    super(detail);
    this.name = 'ConnectorNotImplementedError';
  }
}
