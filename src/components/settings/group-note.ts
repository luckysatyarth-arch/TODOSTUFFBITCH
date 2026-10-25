/**
 * The group-destination caveat, in one place.
 *
 * Stated as a limitation of the official API rather than of this application,
 * because that is what it is -- see docs/RESEARCH-WHATSAPP.md.
 */
export function getWhatsAppGroupNote(): string {
  return (
    'Meta\'s Cloud API can send into a WhatsApp group, but only for an Official Business ' +
    'Account and only up to 8 participants including the sender. Twilio cannot send to groups ' +
    'at all. If the configured provider or the team size makes group delivery impossible, the ' +
    'report fans out to members\' individual numbers instead and the Reports page says so.'
  );
}
