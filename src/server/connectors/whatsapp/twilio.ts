import { serverEnv } from '@/lib/env';
import type {
  Recipient, SendResult, WhatsAppAdapter, WhatsAppCapabilities,
} from './types';

/**
 * Twilio WhatsApp.
 *
 * Direct sends only: Twilio exposes no WhatsApp group sending, so sendGroup is
 * false and a group request returns 'unsupported' rather than being quietly
 * redirected somewhere else.
 *
 * Uses the REST endpoint over fetch rather than the twilio SDK so this stays
 * usable on an edge runtime and adds no required dependency.
 */
export class TwilioAdapter implements WhatsAppAdapter {
  readonly provider = 'twilio' as const;

  readonly capabilities: WhatsAppCapabilities = {
    sendDirect: true,
    sendGroup: false,
    groupMaxParticipants: null,
    requiresOfficialBusinessAccount: false,
    readPersonalInbox: false,
    receiveForwardedMessages: true,
    requiresTemplateOutsideWindow: true,
  };

  isConfigured(): boolean {
    const env = serverEnv();
    return Boolean(
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM,
    );
  }

  async send(recipient: Recipient, text: string): Promise<SendResult> {
    const env = serverEnv();

    if (recipient.kind === 'group') {
      return {
        status: 'unsupported',
        providerMessageId: null,
        providerStatus: null,
        error: 'Twilio does not support sending to WhatsApp groups.',
        retryable: false,
      };
    }

    if (!this.isConfigured()) {
      return {
        status: 'failed', providerMessageId: null, providerStatus: null,
        error: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM are required.',
        retryable: false,
      };
    }

    const to = recipient.to.startsWith('whatsapp:') ? recipient.to : `whatsapp:${recipient.to}`;
    const form = new URLSearchParams({
      From: env.TWILIO_WHATSAPP_FROM!,
      To: to,
      Body: text,
    });

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization:
              'Basic ' +
              Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(20_000),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        sid?: string; status?: string; message?: string;
      } | null;

      if (!response.ok || !payload?.sid) {
        return {
          status: 'failed',
          providerMessageId: null,
          providerStatus: payload?.status ?? String(response.status),
          error: payload?.message ?? `HTTP ${response.status}`,
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      return {
        status: 'sent',
        providerMessageId: payload.sid,
        providerStatus: payload.status ?? 'queued',
        error: null,
        retryable: false,
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
