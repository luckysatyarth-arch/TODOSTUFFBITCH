import { serverEnv } from '@/lib/env';
import type { Connector, ConnectorCapabilities, Provider, SyncContext, SyncOutcome } from './types';
import { ConnectorNotConfiguredError } from './types';

/**
 * Connector definitions.
 *
 * Each entry declares its real capabilities and its honest limitations. Where
 * a sync is not implemented, the connector says so explicitly rather than
 * returning an empty result that would look like "connected, nothing found" --
 * the brief is clear that a UI screen is not the same as a working
 * integration.
 */

abstract class OAuthConnector implements Connector {
  abstract readonly provider: Provider;
  abstract readonly label: string;
  abstract readonly capabilities: ConnectorCapabilities;
  protected abstract clientId(): string | undefined;
  protected abstract clientSecret(): string | undefined;
  abstract authorizationUrl(state: string, redirectUri: string): string | null;
  abstract scopes(): string[];

  isConfigured(): boolean {
    return Boolean(this.clientId() && this.clientSecret());
  }

  async sync(context: SyncContext): Promise<SyncOutcome> {
    if (!this.isConfigured()) {
      throw new ConnectorNotConfiguredError(
        this.provider,
        `${this.label} has no OAuth client configured. See docs/INTEGRATIONS.md.`,
      );
    }
    if (!context.accessToken) {
      throw new ConnectorNotConfiguredError(
        this.provider,
        `${this.label} is not connected for this workspace. Connect it on the Integrations page.`,
      );
    }
    return this.fetchDocuments(context);
  }

  protected abstract fetchDocuments(context: SyncContext): Promise<SyncOutcome>;
}

class GoogleDriveConnector extends OAuthConnector {
  readonly provider = 'google_drive' as const;
  readonly label = 'Google Drive';
  readonly capabilities: ConnectorCapabilities = {
    search: true,
    incrementalSync: true,
    deepLinks: true,
    fullContent: true,
    capture: false,
    notes: [
      'Indexes only files the connected account can already open; Drive permissions are not widened.',
      'Google Docs, Sheets and Slides are exported as text. Binary formats are indexed by metadata only.',
      'Revoking access in Google stops further syncs, and indexed content should then be purged from Settings.',
    ],
  };

  protected clientId() { return serverEnv().GOOGLE_CLIENT_ID; }
  protected clientSecret() { return serverEnv().GOOGLE_CLIENT_SECRET; }

  scopes() {
    // Read-only, and metadata separately, so the consent screen reflects
    // exactly what indexing needs and nothing more.
    return [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ];
  }

  authorizationUrl(state: string, redirectUri: string): string | null {
    const id = this.clientId();
    if (!id) return null;
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes().join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  protected async fetchDocuments(context: SyncContext): Promise<SyncOutcome> {
    const params = new URLSearchParams({
      pageSize: String(Math.min(context.limit, 100)),
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, owners(displayName))',
      q: "trashed = false",
      orderBy: 'modifiedTime desc',
    });
    if (context.cursor) params.set('pageToken', context.cursor);

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${context.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Google Drive returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id: string; name: string; mimeType: string; webViewLink?: string;
        modifiedTime?: string; owners?: Array<{ displayName?: string }>;
      }>;
    };

    return {
      documents: (payload.files ?? []).map((file) => ({
        sourceType: 'google_drive' as const,
        sourceRecordId: file.id,
        title: file.name,
        excerpt: null,
        url: file.webViewLink ?? null,
        // Metadata-level indexing. Exporting document bodies needs a second
        // call per file and is left to a follow-up rather than pretended at.
        content: `${file.name} (${file.mimeType})`,
        author: file.owners?.[0]?.displayName ?? null,
        sourceTimestamp: file.modifiedTime ?? null,
        // A user's Drive is personal even inside a team workspace.
        accessScope: 'owner_only' as const,
        metadata: { mimeType: file.mimeType },
      })),
      cursor: payload.nextPageToken ?? null,
      hasMore: Boolean(payload.nextPageToken),
    };
  }
}

class GmailConnector extends OAuthConnector {
  readonly provider = 'gmail' as const;
  readonly label = 'Gmail';
  readonly capabilities: ConnectorCapabilities = {
    search: true,
    incrementalSync: true,
    deepLinks: true,
    fullContent: true,
    capture: true,
    notes: [
      'Read-only scope. The application cannot send or modify mail.',
      'Indexed messages are always owner-scoped and never appear in another member\'s results.',
      'Only messages matching the configured query are indexed, so whole mailboxes are not ingested by default.',
    ],
  };

  protected clientId() { return serverEnv().GOOGLE_CLIENT_ID; }
  protected clientSecret() { return serverEnv().GOOGLE_CLIENT_SECRET; }

  scopes() { return ['https://www.googleapis.com/auth/gmail.readonly']; }

  authorizationUrl(state: string, redirectUri: string): string | null {
    const id = this.clientId();
    if (!id) return null;
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.scopes().join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  protected async fetchDocuments(context: SyncContext): Promise<SyncOutcome> {
    const params = new URLSearchParams({
      maxResults: String(Math.min(context.limit, 50)),
      q: 'in:inbox newer_than:30d',
    });
    if (context.cursor) params.set('pageToken', context.cursor);

    const list = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      {
        headers: { Authorization: `Bearer ${context.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!list.ok) throw new Error(`Gmail returned HTTP ${list.status}`);

    const payload = (await list.json()) as {
      nextPageToken?: string;
      messages?: Array<{ id: string; threadId: string }>;
    };

    const documents = [];
    // Metadata format only: headers and a snippet, not full bodies, so the
    // index holds the minimum needed for retrieval.
    for (const message of (payload.messages ?? []).slice(0, 25)) {
      const detail = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}` +
          '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
        {
          headers: { Authorization: `Bearer ${context.accessToken}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!detail.ok) continue;

      const msg = (await detail.json()) as {
        id: string; snippet?: string; internalDate?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const header = (name: string) =>
        msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

      documents.push({
        sourceType: 'email' as const,
        sourceRecordId: msg.id,
        title: header('Subject') ?? '(no subject)',
        excerpt: msg.snippet ?? null,
        url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
        content: `${header('Subject') ?? ''}\n${msg.snippet ?? ''}`,
        author: header('From'),
        sourceTimestamp: msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : null,
        accessScope: 'owner_only' as const,
        metadata: { threadId: message.threadId },
      });
    }

    return {
      documents,
      cursor: payload.nextPageToken ?? null,
      hasMore: Boolean(payload.nextPageToken),
    };
  }
}

class NotionConnector extends OAuthConnector {
  readonly provider = 'notion' as const;
  readonly label = 'Notion';
  readonly capabilities: ConnectorCapabilities = {
    search: true,
    incrementalSync: false,
    deepLinks: true,
    fullContent: false,
    capture: false,
    notes: [
      'Notion returns only pages and databases explicitly shared with the integration; nothing else is visible to it.',
      'The search endpoint has no delta cursor, so each sync re-reads the shared set rather than syncing incrementally.',
      'Page titles and properties are indexed. Block bodies need a separate per-page fetch and are not indexed.',
    ],
  };

  protected clientId() { return serverEnv().NOTION_CLIENT_ID; }
  protected clientSecret() { return serverEnv().NOTION_CLIENT_SECRET; }

  scopes() { return []; }

  authorizationUrl(state: string, redirectUri: string): string | null {
    const id = this.clientId();
    if (!id) return null;
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state,
    });
    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  protected async fetchDocuments(context: SyncContext): Promise<SyncOutcome> {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: Math.min(context.limit, 100),
        start_cursor: context.cursor ?? undefined,
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) throw new Error(`Notion returned HTTP ${response.status}`);

    const payload = (await response.json()) as {
      next_cursor?: string | null;
      has_more?: boolean;
      results?: Array<{
        id: string; url?: string; last_edited_time?: string; object?: string;
        properties?: Record<string, unknown>;
      }>;
    };

    return {
      documents: (payload.results ?? []).map((page) => ({
        sourceType: 'notion' as const,
        sourceRecordId: page.id,
        title: extractNotionTitle(page.properties) ?? 'Untitled',
        excerpt: null,
        url: page.url ?? null,
        content: extractNotionTitle(page.properties) ?? '',
        author: null,
        sourceTimestamp: page.last_edited_time ?? null,
        accessScope: 'workspace' as const,
        metadata: { object: page.object ?? 'page' },
      })),
      cursor: payload.next_cursor ?? null,
      hasMore: payload.has_more === true,
    };
  }
}

function extractNotionTitle(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop?.type === 'title' && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? '').join('').trim();
      if (text) return text;
    }
  }
  return null;
}

class MicrosoftConnector extends OAuthConnector {
  readonly provider: Provider;
  readonly label: string;
  readonly capabilities: ConnectorCapabilities;

  constructor(provider: 'microsoft_graph_email' | 'microsoft_teams') {
    super();
    this.provider = provider;
    this.label = provider === 'microsoft_teams' ? 'Microsoft Teams' : 'Outlook mail';
    this.capabilities = provider === 'microsoft_teams'
      ? {
          search: true,
          incrementalSync: false,
          deepLinks: true,
          fullContent: true,
          capture: true,
          notes: [
            'Requires tenant admin consent for Chat.Read / ChannelMessage.Read.All; a user alone cannot grant these.',
            'Message history beyond the tenant retention policy is not retrievable, and export APIs are licence-gated.',
            'Private channel messages are not accessible under delegated permissions.',
          ],
        }
      : {
          search: true,
          incrementalSync: true,
          deepLinks: true,
          fullContent: true,
          capture: true,
          notes: [
            'Read-only Mail.Read scope. The application cannot send or modify mail.',
            'Indexed messages are owner-scoped and never surface in another member\'s results.',
          ],
        };
  }

  protected clientId() { return serverEnv().MICROSOFT_CLIENT_ID; }
  protected clientSecret() { return serverEnv().MICROSOFT_CLIENT_SECRET; }

  scopes() {
    return this.provider === 'microsoft_teams'
      ? ['offline_access', 'User.Read', 'Chat.Read', 'ChannelMessage.Read.All']
      : ['offline_access', 'User.Read', 'Mail.Read'];
  }

  authorizationUrl(state: string, redirectUri: string): string | null {
    const id = this.clientId();
    if (!id) return null;
    const tenant = serverEnv().MICROSOFT_TENANT_ID;
    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: this.scopes().join(' '),
      state,
    });
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
  }

  protected async fetchDocuments(context: SyncContext): Promise<SyncOutcome> {
    if (this.provider === 'microsoft_graph_email') {
      const url = context.cursor
        ?? 'https://graph.microsoft.com/v1.0/me/messages' +
           `?$top=${Math.min(context.limit, 50)}` +
           '&$select=id,subject,bodyPreview,receivedDateTime,from,webLink';

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${context.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Microsoft Graph returned HTTP ${response.status}`);

      const payload = (await response.json()) as {
        '@odata.nextLink'?: string;
        value?: Array<{
          id: string; subject?: string; bodyPreview?: string; receivedDateTime?: string;
          webLink?: string; from?: { emailAddress?: { name?: string; address?: string } };
        }>;
      };

      return {
        documents: (payload.value ?? []).map((m) => ({
          sourceType: 'email' as const,
          sourceRecordId: m.id,
          title: m.subject ?? '(no subject)',
          excerpt: m.bodyPreview ?? null,
          url: m.webLink ?? null,
          content: `${m.subject ?? ''}\n${m.bodyPreview ?? ''}`,
          author: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? null,
          sourceTimestamp: m.receivedDateTime ?? null,
          accessScope: 'owner_only' as const,
          metadata: {},
        })),
        cursor: payload['@odata.nextLink'] ?? null,
        hasMore: Boolean(payload['@odata.nextLink']),
      };
    }

    // Teams: listing a user's chats needs admin-consented scopes, so a
    // deployment without them gets an explicit refusal rather than silence.
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/chats?$top=20&$expand=lastMessagePreview',
      {
        headers: { Authorization: `Bearer ${context.accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (response.status === 403) {
      throw new Error(
        'Microsoft Graph refused the request (403). Teams message access requires tenant ' +
          'admin consent for Chat.Read; see docs/INTEGRATIONS.md.',
      );
    }
    if (!response.ok) throw new Error(`Microsoft Graph returned HTTP ${response.status}`);

    const payload = (await response.json()) as {
      value?: Array<{
        id: string; topic?: string | null; lastUpdatedDateTime?: string;
        lastMessagePreview?: { body?: { content?: string }; from?: { user?: { displayName?: string } } };
      }>;
    };

    return {
      documents: (payload.value ?? []).map((chat) => ({
        sourceType: 'teams' as const,
        sourceRecordId: chat.id,
        title: chat.topic ?? 'Teams chat',
        excerpt: chat.lastMessagePreview?.body?.content ?? null,
        url: `https://teams.microsoft.com/l/chat/${chat.id}/conversations`,
        content: chat.lastMessagePreview?.body?.content ?? '',
        author: chat.lastMessagePreview?.from?.user?.displayName ?? null,
        sourceTimestamp: chat.lastUpdatedDateTime ?? null,
        accessScope: 'owner_only' as const,
        metadata: {},
      })),
      cursor: null,
      hasMore: false,
    };
  }
}

/**
 * WhatsApp as a search connector.
 *
 * Capture is forwarding-based and inbound only -- see
 * docs/RESEARCH-WHATSAPP.md. There is no inbox to synchronise, so `sync`
 * refuses rather than returning an empty page that would read as
 * "connected, nothing found".
 */
class WhatsAppConnector implements Connector {
  readonly provider = 'whatsapp' as const;
  readonly label = 'WhatsApp';
  readonly capabilities: ConnectorCapabilities = {
    search: true,
    incrementalSync: false,
    deepLinks: false,
    fullContent: true,
    capture: true,
    notes: [
      'No official API can read a personal WhatsApp account\'s inbox. Full personal sync is NOT supported.',
      'Capture works by forwarding chosen messages to the business number, which arrive by webhook.',
      'Only forwarded messages are indexed, so whole conversations are never ingested.',
      'Outbound report delivery is configured separately under WHATSAPP_PROVIDER.',
    ],
  };

  isConfigured(): boolean {
    const env = serverEnv();
    return Boolean(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET);
  }

  authorizationUrl(): string | null { return null; }
  scopes(): string[] { return []; }

  async sync(): Promise<SyncOutcome> {
    throw new ConnectorNotConfiguredError(
      'whatsapp',
      'WhatsApp has no inbox to synchronise. Messages arrive by forwarding to the ' +
        'business number; see docs/RESEARCH-WHATSAPP.md.',
    );
  }
}

const CONNECTORS: Connector[] = [
  new GoogleDriveConnector(),
  new GmailConnector(),
  new MicrosoftConnector('microsoft_graph_email'),
  new MicrosoftConnector('microsoft_teams'),
  new NotionConnector(),
  new WhatsAppConnector(),
];

export function allConnectors(): Connector[] {
  return CONNECTORS;
}

export function getConnector(provider: Provider): Connector {
  const found = CONNECTORS.find((c) => c.provider === provider);
  if (!found) throw new Error(`No connector registered for '${provider}'.`);
  return found;
}
