import { serverEnv } from '@/lib/env';
import { MetaCloudAdapter } from './meta';
import { TwilioAdapter } from './twilio';
import { DryRunAdapter } from './dry-run';
import type { WhatsAppAdapter } from './types';

export * from './types';

/** The adapter selected by WHATSAPP_PROVIDER. */
export function getWhatsAppAdapter(): WhatsAppAdapter {
  const env = serverEnv();
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta_cloud': return new MetaCloudAdapter();
    case 'twilio': return new TwilioAdapter();
    default: return new DryRunAdapter();
  }
}

/** Every adapter, for the integrations screen's capability matrix. */
export function allWhatsAppAdapters(): WhatsAppAdapter[] {
  return [new MetaCloudAdapter(), new TwilioAdapter(), new DryRunAdapter()];
}
