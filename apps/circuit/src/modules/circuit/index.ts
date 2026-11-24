// Public face of the circuit core (ADR-0001, ADR-0003). Other code imports it only from here.
// The core orders the seven stations and declares the ports it needs (model, CRM, clock);
// it imports no other module and no package (test/architecture/module-map.ts).
// The stations, branches and events arrive in F2.1.
export {};
