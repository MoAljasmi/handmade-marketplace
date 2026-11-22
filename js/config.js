/*
 * Supabase connection settings
 * ---------------------------------------------------------------
 * Supabase Dashboard -> Project Settings -> API (or "API Keys"):
 *   - Project URL
 *   - Publishable key (or the legacy "anon" public key)
 *
 * These two values are meant to be public: they ship to every visitor's
 * browser. Data stays safe because Row Level Security is enabled on every
 * table (see database/database.sql).
 *
 * NEVER put the service_role / secret key or the database password here.
 */
const SUPABASE_URL = "https://vsalkwmrzvlamzrisreq.supabase.co";
const SUPABASE_KEY = "sb_publishable_y4jQaAXUBgBsigUpFG9kxw_r6bOi2Mi";
