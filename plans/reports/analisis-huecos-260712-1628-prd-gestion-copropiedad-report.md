# Informe de Brainstorm: Análisis de Huecos del PRD — Plataforma de Gestión de Propiedades Compartidas

**Fecha:** 2026-07-12
**Fuente analizada:** `docs/prd.md`
**Modo:** Análisis de completitud (gap analysis), no diseño de arquitectura desde cero.

---

## 1. Planteamiento del Problema

El usuario ya tenía un PRD escrito y quería saber si, comparado con su descripción verbal del producto (gestor de gastos/ideas/tareas para copropietarios de una finca, con pagos, recibos OCR, votación de derramas con asignación de tareas, y fotos antes/después del inmueble), algo se había quedado fuera del documento.

## 2. Scout (Estado del Repo)

* Repo recién creado. Único artefacto: `docs/prd.md` (escrito en esta misma sesión).
* Sin código, sin convenciones previas, sin planes en `plans/`.
* No aplica decomposición en sub-proyectos aparte: el propio PRD ya trae un roadmap por fases.

## 3. Huecos Detectados (PRD original vs. descripción verbal)

| Punto pedido por el usuario | Estado en el PRD original |
|---|---|
| Gastos | ✅ Cubierto (4.1, 4.2) |
| Tareas | ✅ Cubierto (4.4) |
| Votación de derramas + asignación de tareas | ✅ Cubierto (4.3) |
| Recibos con OCR + subida manual | ✅ Cubierto (4.1) |
| Ideas | ⚠️ Ambiguo — solo existía "Propuestas" (4.3), ligadas a presupuesto+votación |
| Gestión de pagos | ⚠️ Ambiguo — se calculaban deudas y estados, pero no el mecanismo real de pago/confirmación |
| Fotos antes/después del inmueble | ❌ Ausente por completo |

Adicionalmente se identificaron piezas típicas de este tipo de producto que ni el usuario ni el PRD mencionaban, para descartarlas explícitamente en vez de dejarlas fuera por omisión: notificaciones, rol de solo lectura para terceros, exportación fiscal/contable, calendario de uso/reservas del inmueble.

## 4. Decisiones Tomadas (con el usuario)

| Tema | Decisión |
|---|---|
| Ideas vs Propuestas | Módulo distinto: bandeja de ideas libres, sin presupuesto ni votación, promocionable a Propuesta formal |
| Flujo de pagos | Solo contabilidad manual (no pasarela integrada); el dinero se mueve fuera de la app |
| Comprobante de pago | Obligatorio adjuntar comprobante (imagen/PDF) al marcar "Pagado" |
| Confirmación de recepción de pago | Puede confirmarla el Administrador **o** el propietario acreedor original |
| Fotos antes/después | Ambas: galería general cronológica del inmueble + fotos ligadas a cada Tarea |
| Rol de solo lectura (invitado) | Sí, en alcance. Ve solo agregados, no el desglose de deuda individual por propietario |
| Notificaciones | Sí, en alcance. WhatsApp/email, activables por propietario |
| Exportación fiscal/contable | Sí, en alcance, como export simple PDF/CSV (no formato fiscal certificado — asunción a confirmar con gestoría si aplica) |
| Calendario de uso/reservas | Sí, en alcance. Bloqueo simple de fechas, sin aprobación ni límites |

## 5. Cambios Aplicados a `docs/prd.md`

1. **3.3 Invitado (Solo Lectura)** — nuevo rol, tercer perfil RBAC.
2. **4.2 Contabilidad** — nueva subsección "Comprobante y Confirmación de Pago".
3. **4.4 Tareas** — añadida evidencia fotográfica Antes/Después por tarea.
4. **4.5 Módulo de Ideas (Bandeja Libre)** — nueva sección completa.
5. **4.6 Documentación Fotográfica del Inmueble** — nueva sección completa.
6. **4.7 Notificaciones** — nueva sección completa.
7. **4.8 Calendario de Uso y Reservas** — nueva sección completa.
8. **5. No Funcionales** — añadida nota de Exportación Fiscal/Contable con asunción explícita a confirmar.
9. **6. Roadmap** — reordenado en 4 fases (se añade Fase 4: Extras Operativos) y se distribuyen los módulos nuevos según dependencias (Notificaciones aprovecha el bot de la Fase 2; Ideas/fotos por tarea entran en la Fase 3 de gobernanza; calendario/export van a una Fase 4 de menor urgencia).

## 6. Riesgos e Implicaciones a Vigilar

* **Confirmación de pago por dos actores (Admin + acreedor):** agiliza el flujo pero introduce una carrera de confirmaciones — hay que decidir en fase de diseño técnico si "primero en confirmar gana" o si se registra doble confirmación.
* **Exportación fiscal:** la asunción de "export simple, no certificado" puede no bastar si la gestoría real de la finca pide un formato específico (España: modelos AEAT). Confirmar con quien lleve la contabilidad de la comunidad antes de implementar la Fase 4.
* **Calendario de reservas sin aprobación:** válido para el MVP, pero si el uso real de la finca es conflictivo (muchos propietarios queriendo las mismas fechas), puede necesitar reglas de reparto en una iteración posterior.

## 7. Preguntas Sin Resolver

* ¿Formato exacto de exportación fiscal? (pendiente de confirmar con gestoría, si aplica)
* ¿Se necesita algún límite de tamaño/tipo de archivo para comprobantes y fotos (galería + tareas)? No se abordó, queda para el plan técnico.

## 8. Siguiente Paso

PRD actualizado y aprobado por el usuario. Pendiente decidir si se pasa a `/ck:plan` para planificar la implementación por fases, o si el usuario prefiere seguir refinando el PRD primero.
