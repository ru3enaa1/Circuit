// Public face of the CRM client (ADR-0012 A9): the core's CRM ports over HTTP with the agent's
// key, and the list of the CRM's tools the board shows (ADR-0011 B8). It never imports apps/crm
// (ADR-0003 M3).
export { CrmClientConfigError, DEFAULT_CRM_URL, readAgentKey, readCrmEndpoint, readCrmUrl } from './config.ts';
export type { CrmEndpoint } from './config.ts';
export { CRM_REQUEST_TIMEOUT_MS, CrmReadFailed, HttpCrmClient } from './http.ts';
export type { Fetch } from './http.ts';
export { CRM_TOOLS } from './tools.ts';
export type { CrmTool, ToolAccess } from './tools.ts';
