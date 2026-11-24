-- Circuit · esquema vigente de PostgreSQL, para leerlo de un vistazo.
-- Lo escriben las migraciones de database/migrations (Drizzle); este archivo solo lo muestra.
-- Desde F1.1, con las primeras tablas, se genera desde una base migrada (DEVELOPMENT_PLAN, R8).

-- Un esquema por servicio (ADR-0003). Sin tablas todavía.
CREATE SCHEMA circuit;
CREATE SCHEMA crm;

-- Migraciones aplicadas. Lo crea Drizzle al migrar, no una migración.
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
    id         serial PRIMARY KEY,
    hash       text NOT NULL,
    created_at bigint
);
