import type {
  Recipient, SendResult, WhatsAppAdapter, WhatsAppCapabilities,
} from './types';

/**
 * Records a fully-formed delivery without contacting any provider.
 *
 * This is how the whole reporting pipeline -- generation, idempotency,
 * retries, delivery records, the admin view -- is exercised and tested with no
 * credentials. It is deliberately explicit about what it is: the delivery row
 * carries provider 'dry_run', so a dry-run send can never be mistaken in the
 * UI for a real one.
 */
export class DryRunAdapter implements WhatsAppAdapter {
  readonly provider = 'dry_run' as const;

  readonly capabilities: WhatsAppCapabilities = {
    sendDirect: true,
    sendGroup: true,
    groupMaxParticipants: null,
    requiresOfficialBusinessAccount: false,
    readPersonalInbox: false,
    receiveForwardedMessages: true,
    requiresTemplateOutsideWindow: false,
  };

  isConfigured(): boolean {
    return true;
  }

  async send(recipient: Recipient, text: string): Promise<SendResult> {
    const target = recipient.kind === 'direct' ? recipient.to : `group:${recipient.groupId}`;
    // Visible in logs so a developer can read exactly what would have gone out.
    console.info(
      `[whatsapp:dry_run] would send ${text.length} characters to ${target}`,
    );
    return {
      status: 'sent',
      providerMessageId: `dryrun-${crypto.randomUUID()}`,
      providerStatus: 'dry_run',
      error: null,
      retryable: false,
    };
  }
}
