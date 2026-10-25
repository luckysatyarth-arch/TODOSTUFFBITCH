/**
 * WhatsApp delivery behind a capability descriptor.
 *
 * See docs/RESEARCH-WHATSAPP.md. Two facts drive this design:
 *
 *  - No official API can read a personal account's inbox, so capture is
 *    forwarding-based and `readPersonalInbox` is false everywhere.
 *  - Meta's Cloud API *can* send into a group, but only for an Official
 *    Business Account and only up to 8 participants including the sender.
 *    Twilio cannot do it at all.
 *
 * Because the group limits were corroborated rather than verified against
 * Meta's own documentation (the host is blocked in this build environment),
 * nothing branches on a provider name. Callers read the descriptor, so when
 * the facts are confirmed or change, only the adapter changes.
 */
export interface WhatsAppCapabilities {
  sendDirect: boolean;
  sendGroup: boolean;
  /** Null when groups are unsupported. 8 for Meta, per the research note. */
  groupMaxParticipants: number | null;
  /** Requires a verified Official Business Account display name. */
  requiresOfficialBusinessAccount: boolean;
  /** No official provider offers this. Kept explicit so the UI can say so. */
  readPersonalInbox: boolean;
  /** Inbound messages forwarded to the business number become captures. */
  receiveForwardedMessages: boolean;
  /** Business-initiated sends outside a 24h window need an approved template. */
  requiresTemplateOutsideWindow: boolean;
}

export type Recipient =
  | { kind: 'direct'; to: string }
  | { kind: 'group'; groupId: string };

export interface SendResult {
  /** 'sent' only once the provider returns an id. Never assumed. */
  status: 'sent' | 'unsupported' | 'failed';
  providerMessageId: string | null;
  providerStatus: string | null;
  error: string | null;
  /** True when a retry could plausibly succeed (timeout, 5xx, rate limit). */
  retryable: boolean;
}

export interface WhatsAppAdapter {
  readonly provider: 'meta_cloud' | 'twilio' | 'dry_run';
  readonly capabilities: WhatsAppCapabilities;
  /** False when credentials are missing; the UI then shows 'requires_setup'. */
  isConfigured(): boolean;
  send(recipient: Recipient, text: string): Promise<SendResult>;
}

export class WhatsAppNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `The WhatsApp provider '${provider}' is selected but not configured. ` +
        'See .env.example and docs/INTEGRATIONS.md.',
    );
    this.name = 'WhatsAppNotConfiguredError';
  }
}
