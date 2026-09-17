CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"has_proof" boolean DEFAULT false NOT NULL,
	"registered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"type" text NOT NULL,
	"period" text,
	"method" text NOT NULL,
	"date" date NOT NULL,
	"bank_transaction_id" uuid,
	"registered_by" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_date" date,
	"quota_amount_cents" integer,
	"quota_start_month" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_transactions_date_idx" ON "bank_transactions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_quota_unique" ON "contributions" USING btree ("member_id","period") WHERE "contributions"."type" = 'quota';--> statement-breakpoint
CREATE INDEX "contributions_member_idx" ON "contributions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "contributions_period_idx" ON "contributions" USING btree ("period");