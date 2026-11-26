/**
 * Station 2, all code (ADR-0010 D4–D6): it detects an injection attempt on the normalized
 * text, takes the email out, blanks phones and identity numbers, and wraps what is left in the
 * delimiter. The model only ever sees that wrapped, redacted text. The pattern list is a floor,
 * not a defence (ADR-0010, «Daño a vigilar»): F4 improves it.
 */

export const DELIMITER_OPEN = '<solicitud>';
export const DELIMITER_CLOSE = '</solicitud>';
export const PHONE_MARK = '[teléfono]';
export const DOCUMENT_MARK = '[documento]';
export const EMAIL_MARK = '[correo]';

export interface InjectionPattern {
  /** Stored in the event in place of the text that matched, which is never stored. */
  readonly id: string;
  /** Written against the normalized text: lowercase, no accents, horizontal spaces collapsed. */
  readonly pattern: RegExp;
}

// Question 2, accepted on 2026-11-26: a short list in Spanish and English. Words are joined by
// \s+ so a phrase split across lines still matches.
export const INJECTION_PATTERNS: readonly InjectionPattern[] = Object.freeze([
  { id: 'ignora-instrucciones', pattern: /\bignora\s+(?:\S+\s+){0,2}instrucciones\b/ },
  { id: 'ignore-instructions', pattern: /\bignore\s+(?:\S+\s+){0,2}instructions\b/ },
  { id: 'olvida-lo-anterior', pattern: /\bolvida\s+(?:todo\s+)?lo\s+anterior\b/ },
  { id: 'eres-ahora', pattern: /\beres\s+ahora\b/ },
  { id: 'actua-como', pattern: /\bactua\s+como\b/ },
  { id: 'system-prompt', pattern: /\bsystem\s+prompt\b/ },
  { id: 'mensaje-del-sistema', pattern: /\bmensaje\s+del\s+sistema\b/ },
  // D4: an opening or closing of the delimiter inside the text, with spaces anywhere in it.
  { id: 'etiqueta-delimitadora', pattern: /<\s*\/?\s*solicitud\b/ },
  { id: 'rol-al-inicio', pattern: /^\s*(?:system|assistant)\s*:/m },
]);

/**
 * Every invisible format character (the whole \p{Cf} class): zero-width characters, the soft
 * hyphen, bidirectional controls and tags. Any of them is a classic way to split a word, and a
 * list of a few left the others through (audit of ADR-0010, H2).
 */
const INVISIBLE = /\p{Cf}/gu;
const COMBINING_MARKS = /\p{M}/gu;
const HORIZONTAL_SPACE = /[^\S\n]+/g;
// U+2028 and U+2029 by their Unicode categories, so the source holds no invisible line break.
const LINE_BREAK = /\r\n?|[\p{Zl}\p{Zp}\u0085]/gu;

/** NFKC folds full-width letters into plain ones; NFD then splits off the accents to drop them. */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(INVISIBLE, '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(LINE_BREAK, '\n')
    .replace(HORIZONTAL_SPACE, ' ');
}

/** The id of the first pattern that matches, or null. */
export function findInjection(text: string): string | null {
  const normalized = normalizeForMatching(text);
  return INJECTION_PATTERNS.find((entry) => entry.pattern.test(normalized))?.id ?? null;
}

const NON_ASCII = /\P{ASCII}/gu;
const ONE_ASCII_CHARACTER = /^\p{ASCII}$/u;
const DECIMAL_DIGIT = /^\p{Nd}$/u;
/** Unicode lays out every decimal digit in runs of ten, from 0 to 9. */
const DIGITS_PER_RUN = 10;

/**
 * The value of a decimal digit of any script. Its run starts where the digits before it end; runs
 * that touch are each ten long, so the distance from the start, modulo ten, is the value.
 */
function digitValue(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  let start = codePoint;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  return (codePoint - start) % DIGITS_PER_RUN;
}

/**
 * Full-width digits, signs and letters, and other compatibility forms, folded into the plain
 * character NFKC gives (audit of ADR-0010, H1): "３００ １２３ ４５６７" is a phone like any
 * other. Digits of other scripts become the ASCII digit of their value, since NFKC keeps them
 * and `\d` does not see them (second audit, R2). Only a character that folds into exactly one
 * ASCII character changes, so "…" or "½" stay as they were and the model reads the rest of the
 * text untouched.
 */
function foldCompatibilityForms(text: string): string {
  return text.replace(NON_ASCII, (character) => {
    const folded = character.normalize('NFKC');
    if (ONE_ASCII_CHARACTER.test(folded)) return folded;
    return DECIMAL_DIGIT.test(character) ? String(digitValue(character)) : character;
  });
}

// Letters and digits of any script on both sides of the at sign: the CRM accepts «lucía@…», and
// an ASCII-only pattern cut it to «a@…», another address (second audit, R3).
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// An identity number is only blanked after a word that names it: a bare dotted number is far
// more often an amount ("1.500.000"), and the model needs amounts. Between the label and the
// number may sit any short stretch without digits (words, a comma, a bracket, a dash, quotes)
// and at most one line break, so «Cédula:» with the number below is blanked too (second audit,
// R1). A number that follows a label that closely is blanked even if it was an amount, the
// cheaper mistake.
const MAX_GAP_AFTER_LABEL = 30;
const DOCUMENT = new RegExp(
  String.raw`\b(c\.?\s?c\.?|c[eé]dula|documento|nit|pasaporte|identificaci[oó]n)` +
    String.raw`([^\d\n]{0,${MAX_GAP_AFTER_LABEL}}(?:\n[^\S\n]*)?)` +
    String.raw`(\d{1,3}(?:\.\d{3}){1,3}|\d{6,10})\b`,
  'giu',
);
// Seven to twelve digits, in groups split by spaces, dashes or parentheses, with an optional
// country code. Dots count only in groups of 3-3-4, which no amount has, since an amount's
// last group always has three digits (the owner's choice, 2026-11-26). A dot right before or
// after is fine unless a digit follows it: a phone may close a sentence. "35 personas" has two.
const PHONE =
  /(?<!\d|\d\.)(?:\+\d{1,3}[\s-]?)?(?:\d{3}\.\d{3}\.\d{4}|(?:\(\d{1,4}\)[\s-]?)?\d(?:[\s-]?\d){6,11})(?!\d|\.\d)/g;

export interface Redaction {
  readonly text: string;
  /** The first email, lowercased, for station 5 to find the contact. Never in an event. */
  readonly email: string | null;
  readonly phones: number;
  readonly documents: number;
}

/**
 * NFC first, so an accent written apart («cédula» in NFD) joins its letter and the labels match
 * (second audit, R1). Then compatibility forms, emails (they may hold digits), documents, phones.
 */
export function redact(text: string): Redaction {
  let email: string | null = null;
  let phones = 0;
  let documents = 0;
  const withoutEmails = foldCompatibilityForms(text.normalize('NFC')).replace(EMAIL, (found) => {
    email ??= found.toLowerCase();
    return EMAIL_MARK;
  });
  const withoutDocuments = withoutEmails.replace(DOCUMENT, (_found, label: string, separator: string) => {
    documents += 1;
    return `${label}${separator}${DOCUMENT_MARK}`;
  });
  const withoutPhones = withoutDocuments.replace(PHONE, () => {
    phones += 1;
    return PHONE_MARK;
  });
  return { text: withoutPhones, email, phones, documents };
}

export function delimit(text: string): string {
  return `${DELIMITER_OPEN}\n${text}\n${DELIMITER_CLOSE}`;
}
