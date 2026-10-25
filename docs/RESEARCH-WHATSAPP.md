# Technical discovery: WhatsApp capture and delivery

The brief flagged personal WhatsApp as a discovery item to settle early and to
keep the rest of the application independent of. This file records what was
established, how confident we are in each point, and what must still be
verified before production use.

**Verification status: INCOMPLETE.** `developers.facebook.com` is blocked by
this build environment's network policy, so Meta's primary documentation could
not be opened. Every finding below is corroborated across multiple independent
third-party sources that agree with each other, but none is the primary source.
Re-verify the two tables below against Meta's Cloud API documentation before
enabling group delivery in production. The code is written so that none of
these answers is baked into application logic: see "How the code absorbs this"
below.

## Finding 1 — Reading a personal WhatsApp inbox is not possible

No official Meta or Twilio API exposes the message history or inbox of an
ordinary personal WhatsApp account. The Cloud API is built around a business
phone number that the business controls; it delivers inbound messages that
users send *to that number* via webhook. It does not expose a personal
account's own conversations.

This is a stable, long-standing property of the platform rather than a gap
awaiting a new endpoint, so we treat it as settled.

Consequence: the brief's "ingest my personal WhatsApp messages" cannot be
implemented as true inbox synchronisation. Vendors do sell this, but they
achieve it by driving WhatsApp Web with unofficial automation, which the brief
explicitly rules out as a production dependency, and which risks the user's
account being banned.

**What we implement instead:** a forwarding capture endpoint. The user forwards
the specific messages they want captured to the application's business number.
Those arrive legitimately via the Cloud API webhook and become captures. This
satisfies the brief's requirement that the user selects which messages are
ingested, and avoids collecting whole conversations. The integrations screen
states plainly that full personal-account sync is not supported, and the
connector reports `read_personal_inbox: false`.

## Finding 2 — Group sending IS supported, with a hard 8-participant cap

An earlier draft of this project asserted that no official API can send to a
WhatsApp group. **That was wrong.** Meta has shipped a Groups API as part of
the Cloud API.

| Property | Finding | Confidence |
| --- | --- | --- |
| Send text/media/template into a group | Supported | High — consistent across sources |
| Eligibility | Official Business Account (verified display name) required | High |
| Max participants | **8, including the business number** (so 7 humans) | High — consistently cited |
| Not available for | WhatsApp Business *app* numbers; Multi-solution Conversations / Coexistence accounts | Medium |
| Adding members | Invite-link only; no add-participant endpoint | High |
| Groups per business number | ~10,000 | Low — single source |
| Inbound group webhooks | Group-specific events exist (join, message, removal) | Medium — exact field names unverified |
| Group ownership | A group belongs to exactly one Cloud API business; no co-management | Medium |
| Calling in groups | Not supported | Medium |

The 8-participant cap is the load-bearing constraint. It means group delivery
of the team report is genuinely available, but only for a team of 7 or fewer
people. Beyond that the group simply cannot be addressed through the official
API, and any vendor offering it at larger sizes is using unofficial automation.

Twilio's WhatsApp product does not expose group sending at all, so for Twilio
the capability is absent rather than capped.

## How the code absorbs this

Because two of these answers are only corroborated rather than verified, the
application does not hardcode them. Each WhatsApp adapter declares a
capability descriptor (`src/server/connectors/whatsapp/types.ts`), and the
report delivery service branches on the descriptor rather than on a provider
name:

- `sendDirect` — supported by both the Meta and Twilio adapters.
- `sendGroup` — declared by the Meta adapter, absent from Twilio's.
- `groupMaxParticipants` — 8 for Meta, so the UI can warn a larger team
  *before* a send is attempted rather than failing at delivery time.
- `readPersonalInbox` — false everywhere. Nothing in the product offers it.

Team report delivery therefore resolves a destination in this order:

1. If a group destination is configured **and** the active provider declares
   `sendGroup`, deliver to the group.
2. Otherwise fan out to the team members who have individually opted in with a
   verified number, and label the report in the UI as fanned-out rather than
   group-delivered.
3. If neither is possible, the delivery row is written with status
   `unsupported` and the reason is surfaced on the Reports screen.

The third branch matters: the brief forbids silently substituting an unrelated
recipient or claiming a delivery that did not happen. A delivery is only marked
`sent` when the provider returns a message id, and only `delivered` when a
provider status callback confirms it.

## Required before enabling group delivery in production

1. Open Meta's Cloud API Groups documentation and confirm the participant cap
   and the eligibility gate.
2. Confirm the WhatsApp Business Account holds an Official Business Account
   badge; group endpoints reject non-OBA senders.
3. Confirm the webhook field names for group events against Meta's webhook
   reference, then set `WHATSAPP_GROUP_WEBHOOK_FIELDS` if they differ from the
   defaults in the adapter.
4. Register and get approval for the report message template. The 9pm report is
   a business-initiated message, so outside a 24-hour customer service window
   it must be sent as an approved template.
