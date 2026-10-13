CREATE TABLE admin_session (
 token_hash text PRIMARY KEY,
 user_id text NOT NULL REFERENCES admin_user(user_id),
 credential_version text NOT NULL,
 operator_session_version integer NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_session_expiry ON admin_session(expires_at);
CREATE TABLE admin_login_nonce (
 nonce_hash text PRIMARY KEY,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
INSERT INTO schema_migration(version) VALUES ('006');
