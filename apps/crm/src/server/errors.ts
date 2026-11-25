import { MAX_BODY_BYTES } from './limits.ts';

// ADR-0006: every error the API answers with, from a closed list, with one body shape:
// { "error": { "code", "message" } }. The message is fixed per code, in Spanish, and never
// repeats a value from the request. entrada_invalida names the field, and field names come
// only from the API's own schemas (input.ts), never from the request. ADR-0007 adds
// ya_existe (D11) and names the missing permission in sin_permiso (D2).

export const ERROR_STATUS = {
  sin_llave: 401,
  llave_invalida: 401,
  cuenta_ajena: 403,
  sin_permiso: 403,
  entrada_invalida: 400,
  no_encontrado: 404,
  ya_existe: 409,
  demasiado_grande: 413,
  error_interno: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** ADR-0007 D2: what each route requires. A key may also hold `export`, which no route asks for yet. */
export type Permission = 'read' | 'write' | 'delete';

/** The read message is the one ADR-0006 answered with, unchanged (D2). */
const MISSING_PERMISSION: Readonly<Record<Permission, string>> = {
  read: 'La llave no tiene permiso de lectura.',
  write: 'La llave no tiene permiso de escritura.',
  delete: 'La llave no tiene permiso de borrado.',
};

const MESSAGES: Readonly<Record<Exclude<ErrorCode, 'entrada_invalida' | 'sin_permiso'>, string>> = {
  sin_llave: 'Falta la llave: mándala en la cabecera Authorization: Bearer <llave>.',
  llave_invalida: 'La llave no es válida.',
  cuenta_ajena: 'La llave no es de esta cuenta.',
  no_encontrado: 'No se encontró.',
  // Names the conflict, never the address: the request already knows which one it sent.
  ya_existe: 'Ya hay un contacto activo con ese correo.',
  demasiado_grande: `El cuerpo pasa de ${MAX_BODY_BYTES / 1024} KiB.`,
  error_interno: 'Error interno.',
};

/** Thrown anywhere in a request; the error handler turns it into its status and body. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  /** Only for entrada_invalida: a field name from the API's schemas. */
  readonly field: string | undefined;
  /** Only for sin_permiso: the permission the key lacks. */
  readonly permission: Permission | undefined;

  constructor(code: 'sin_permiso', permission: Permission);
  constructor(code: Exclude<ErrorCode, 'sin_permiso'>, field?: string);
  constructor(code: ErrorCode, detail?: string) {
    super(code);
    this.code = code;
    // The overloads tie the second argument to the code: sin_permiso always comes with a
    // permission, and every other code with a field name or nothing.
    this.field = code === 'sin_permiso' ? undefined : detail;
    this.permission = code === 'sin_permiso' ? (detail as Permission) : undefined;
  }
}

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

function messageOf(error: ApiError): string {
  if (error.code === 'entrada_invalida') return `La entrada no es válida: revisa «${error.field ?? 'petición'}».`;
  // An ApiError built for sin_permiso always carries its permission (the constructor's overloads).
  if (error.code === 'sin_permiso') return MISSING_PERMISSION[error.permission as Permission];
  return MESSAGES[error.code];
}

export function errorBody(error: ApiError): ErrorBody {
  return { error: { code: error.code, message: messageOf(error) } };
}
