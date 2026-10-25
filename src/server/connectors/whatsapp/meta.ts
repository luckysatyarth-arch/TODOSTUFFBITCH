import { serverEnv } from '@/lib/env';
import type {
  Recipient, SendResult, WhatsAppAdapter, WhatsAppCapabilities,
} from './types';

/**
 * Meta WhatsApp Cloud API.
 *
 * Group sending is declared here because the Groups API exists, but it carries
 * two hard constraints the caller must respect: an Official Business Account,
 * and at most 8 participants including the business number.
 */
export class MetaCloudAdapter implements WhatsAppAdapter {
  readonly provider = 'meta_cloud' as const;

  readonly capabilities: WhatsAppCapabilities = {
    sendDirect: true,
    sendGroup: true,
    groupMaxParticipants: 8,
    requiresOfficialBusinessAccount: true,
    readPersonalInbox: false,
    receiveForwardedMessages: true,
    requiresTemplateOutsideWindow: true,
  };

  isConfigured(): boolean {
    const env = serverEnv();
    return Boolean(env.WHATSAPP_META_ACCESS_TOKEN && env.WHATSAPP_META_PHONE_NUMBER_ID);
  }

  async send(recipient: Recipient, text: string): Promise<SendResult> {
    const env = serverEnv();
    if (!this.isConfigured()) {
      return {
        status: 'failed', providerMessageId: null, providerStatus: null,
        error: 'WHATSAPP_META_ACCESS_TOKEN and WHATSAPP_META_PHONE_NUMBER_ID are required.',
        retryable: false,
      };
    }

    const url =
      `https://graph.facebook.com/${env.WHATSAPP_META_API_VERSION}/` +
      `${env.WHATSAPP_META_PHONE_NUMBER_ID}/messages`;

    const body = recipient.kind === 'direct'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient.to,
          type: 'text',
          text: { preview_url: false, body: text },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'group',
          to: recipient.groupId,
          type: 'text',
          text: { preview_url: false, body: text },
        };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      const payload = (await response.json().catch(() => null)) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number; error_subcode?: number };
      } | null;

      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        return {
          status: 'failed',
          providerMessageId: null,
          providerStatus: String(response.status),
          error: message,
          // 4xx other than 429 means the request itself is wrong; retrying
          // would just repeat the same rejection.
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      const id = payload?.messages?.[0]?.id ?? null;
      if (!id) {
        return {
          status: 'failed', providerMessageId: null, providerStatus: 'no_message_id',
          error: 'Provider accepted the request but returned no message id.',
          retryable: true,
        };
      }

      // 'sent' means accepted by Meta. 'delivered' is only ever set later, by
      // a status webhook, so the application never claims delivery itself.
      return {
        status: 'sent', providerMessageId: id, providerStatus: 'accepted',
        error: null, retryable: false,
      };
    } catch (error) {
      return {
        status: 'failed', providerMessageId: null, providerStatus: null,
        error: error instanceof Error ? error.message : 'Network error.',
        retryable: true,
      };
    }
  }
}
