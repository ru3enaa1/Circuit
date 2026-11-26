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

/** Zero-width characters and the soft hyphen: invisible, and a classic way to split a word. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g;
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

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// An identity number is only blanked after a word that names it: a bare dotted number is far
// more often an amount ("1.500.000"), and the model needs amounts.
const DOCUMENT =
  /\b(c\.?\s?c\.?|c[eé]dula(?:\s+de\s+ciudadan[ií]a)?|documento(?:\s+de\s+identidad)?|nit|pasaporte|identificaci[oó]n)(\s*(?:n[oº°.]*|#|:)?\s*)(\d{1,3}(?:\.\d{3}){1,3}|\d{6,10})\b/gi;
// Seven to twelve digits, in groups split by spaces, dashes or parentheses, with an optional
// country code. Dots are left out for the same reason as above. "35 personas" has two digits.
const PHONE = /(?<![\d.])(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d(?:[\s-]?\d){6,11}(?![\d.])/g;

export interface Redaction {
  readonly text: string;
  /** The first email, lowercased, for station 5 to find the contact. Never in an event. */
  readonly email: string | null;
  readonly phones: number;
  readonly documents: number;
}

/** Emails first (they may hold digits), then identity numbers, then phones. */
export function redact(text: string): Redaction {
  let email: string | null = null;
  let phones = 0;
  let documents = 0;
  const withoutEmails = text.replace(EMAIL, (found) => {
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
