CREATE TABLE "account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"wp_user_id" integer NOT NULL,
	"wp_username" text NOT NULL,
	"wp_name" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"broken_code" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_links_status_check" CHECK ("account_links"."status" in ('ok', 'broken'))
);
--> statement-breakpoint
CREATE TABLE "link_states" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_states" ADD CONSTRAINT "link_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_user_connection_key" ON "account_links" USING btree ("user_id","connection_id");