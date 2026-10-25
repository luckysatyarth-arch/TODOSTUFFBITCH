import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { runExtractionForCapture } from '@/server/services/capture';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Inbound WhatsApp webhook.
 *
 * This is the capture path the research settled on: a user forwards the
 * specific messages they want captured to the business number, and they
 * arrive here. There is no inbox synchronisation, because no official API
 * offers one -- see docs/RESEARCH-WHATSAPP.md.
 *
 * Two safety properties matter here:
 *
 *  - The payload is signature-verified before anything is read, so a forged
 *    request cannot inject a capture.
 *  - The sender's number is matched against a profile. A message from an
 *    unrecognised number is discarded rather than attributed to someone,
 *    because a capture carries an owner and that owner decides what becomes
 *    a task.
 */

/** Meta's subscription handshake. */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  const params = request.nextUrl.searchParams;

  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json(
      { error: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured.' },
      { status: 503 },
    );
  }

  if (mode === 'subscribe' && token && challenge) {
    const a = Buffer.from(token);
    const b = Buffer.from(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // Meta expects the raw challenge echoed back as plain text.
      return new NextResponse(challenge, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const env = serverEnv();

  if (!env.WHATSAPP_APP_SECRET) {
    return NextResponse.json(
      { error: 'WHATSAPP_APP_SECRET is not configured; refusing unverified payloads.' },
      { status: 503 },
    );
  }

  // The raw body is needed for the signature, so it is read as text first.
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifySignature(raw, signature, env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(raw) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const client = createSupabaseAdminClient();
  const results = { captured: 0, ignored: 0, duplicates: 0, statusUpdates: 0 };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Delivery receipts for reports we sent. This is the only thing that may
      // promote a delivery to 'delivered' -- the application never assumes it.
      for (const status of value?.statuses ?? []) {
        if (!status.id) continue;
        const mapped =
          status.status === 'read' ? 'read'
            : status.status === 'delivered' ? 'delivered'
              : status.status === 'failed' ? 'failed' : null;
        if (!mapped) continue;

        await client
          .from('report_deliveries')
          .update({
            status: mapped,
            provider_status: status.status,
            error: status.errors?.[0]?.title ?? null,
          })
          .eq('provider_message_id', status.id);
        results.statusUpdates += 1;
      }

      for (const message of value?.messages ?? []) {
        const text = extractText(message);
        if (!text || !message.from || !message.id) {
          results.ignored += 1;
          continue;
        }

        // Numbers arrive without a leading '+'; profiles store E.164.
        const e164 = message.from.startsWith('+') ? message.from : `+${message.from}`;
        const { data: profile } = await client
          .from('profiles')
          .select('id')
          .eq('personal_whatsapp_e164', e164)
          .maybeSingle();

        if (!profile) {
          // Unknown sender: nothing is stored. Attributing the message to a
          // guessed owner would put someone else's words in their inbox.
          results.ignored += 1;
          continue;
        }

        // Captures land in the owner's personal workspace, which is the
        // private default; they can approve into a team workspace from there.
        const { data: workspace } = await client
          .from('workspaces')
          .select('id')
          .eq('owner_id', profile.id)
          .eq('kind', 'personal')
          .maybeSingle();

        if (!workspace) {
          results.ignored += 1;
          continue;
        }

        const { data: capture, error } = await client
          .from('captures')
          .insert({
            workspace_id: workspace.id,
            owner_id: profile.id,
            kind: 'whatsapp',
            status: 'extracting',
            title: 'Forwarded WhatsApp message',
            raw_text: text,
            source_provider: 'whatsapp',
            // The unique index on (provider, external id) makes a redelivered
            // webhook a no-op rather than a second capture.
            source_external_id: message.id,
            source_metadata: { from: e164, timestamp: message.timestamp ?? null },
          })
          .select('id')
          .single();

        if (error) {
          // 23505 is unique_violation: Meta retried a delivery we already have.
          if (error.code === '23505') results.duplicates += 1;
          else results.ignored += 1;
          continue;
        }

        results.captured += 1;
        // Extraction failing must not make the webhook look unhealthy to
        // Meta, which would trigger more retries.
        await runExtractionForCapture({ captureId: capture.id, client }).catch(() => undefined);
      }
    }
  }

  // Always 200 once the signature is valid, so a provider retry storm is not
  // triggered by our own processing errors.
  return NextResponse.json({ ok: true, ...results });
}

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const provided = header.slice(7);
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function extractText(message: MetaMessage): string | null {
  if (message.text?.body) return message.text.body.trim() || null;
  // A forwarded message often arrives as a caption on media.
  if (message.image?.caption) return message.image.caption.trim() || null;
  if (message.document?.caption) return message.document.caption.trim() || null;
  if (message.video?.caption) return message.video.caption.trim() || null;
  return null;
}

interface MetaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string };
  video?: { caption?: string };
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: MetaMessage[];
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ title?: string }>;
        }>;
      };
    }>;
  }>;
}
