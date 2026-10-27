export type ChargeKind = 'purchase' | 'refund';

export interface ParsedCharge {
  kind: ChargeKind;
  merchantRaw: string;
  amountCents: number; // signed integer cents; refunds negative
  currency: 'USD';
  occurredAt: Date;
  accountLast4: string | null;
}

export interface RawEmail {
  messageId: string;
  from: string;      // full From header (may include display name)
  subject: string;
  receivedAt: Date;
  text: string;      // plain text (already HTML-stripped if needed)
}
