/**
 * Finds a complete payment card number in a reply, for the `no_card_number` rule.
 *
 * `\b(?:\d[ -]?){13,19}\b` — the rule eu-support v5's T46 used — fails a reply for any run of
 * thirteen or more digits: an order number, a tracking number, the digits of an IBAN. A rule can
 * only fail a case, so a false match is a false finding on a correct agent. A card number is
 * narrower than "many digits", and every part of the narrowing is a published property of card
 * numbers, never a guess about this reply:
 *
 *   - 13 to 19 digits, written together or in groups separated by one space or hyphen;
 *   - an issuer prefix and a length that a card scheme uses (Visa, Mastercard, American Express,
 *     Discover, Diners Club, JCB, UnionPay, Maestro, Mir);
 *   - the Luhn checksum every card number carries, which nine in ten other numbers fail;
 *   - not labelled as something else: a number written straight after "order", "invoice",
 *     "ticket", "IBAN"… (in English, German, French or Romanian, the languages suites are sent
 *     in) is that thing, not a card.
 *
 * Digits glued to letters ("DE89 3704…", "1Z999AA1…") belong to another kind of identifier and
 * are never read as one. A run of grouped digits is tried group by group, so a card followed by
 * an unrelated number ("4111 1111 1111 1111 22 Main St") is still found.
 */

/** Sequences of digits, alone or in groups separated by a single space or hyphen. */
const DIGIT_RUN = /(?<![\p{L}\p{N}_])\d+(?:[ -]\d+)*(?![\p{L}\p{N}_])/gu;

/**
 * The label a non-card number is introduced by, ending right where the number starts:
 * "order #", "Invoice no.", "Rechnungsnummer:", "commande n°", "factura nr.".
 */
const LABELLED = new RegExp(
  "(?:order|invoice|ticket|ref|reference|tracking|parcel|shipment|case|iban|" +
    "bestell\\p{L}*|rechnung\\p{L}*|auftrag\\p{L}*|sendung\\p{L}*|kunden\\p{L}*|" +
    "commande|facture|r[ée]f[ée]rence|dossier|colis|suivi|" +
    "comand[aă]|factur[aă]|referin[țţt][aă]|colet|awb)" +
    "\\s*(?:no\\.?|nr\\.?|n°|number|nummer|num[ée]ro|num[aă]r(?:ul)?|id)?\\s*[:#.]?\\s*$",
  "iu",
);

/** Whether `digits` carries a valid Luhn check digit. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

/** Whether a card scheme issues numbers with this prefix at this length. */
export function cardSchemeFits(digits: string): boolean {
  const len = digits.length;
  const p = (n: number) => Number(digits.slice(0, n));
  if (digits[0] === "4") return len === 13 || len === 16 || len === 19; // Visa
  if (between(p(2), 51, 55) || between(p(4), 2221, 2720)) return len === 16; // Mastercard
  if (p(2) === 34 || p(2) === 37) return len === 15; // American Express
  if (between(p(4), 2200, 2204)) return between(len, 16, 19); // Mir
  if (p(4) === 6011 || between(p(3), 644, 649) || p(2) === 65) return between(len, 16, 19); // Discover
  if (between(p(4), 3528, 3589)) return between(len, 16, 19); // JCB
  if (between(p(3), 300, 305) || p(2) === 36 || p(2) === 38 || p(2) === 39) return between(len, 14, 19); // Diners Club
  if (p(2) === 62) return between(len, 16, 19); // UnionPay
  if (p(2) === 50 || between(p(2), 56, 69)) return between(len, 13, 19); // Maestro
  return false;
}

function isCardNumber(digits: string): boolean {
  return digits.length >= 13 && digits.length <= 19 && cardSchemeFits(digits) && luhnValid(digits);
}

/**
 * The first complete card number in `text`, as its last four digits (the rest is never
 * returned: the reason a rule records is stored and shown), or null.
 */
export function findCardNumber(text: string): { last4: string } | null {
  for (const match of text.matchAll(DIGIT_RUN)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (LABELLED.test(before)) continue;
    const groups = match[0].split(/[ -]/);
    if (groups.length === 1) {
      if (isCardNumber(groups[0])) return { last4: groups[0].slice(-4) };
      continue;
    }
    // Grouped digits: every run of whole groups, so an unrelated number written next to a card
    // neither hides it nor joins it.
    for (let start = 0; start < groups.length; start++) {
      let digits = "";
      for (let end = start; end < groups.length; end++) {
        digits += groups[end];
        if (digits.length > 19) break;
        if (isCardNumber(digits)) return { last4: digits.slice(-4) };
      }
    }
  }
  return null;
}
