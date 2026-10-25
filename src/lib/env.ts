import { z } from 'zod';

/**
 * Environment is split into three tiers so the application can start, and be
 * honest about what it can do, without every credential present.
 *
 *  - `core`      must exist or the app cannot run at all.
 *  - `server`    server-only secrets; absence disables a specific feature.
 *  - feature flags below report what is actually available, so the UI can say
 *    "needs setup" instead of failing at the moment of use.
 */

const coreSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  REPORT_TIMEZONE: z.string().default('Asia/Kolkata'),

  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  OPENAI_API_KEY: z.string().min(10).optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1'),

  EMBEDDING_PROVIDER: z.enum(['openai', 'none']).default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  TRANSCRIPTION_PROVIDER: z.enum(['openai', 'none']).default('openai'),
  TRANSCRIPTION_MODEL: z.string().default('whisper-1'),

  // 32 bytes of hex. Validated here rather than at first use so a malformed
  // key is a startup error, not a failed OAuth callback.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)')
    .optional(),

  WHATSAPP_PROVIDER: z.enum(['meta_cloud', 'twilio', 'dry_run']).default('dry_run'),
  WHATSAPP_META_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_META_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_META_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_META_API_VERSION: z.string().default('v23.0'),
  WHATSAPP_META_TEMPLATE_NAME: z.string().default('daily_report'),
  WHATSAPP_META_TEMPLATE_LANGUAGE: z.string().default('en'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default('common'),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
});


/**
 * Drops keys whose value is blank.
 *
 * A `.env` file written from `.env.example` carries every optional key as an
 * empty string. An empty string is *present*, so `.optional()` does not apply
 * to it and a `min()` check fails -- which would turn "I left the optional AI
 * key blank" into a 500 on every server route. Operationally an unset
 * variable and a blank one mean the same thing, so they are normalised here
 * before validation.
 */
export function withoutBlanks(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

function readCore() {
  const env = withoutBlanks(process.env);
  const parsed = coreSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Supabase configuration is missing or invalid:\n${detail}\n\n` +
        'Copy .env.example to .env.local and fill in the REQUIRED section.',
    );
  }
  return parsed.data;
}

export const publicEnv = readCore();

/**
 * Server-only configuration. Reading this from a Client Component would leak
 * secrets into the bundle, so it throws if called in the browser.
 */
export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() must not be called in client code');
  }
  const parsed = serverSchema.safeParse(withoutBlanks(process.env));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${detail}`);
  }
  return parsed.data;
}

export type ServerEnv = ReturnType<typeof serverEnv>;

/**
 * What this deployment can actually do. Every surface that depends on a
 * credential checks here first and renders a "needs configuration" state
 * rather than throwing, which is what keeps unconfigured integrations from
 * appearing to work.
 */
export function capabilities(env: ServerEnv = serverEnv()) {
  const aiKey =
    env.AI_PROVIDER === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;

  return {
    serviceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    ai: Boolean(aiKey),
    embeddings: env.EMBEDDING_PROVIDER !== 'none' && Boolean(env.OPENAI_API_KEY),
    transcription: env.TRANSCRIPTION_PROVIDER !== 'none' && Boolean(env.OPENAI_API_KEY),
    credentialEncryption: Boolean(env.CREDENTIALS_ENCRYPTION_KEY),
    cron: Boolean(env.CRON_SECRET),
    whatsapp:
      env.WHATSAPP_PROVIDER === 'dry_run'
        ? ('dry_run' as const)
        : env.WHATSAPP_PROVIDER === 'meta_cloud'
          ? Boolean(env.WHATSAPP_META_ACCESS_TOKEN && env.WHATSAPP_META_PHONE_NUMBER_ID)
          : Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
    notion: Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET),
  };
}

export type Capabilities = ReturnType<typeof capabilities>;
