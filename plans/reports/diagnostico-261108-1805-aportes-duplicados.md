# Diagnóstico: aportes duplicados

**Estado:** pendiente de ejecutar contra producción (no hay acceso desde la sesión de desarrollo).

## Hipótesis

Solo las cuotas tienen índice único (miembro + mes). Los aportes `pre_purchase` y `extraordinary` no tienen ninguna restricción, así que se duplican si:

1. **Doble envío**: el formulario no tenía guard explícito contra un segundo envío antes del re-render. Firma: dos filas con `created_at` separados por segundos y el mismo `registered_by`.
2. **Doble registro humano**: el miembro registra su aporte y el admin lo registra también por él. Firma: `registered_by` distinto y `created_at` separados por horas o días.

## Consulta (solo lectura)

```sql
select c.member_id, u.name as miembro, c.type, c.period, c.amount_cents, c.date,
       c.id, c.created_at, r.name as registrado_por, c.method, c.bank_transaction_id,
       c.created_at - lag(c.created_at) over w as separacion
from contributions c
join users u on u.id = c.member_id
join users r on r.id = c.registered_by
where (c.member_id, c.type, coalesce(c.period, ''), c.amount_cents, c.date) in (
  select member_id, type, coalesce(period, ''), amount_cents, date
  from contributions
  group by 1, 2, 3, 4, 5
  having count(*) > 1
)
window w as (partition by c.member_id, c.type, coalesce(c.period, ''), c.amount_cents, c.date order by c.created_at)
order by c.member_id, c.date, c.created_at;
```

La misma información se ve ya en la web, en la tarjeta «Posibles aportes duplicados» de Contribuciones (solo admin), con la hora de registro y quién lo registró.

## Medidas aplicadas (fase 1)

- Aviso 409 `possible_duplicate` al registrar un aporte idéntico; la UI pide «Registrar igualmente».
- Guard explícito contra doble envío en el formulario.
- Listado de duplicados existentes con borrado directo.
