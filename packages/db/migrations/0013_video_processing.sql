CREATE TABLE IF NOT EXISTS "video_processing_jobs" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "clip_count" integer NOT NULL DEFAULT 1,
  "duration" integer NOT NULL DEFAULT 10,
  "music_genre" varchar(20) DEFAULT 'hiphop',
  "transcript_text" text,
  "input_urls" jsonb,
  "output_url" text,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_video_jobs_tenant" ON "video_processing_jobs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_video_jobs_status" ON "video_processing_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_video_jobs_created" ON "video_processing_jobs" ("created_at");
