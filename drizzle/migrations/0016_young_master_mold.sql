DROP INDEX "contributions_quota_unique";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "auto_created_for_contribution_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_deleted_at_idx" ON "expenses" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "bank_transactions_auto_contribution_idx" ON "bank_transactions" USING btree ("auto_created_for_contribution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_quota_unique" ON "contributions" USING btree ("member_id","period") WHERE "contributions"."type" = 'quota' and "contributions"."deleted_at" is null;

-- =====================================================================================
-- Fase 8 (papelera): esta migración NO es compatible con volver a una imagen anterior.
-- Las columnas deleted_at son aditivas y nullable, pero el código antiguo no las filtra:
-- si se hace rollback de la app con filas en la papelera, esos movimientos/aportes/gastos
-- reaparecen en saldos, listados y liquidaciones. Antes de volver a una imagen anterior:
-- vaciar la papelera desde /admin/trash (borrado definitivo).
-- =====================================================================================

-- Backfill (RT8-3): marcar los ingresos que YA son el espejo automático de un aporte por
-- transferencia, con el mismo criterio que isOwnAutoTransferDeposit (un único aporte
-- vinculado, mismo importe y descripción generada por la app). Solo rellena la columna:
-- no toca importes, fechas ni vínculos. Los casos que no encajen (miembro renombrado o
-- descripción editada a mano) quedan a null y simplemente no se arrastran en cascada.
UPDATE "bank_transactions" bt
SET "auto_created_for_contribution_id" = c."id"
FROM "contributions" c
JOIN "users" u ON u."id" = c."member_id"
WHERE bt."id" = c."bank_transaction_id"
  AND c."method" = 'transfer'
  AND (SELECT count(*) FROM "contributions" c2 WHERE c2."bank_transaction_id" = bt."id") = 1
  AND bt."amount_cents" = c."amount_cents"
  AND bt."description" = CASE
    WHEN c."type" = 'quota' THEN 'Cuota ' || c."period" || ' — ' || u."name"
    WHEN c."type" = 'pre_purchase' THEN 'Aporte pre-compra — ' || u."name"
    ELSE 'Aporte extraordinario — ' || u."name"
  END;
