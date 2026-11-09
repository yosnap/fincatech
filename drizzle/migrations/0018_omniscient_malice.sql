ALTER TABLE "expenses" ADD COLUMN "expense_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_expense_date_idx" ON "expenses" USING btree ("expense_date");

-- =====================================================================================
-- Fase 3 (fecha de gasto). Columna aditiva con default, compatible con un rollback de la app
-- (el código anterior la ignora y sigue usando created_at).
--
-- Backfill (RT-11): la fecha del gasto de los registros históricos es la de alta, calculada
-- en la zona horaria de la finca. Sin esto, un gasto creado entre las 00:00 y las 02:00 de
-- Madrid (que en UTC es el día anterior) aparecería fechado un día antes.
-- =====================================================================================
UPDATE "expenses"
SET "expense_date" = ("created_at" AT TIME ZONE 'Europe/Madrid')::date;
