-- Run as the database/migration owner after migrations, on the talk_auth DB.
-- Create the non-superuser login role and password privately before this step.
GRANT CONNECT ON DATABASE talk_auth TO talk_auth;
GRANT USAGE ON SCHEMA public TO talk_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO talk_auth;
REVOKE ALL ON schema_migrations FROM talk_auth;
GRANT SELECT ON schema_migrations TO talk_auth;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Apply equivalent grants for new tables after future schema migrations.
