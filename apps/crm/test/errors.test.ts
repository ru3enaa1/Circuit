import { describe, expect, it } from 'vitest';

import { ApiError, ERROR_STATUS, errorBody } from '../src/server/errors.ts';

// ADR-0007 D11 and D2: the closed list of errors, compared with a fixed one, so a code added
// or a status changed shows in the diff of this file.

describe('D11 · the closed list of errors', () => {
  it('is exactly these codes with these statuses', () => {
    expect(ERROR_STATUS).toEqual({
      sin_llave: 401,
      llave_invalida: 401,
      cuenta_ajena: 403,
      sin_permiso: 403,
      entrada_invalida: 400,
      no_encontrado: 404,
      ya_existe: 409,
      demasiado_grande: 413,
      error_interno: 500,
    });
  });

  it('ya_existe says what conflicts, with a fixed message', () => {
    expect(errorBody(new ApiError('ya_existe'))).toEqual({
      error: { code: 'ya_existe', message: 'Ya hay un contacto activo con ese correo.' },
    });
  });
});

describe('D2 · sin_permiso names the permission', () => {
  it.each([
    ['read', 'La llave no tiene permiso de lectura.'],
    ['write', 'La llave no tiene permiso de escritura.'],
    ['delete', 'La llave no tiene permiso de borrado.'],
  ] as const)('%s: «%s»', (permission, message) => {
    expect(errorBody(new ApiError('sin_permiso', permission))).toEqual({ error: { code: 'sin_permiso', message } });
  });

  it('a permission is never taken for a field name, nor a field name for a permission', () => {
    const forbidden = new ApiError('sin_permiso', 'write');
    const invalid = new ApiError('entrada_invalida', 'email');
    expect([forbidden.field, forbidden.permission]).toEqual([undefined, 'write']);
    expect([invalid.field, invalid.permission]).toEqual(['email', undefined]);
  });
});
