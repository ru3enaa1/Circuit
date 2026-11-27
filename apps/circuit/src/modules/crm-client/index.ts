// Public face of the CRM client: the core's CRM port, implemented over HTTP with the agent's
// key, arrives with F2.4. It never imports apps/crm (ADR-0003 M3). Today it holds the list of
// the CRM's tools the board shows (ADR-0011 B8).
export { CRM_TOOLS } from './tools.ts';
export type { CrmTool, ToolAccess } from './tools.ts';
