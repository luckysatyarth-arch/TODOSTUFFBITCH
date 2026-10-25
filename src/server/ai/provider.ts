import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { z } from 'zod';
import { serverEnv } from '@/lib/env';

/**
 * One narrow interface over the model providers. Everything the application
 * asks of a model is "here is a system prompt, a user message and a Zod
 * schema; return matching JSON", so that is the whole surface.
 *
 * The schema is a Zod schema rather than raw JSON Schema because both
 * providers then validate for us -- Anthropic via `messages.parse` with
 * `zodOutputFormat`, OpenAI via a JSON Schema derived from the same source --
 * and callers get a typed result without a second parse step.
 *
 * Note on API shape: structured output here uses `output_config.format`, not a
 * forced `tool_choice`. Current Claude models reject
 * `tool_choice: {type: 'tool'}` with a 400, and `temperature` is rejected on
 * every model, so neither appears below.
 */
export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  user: string;
  schema: T;
  schemaName: string;
  maxTokens?: number;
  /** Thinking depth / token spend. Extraction does well at 'low'. */
  effort?: 'low' | 'medium' | 'high';
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export class AiUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AiUnavailableError';
  }
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>>;
  text(req: TextRequest): Promise<string>;
}

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16_000,
      system: req.system,
      output_config: {
        effort: req.effort ?? 'low',
        format: zodOutputFormat(req.schema),
      },
      messages: [{ role: 'user', content: req.user }],
    });

    // A safety decline arrives as HTTP 200 with stop_reason 'refusal', so it
    // has to be checked before the content is read.
    if (response.stop_reason === 'refusal') {
      throw new AiUnavailableError(
        `The model declined this request${
          response.stop_details && 'category' in response.stop_details
            ? ` (${String(response.stop_details.category)})`
            : ''
        }.`,
      );
    }

    // parsed_output is null when the reply did not satisfy the schema.
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new AiUnavailableError('Model output did not match the expected schema.');
    }
    return response.parsed_output as z.infer<T>;
  }

  async text(req: TextRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 8_000,
      system: req.system,
      output_config: { effort: req.effort ?? 'low' },
      messages: [{ role: 'user', content: req.user }],
    });

    if (response.stop_reason === 'refusal') {
      throw new AiUnavailableError('The model declined this request.');
    }

    return response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim();
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    // Derived from the same Zod schema the caller passed, so the two providers
    // cannot drift apart.
    const jsonSchema = z.toJSONSchema(req.schema, { target: 'draft-7' });

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16_000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: req.schemaName,
          schema: jsonSchema as Record<string, unknown>,
          strict: false,
        },
      },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new AiUnavailableError('Model returned an empty response.');

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new AiUnavailableError('Model returned malformed JSON.');
    }

    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new AiUnavailableError(
        `Model output did not match the expected schema: ${parsed.error.issues
          .map((i) => i.path.join('.'))
          .join(', ')}`,
      );
    }
    return parsed.data as z.infer<T>;
  }

  async text(req: TextRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 8_000,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });
    return (response.choices[0]?.message?.content ?? '').trim();
  }
}

/**
 * Returns null rather than throwing when no key is configured, so callers can
 * degrade to a clearly-labelled unavailable state instead of erroring.
 */
export function getAiProvider(): AiProvider | null {
  const env = serverEnv();
  if (env.AI_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) return null;
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  }
  if (!env.OPENAI_API_KEY) return null;
  return new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
}

export function requireAiProvider(): AiProvider {
  const provider = getAiProvider();
  if (!provider) {
    throw new AiUnavailableError(
      'No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
    );
  }
  return provider;
}

/**
 * Wraps untrusted material (a transcript, an email, a fetched document) in
 * delimiters and states that it is data.
 *
 * Captured and retrieved content routinely contains imperative text, and some
 * of it is hostile. This does not make injection impossible, but it is the
 * necessary first measure: the model is told where the boundary is, and the
 * surrounding prompts state that instructions inside it must be ignored.
 */
export function wrapUntrusted(label: string, content: string): string {
  const tag = label.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return [
    `<<<BEGIN_${tag}__UNTRUSTED_DATA>>>`,
    content,
    `<<<END_${tag}__UNTRUSTED_DATA>>>`,
  ].join('\n');
}
