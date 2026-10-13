-- Durable application identity and further boundaries; never resets existing data.
ALTER TABLE generation_job ADD COLUMN applied_content_id text REFERENCES content(id) ON DELETE SET NULL;
ALTER TABLE generation_job ADD COLUMN applied_revision integer;
ALTER TABLE generation_job ADD COLUMN applied_at timestamptz;
ALTER TABLE generation_job ADD CONSTRAINT generation_application_version FOREIGN KEY(applied_content_id,applied_revision) REFERENCES content_version(content_id,revision) ON DELETE SET NULL;
ALTER TABLE generation_job ADD CONSTRAINT generation_attempt_bound CHECK(attempts>=0 AND attempts<=3);
ALTER TABLE generation_job ADD CONSTRAINT generation_kind CHECK(kind IN ('COLLECT','RECHECK','GENERATE','REWRITE','TITLE'));
ALTER TABLE generation_job DROP CONSTRAINT generation_job_base_content_id_fkey;
ALTER TABLE generation_job ADD CONSTRAINT generation_job_base_content_id_fkey FOREIGN KEY(base_content_id) REFERENCES content(id) ON DELETE SET NULL;
ALTER TABLE publish_job ADD CONSTRAINT publication_attempt_bound CHECK(attempts>=0 AND attempts<=3);
ALTER TABLE editorial_evidence ADD CONSTRAINT evidence_status CHECK(status IN ('VERIFIED','NEEDS_REVIEW'));
ALTER TABLE article_comment ADD CONSTRAINT official_actor_exists FOREIGN KEY(official_actor) REFERENCES admin_user(user_id);
ALTER TABLE article_comment ADD CONSTRAINT comment_writer CHECK(official_actor IS NOT NULL OR password_hash IS NOT NULL);
ALTER TABLE topic_candidate ADD CONSTRAINT candidate_intent CHECK(intent IN ('CREATE','UPDATE','SKIP'));
INSERT INTO schema_migration(version) VALUES('003');
