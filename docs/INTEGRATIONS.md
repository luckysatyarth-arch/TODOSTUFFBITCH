# Integration setup

Every integration is optional. A provider without credentials reports
`requires_setup` on the Integrations page and is excluded from search; it is
never shown as connected.

## Required accounts and permissions

| Provider | Account needed | What to create | Permissions |
| --- | --- | --- | --- |
| Supabase | Any plan | A project | — (required for the core app) |
| Anthropic **or** OpenAI | API access | An API key | — |
| OpenAI | API access | An API key | Needed for embeddings and Whisper even when Anthropic is the chat provider |
| Google Cloud | Any | An OAuth 2.0 client (Web application) | `drive.readonly`, `drive.metadata.readonly`, `gmail.readonly` |
| Microsoft Entra | Any | An app registration | `Mail.Read`; Teams additionally needs `Chat.Read` and `ChannelMessage.Read.All` with **tenant admin consent** |
| Notion | Any | A public integration | Page access is granted per page by the user |
| Meta | WhatsApp Business | An app with WhatsApp product, plus a Business Account | Group sending additionally needs an Official Business Account |
| Twilio | Any | A WhatsApp sender | — |

---

## AI provider

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5
```

or

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
```

Without a key, extraction, grounded answers and report narratives are
disabled and the UI says so. Task, project, calendar and report **numbers**
never depend on a model and keep working regardless.

Structured output uses `output_config.format`, not a forced `tool_choice`:
current Claude models reject `tool_choice: {type: 'tool'}` with a 400, and
`temperature` is rejected on every model, so neither appears in the code.

### Embeddings

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

**1536 dimensions is fixed by the database schema**
(`document_embeddings.embedding`). A model with a different output size needs
a migration; the code checks the returned length and fails loudly rather than
storing wrong-sized vectors.

### Transcription

```bash
TRANSCRIPTION_PROVIDER=openai
TRANSCRIPTION_MODEL=whisper-1
```

Set `TRANSCRIPTION_PROVIDER=none` to accept audio uploads but require the
transcript to be typed or pasted. Recording and playback still work.

---

## Credential encryption

```bash
# openssl rand -hex 32
CREDENTIALS_ENCRYPTION_KEY=<64 hex characters>
```

Required before any OAuth integration can be connected. Tokens are encrypted
with AES-256-GCM and stored in `integration_credentials`, a table with RLS
enabled and **no policies**, so only the service role can read it.

Rotating the key invalidates stored credentials; reconnect each integration
afterwards. `key_version` exists on the row so a future rotation can be
staged rather than breaking everything at once.

---

## Google Drive and Gmail

Both use one OAuth client; scopes are requested per feature.

1. Google Cloud console → APIs & Services → Credentials → Create OAuth client
   ID → Web application.
2. Authorised redirect URI:
   `https://<your-app>/api/integrations/google/callback`
   (and the `http://localhost:3000` equivalent for development).
3. Enable the Drive API and the Gmail API.
4. Set:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

**Limitations, as implemented:**

- Drive indexing is **metadata-level**: file name, MIME type, owner, modified
  time and link. Exporting document bodies needs a second API call per file
  and is not done, so Drive content is findable by name but not by its text.
- Gmail indexes **headers and the snippet**, not full bodies, which keeps the
  index to the minimum needed for retrieval.
- Both are indexed `owner_only`, so one person's Drive or mail never appears
  in another member's results.
- Revoking access in Google stops further syncs. Already-indexed content
  stays until purged — do that from Settings.
- A `drive.readonly` scope will show as a sensitive scope in Google's consent
  screen and needs verification before use outside your own organisation.

---

## Microsoft Graph: Outlook mail and Teams

1. Entra admin centre → App registrations → New registration.
2. Redirect URI (Web):
   `https://<your-app>/api/integrations/microsoft/callback`
3. API permissions → Microsoft Graph → Delegated:
   - Mail: `offline_access`, `User.Read`, `Mail.Read`
   - Teams: additionally `Chat.Read`, `ChannelMessage.Read.All`
4. **Teams needs admin consent.** `ChannelMessage.Read.All` cannot be granted
   by a user alone. Without it, the connector returns an explicit 403 message
   rather than silently finding nothing.
5. Set:

```bash
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=common   # or your tenant id to restrict sign-in
```

**Limitations:**

- Private channel messages are not accessible under delegated permissions.
- Message history beyond the tenant retention policy is not retrievable, and
  the export APIs that reach further are licence-gated.
- Teams sync has no delta cursor in this implementation, so each run re-reads
  the recent set.

---

## Notion

1. notion.so/my-integrations → New integration → Public.
2. Redirect URI: `https://<your-app>/api/integrations/notion/callback`
3. Set:

```bash
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
```

**Limitations:**

- Notion returns only pages and databases a user has **explicitly shared**
  with the integration. Nothing else is visible to it, by design.
- The search endpoint has no delta cursor, so sync is a full re-read of the
  shared set rather than incremental.
- Page titles and properties are indexed. Block bodies need a separate fetch
  per page and are not indexed.

---

## WhatsApp

Read `RESEARCH-WHATSAPP.md` first. Summary:

- **Reading a personal account's inbox is impossible** through any official
  API. Capture is forwarding-based.
- **Group sending is possible** via Meta's Cloud API, but requires an
  Official Business Account and caps a group at **8 participants including
  the business number**. Twilio cannot send to groups at all.

### Meta Cloud API

1. developers.facebook.com → Create app → add the WhatsApp product.
2. Note the phone number id and the WhatsApp Business Account id.
3. Generate a permanent access token via a System User.
4. Set the webhook to `https://<your-app>/api/webhooks/whatsapp`, with a
   verify token of your choosing, and subscribe to the `messages` field.
5. Set:

```bash
WHATSAPP_PROVIDER=meta_cloud
WHATSAPP_META_ACCESS_TOKEN=...
WHATSAPP_META_PHONE_NUMBER_ID=...
WHATSAPP_META_BUSINESS_ACCOUNT_ID=...
WHATSAPP_META_API_VERSION=v23.0
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<what you entered in step 4>
WHATSAPP_APP_SECRET=<App secret from Settings → Basic>
```

**Message templates.** The 21:00 report is business-initiated. Outside a
24-hour customer-service window, WhatsApp requires an approved template, not
free text. Register one and set `WHATSAPP_META_TEMPLATE_NAME`. The current
adapter sends a text message, which works inside the 24-hour window and
during testing; switching to a template send is a small change in
`src/server/connectors/whatsapp/meta.ts`, and the limitation is recorded in
`docs/LIMITATIONS.md`.

### Twilio

```bash
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

The sandbox number is fine for testing; recipients must join the sandbox
first. Group sending returns `unsupported` and is recorded as such.

### Dry run

```bash
WHATSAPP_PROVIDER=dry_run
```

The default. Reports generate, delivery records are written with provider
`dry_run`, and nothing is sent. This exercises the entire pipeline —
generation, idempotency, retries, the admin view — with no credentials, and
a dry-run row cannot be mistaken for a real send.

### Receiving reports

Each person sets their own number in Settings, in E.164 (`+919876543210`).
That number is also how an inbound forwarded message is attributed: a message
from an unrecognised number is discarded rather than assigned to a guessed
owner.

---

## Scheduled reports

```bash
# openssl rand -hex 32
CRON_SECRET=<64 hex characters>
REPORT_TIMEZONE=Asia/Kolkata
```

`vercel.json` registers the schedule. After deploying, verify it — see the
Deployment section of the README.
