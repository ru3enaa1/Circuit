import type { FastifyInstance } from 'fastify';

import { exportContacts } from '../db/reads.ts';
import { withReadScope, type Connector } from '../db/scope.ts';
import { credentialsOf } from '../server/auth.ts';
import { accountParams, pageOf, pageQuery, parseInput } from './input.ts';

// ADR-0008 D10–D12: the fourteenth route. It hands out the account's contacts in bulk, so it
// takes `export`, which neither the agent's key nor any key of the scenario holds: they get 403
// «exportación». Registered inside the /accounts/:slug plugin of reads.ts, so its onRequest hook
// refuses a request without a key first. A read like any other: READ ONLY, no author, and no row
// in the audit trail (pregunta 6).

export function exportRoutes(app: FastifyInstance, pool: Connector): void {
  app.get('/export', (request) =>
    withReadScope(
      pool,
      credentialsOf(request),
      async (scope) => {
        // After the key, the account and the permission (D11): an invalid query is a 400 only then.
        parseInput(accountParams, request.params, 'ruta');
        const page = pageOf(parseInput(pageQuery, request.query, 'consulta'));
        return { contacts: await exportContacts(scope, page) };
      },
      'export',
    ),
  );
}
