import { MAX_BODY_BYTES } from './limits.ts';

// ADR-0006: every error the API answers with, from a closed list, with one body shape:
// { "error": { "code", "message" } }. The message is fixed per code, in Spanish, and never
// repeats a value from the request. entrada_invalida names the field, and field names come
// only from the API's own schemas (input.ts), never from the request.

export const ERROR_STATUS = {
  sin_llave: 401,
  llave_invalida: 401,
  cuenta_ajena: 403,
  sin_permiso: 403,
  entrada_invalida: 400,
  no_encontrado: 404,
  demasiado_grande: 413,
  error_interno: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const MESSAGES: Readonly<Record<Exclude<ErrorCode, 'entrada_invalida'>, string>> = {
  sin_llave: 'Falta la llave: mándala en la cabecera Authorization: Bearer <llave>.',
  llave_invalida: 'La llave no es válida.',
  cuenta_ajena: 'La llave no es de esta cuenta.',
  sin_permiso: 'La llave no tiene permiso de lectura.',
  no_encontrado: 'No se encontró.',
  demasiado_grande: `El cuerpo pasa de ${MAX_BODY_BYTES / 1024} KiB.`,
  error_interno: 'Error interno.',
};

/** Thrown anywhere in a request; the error handler turns it into its status and body. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  /** Only for entrada_invalida: a field name from the API's schemas. */
  readonly field: string | undefined;

  constructor(code: ErrorCode, field?: string) {
    super(code);
    this.code = code;
    this.field = field;
  }
}

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

export function errorBody(error: ApiError): ErrorBody {
  const message =
    error.code === 'entrada_invalida' ? `La entrada no es válida: revisa «${error.field ?? 'petición'}».` : MESSAGES[error.code];
  return { error: { code: error.code, message } };
}
