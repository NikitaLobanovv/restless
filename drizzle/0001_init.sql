CREATE TYPE "public"."variable_scope" AS ENUM('global', 'environment', 'collection');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"variables_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_json" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_snapshot_json" jsonb NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"status" integer,
	"duration_ms" integer,
	"size_bytes" integer,
	"response_headers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response_body_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_tabs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid,
	"collection_id" uuid,
	"draft_json" jsonb NOT NULL,
	"saved_draft_json" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"params_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_type" text DEFAULT 'none' NOT NULL,
	"body" jsonb NOT NULL,
	"auth_json" jsonb,
	"settings_json" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "variable_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_tabs" ADD CONSTRAINT "open_tabs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_tabs" ADD CONSTRAINT "open_tabs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_workspace_id_idx" ON "collections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "environments_workspace_id_idx" ON "environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "folders_collection_id_idx" ON "folders" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "folders_parent_id_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "history_created_at_idx" ON "history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "open_tabs_request_id_idx" ON "open_tabs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_collection_id_idx" ON "requests" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "requests_folder_id_idx" ON "requests" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "requests_name_trgm_idx" ON "requests" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "requests_url_trgm_idx" ON "requests" USING gin ("url" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "variables_scope_idx" ON "variables" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variables_scope_key_uq" ON "variables" USING btree ("scope","scope_id","key");