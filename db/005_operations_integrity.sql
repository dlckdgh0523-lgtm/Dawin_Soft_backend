-- Keep every CSV correction immutable; cancellation restores the preceding committed batch.
CREATE TABLE metric_import_value(id text PRIMARY KEY,import_id text NOT NULL REFERENCES marketing_import(id),account_id text NOT NULL REFERENCES marketing_account(id),report text NOT NULL,grain text NOT NULL,window_start date NOT NULL,window_end date NOT NULL,query_version text NOT NULL,dimension_key text NOT NULL,metric text NOT NULL REFERENCES metric_definition(name),value numeric(24,8),status text NOT NULL,timezone text NOT NULL,currency text,content_id text REFERENCES content(id),campaign_id text REFERENCES marketing_campaign(id),provider_metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(import_id,report,grain,window_start,window_end,query_version,dimension_key,metric));
CREATE INDEX import_value_key ON metric_import_value(account_id,report,grain,window_start,window_end,query_version,dimension_key,metric);
ALTER TABLE marketing_oauth_state ADD COLUMN account_revision integer NOT NULL DEFAULT 1;
ALTER TABLE marketing_oauth_state ADD COLUMN session_version integer NOT NULL DEFAULT 1;
INSERT INTO schema_migration(version) VALUES('005');
