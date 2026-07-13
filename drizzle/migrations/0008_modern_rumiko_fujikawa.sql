CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Rango inclusivo-inclusivo [inicio, fin] deliberado: permite reservar un único día
-- (start_date = end_date) sin tratarlo como rango vacío. Trade-off aceptado: dos reservas
-- no pueden encadenar checkout/checkin el mismo día (se consideran solapadas).
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlap" EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);