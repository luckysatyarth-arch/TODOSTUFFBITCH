import OpenAI from 'openai';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';

export class TranscriptionUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'TranscriptionUnavailableError';
  }
}

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string | null;
  language: string | null;
  durationSeconds: number | null;
}

/**
 * Speech-to-text behind a provider interface.
 *
 * Returns null when no provider is configured so the caller can fall back to
 * "paste the transcript yourself" rather than failing. The audio file itself
 * stays in private storage; only a short-lived signed read is used to hand it
 * to the provider.
 */
export async function transcribeAudio(
  file: File | Blob,
  fileName: string,
): Promise<TranscriptionResult | null> {
  const env = serverEnv();
  if (env.TRANSCRIPTION_PROVIDER === 'none' || !env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const upload = file instanceof File
    ? file
    : new File([file], fileName, { type: file.type || 'audio/webm' });

  const response = await client.audio.transcriptions.create({
    file: upload,
    model: env.TRANSCRIPTION_MODEL,
    response_format: 'verbose_json',
  });

  // verbose_json carries language and duration; the typings are loose, so read
  // them defensively rather than asserting a shape.
  const payload = response as unknown as {
    text?: string; language?: string; duration?: number;
  };

  return {
    text: (payload.text ?? '').trim(),
    provider: 'openai',
    model: env.TRANSCRIPTION_MODEL,
    language: payload.language ?? null,
    durationSeconds: typeof payload.duration === 'number' ? payload.duration : null,
  };
}

export interface TranscribeStoredOptions {
  captureId: string;
  storagePath: string;
  /** True when running without a user session (webhook or background job). */
  useAdmin?: boolean;
}

/**
 * Downloads a stored recording, transcribes it, and records both the
 * transcript row and the capture's text.
 */
export async function transcribeStoredAudio(
  options: TranscribeStoredOptions,
): Promise<TranscriptionResult> {
  const supabase = options.useAdmin
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  await supabase.from('captures').update({ status: 'transcribing' }).eq('id', options.captureId);

  try {
    const { data: blob, error } = await supabase.storage
      .from('captures').download(options.storagePath);
    if (error || !blob) {
      throw new Error(error?.message ?? 'Could not read the stored recording.');
    }

    const result = await transcribeAudio(blob, options.storagePath.split('/').pop() ?? 'audio.webm');
    if (!result) {
      throw new TranscriptionUnavailableError(
        'No transcription provider is configured. Set TRANSCRIPTION_PROVIDER and ' +
          'OPENAI_API_KEY, or paste the transcript in manually.',
      );
    }

    await supabase.from('transcripts').upsert({
      capture_id: options.captureId,
      provider: result.provider,
      model: result.model,
      language: result.language,
      text: result.text,
    }, { onConflict: 'capture_id' });

    await supabase.from('captures').update({
      raw_text: result.text,
      duration_seconds: result.durationSeconds,
      status: 'extracting',
      error_message: null,
    }).eq('id', options.captureId);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed.';
    await supabase.from('captures')
      .update({ status: 'failed', error_message: message })
      .eq('id', options.captureId);
    throw error;
  }
}
