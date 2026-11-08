CREATE TABLE "mortgage_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount_cents" integer NOT NULL,
	"charge_day" integer NOT NULL,
	"effective_from" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "mortgage_period" text;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN "mortgage_generated_through" text;--> statement-breakpoint
ALTER TABLE "mortgage_schedule" ADD CONSTRAINT "mortgage_schedule_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mortgage_schedule_effective_from_unique" ON "mortgage_schedule" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_mortgage_period_unique" ON "bank_transactions" USING btree ("mortgage_period") WHERE "bank_transactions"."mortgage_period" is not null and "bank_transactions"."deleted_at" is null;