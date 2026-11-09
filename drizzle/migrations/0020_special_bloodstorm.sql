CREATE TABLE "telegram_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "telegram_pending_actions" ADD CONSTRAINT "telegram_pending_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_conversation_messages_chat_idx" ON "telegram_conversation_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_pending_actions_status_idx" ON "telegram_pending_actions" USING btree ("status");