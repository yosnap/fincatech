# Product Requirements Document (PRD)

## Proyecto: Plataforma de Gestión de Propiedades Compartidas

---

## 1. Resumen Ejecutivo y Objetivos

Este proyecto consiste en una plataforma web unificada (Full-Stack) diseñada para centralizar, automatizar y auditar la administración financiera, operativa y la toma de decisiones de una propiedad adquirida en copropiedad por múltiples personas.

### Objetivos Principales:

* **Transparencia Financiera:** Evitar conflictos mediante el registro exacto de quién paga, quién debe y en qué se gasta el dinero.
* **Automatización de Datos:** Reducir la carga administrativa mediante la lectura inteligente de comprobantes físicos y digitales.
* **Centralización Operativa:** Unificar la toma de decisiones (votaciones), las finanzas (cuentas) y las obligaciones (tareas) en un solo ecosistema.

---

## 2. Arquitectura y Stack Tecnológico

Para garantizar la agilidad en el desarrollo y mantener una base de código cohesionada, el proyecto se construirá bajo una arquitectura **Monolítica Moderna** utilizando un único framework para el Frontend y el Backend.

* **Framework Principal:** **Nuxt.js** (Vue 3) o **Next.js** (React). Se seleccionará uno de los dos para gestionar tanto la interfaz de usuario como la lógica de servidor y API (*Nitro Engine* o *API Routes/Server Actions*).
* **Base de Datos:** Base de datos relacional (**PostgreSQL** o **MySQL** nativo del hosting) para asegurar la integridad transaccional de las deudas y los registros contables.
* **Procesamiento de Documentos (OCR):** Integración con modelos de visión por API (ej. OpenAI o Anthropic) para la extracción estructurada de datos de los tickets y facturas.
* **Canales de Entrada:** Interfaz web adaptativa y Webhooks para la recepción de archivos multimedia a través de Bots (WhatsApp/Telegram).

---

## 3. Roles de Usuario y Permisos

El sistema implementará un control de acceso basado en roles (RBAC) con tres perfiles definidos:

### 3.1. Administrador

* **Alcance:** Control total del sistema.
* **Acciones Exclusivas:**
  * Invitar, editar o dar de baja a miembros de la propiedad.
  * Configurar los porcentajes de participación en los gastos (por defecto divisiones equitativas).
  * Auditar, modificar o eliminar registros contables incorrectos.
  * Cerrar votaciones de presupuestos de forma manual si es necesario.

### 3.2. Propietario (Miembro)

* **Alcance:** Operativo y colaborativo.
* **Acciones:**
  * Registrar gastos (subiendo comprobantes o de forma manual).
  * Subir propuestas de mejora y presupuestos asociados.
  * Votar en las consultas activas.
  * Visualizar su estado de cuenta individual (qué ha pagado y qué debe).
  * Asumir y marcar tareas como completadas.

### 3.3. Invitado (Solo Lectura)

* **Alcance:** Consulta externa, sin capacidad de edición ni voto (ej. gestoría o asesor fiscal externo a la copropiedad).
* **Acciones:**
  * Visualizar totales de la comunidad, histórico de gastos y saldo general.
  * Consultar documentos y comprobantes agregados.
* **Restricciones:**
  * No visualiza el desglose de deuda individual por propietario (dato sensible entre copropietarios).
  * No puede crear ni editar gastos, tareas, ideas, propuestas ni votos.

---

## 4. Requisitos Funcionales (Core Features)

### 4.1. Motor de Captura y Recepción Omnicanal de Gastos

El sistema debe permitir la entrada de gastos mediante tres vías diferenciadas:

```
[Ticket Físico / PDF] ──> Web / Bot (WhatsApp/Telegram) ──> Procesamiento OCR (IA) ┐
                                                                                    ├─> [Validación de Datos] ─> Registro Contable
[Gasto Manual (Sin Ticket)] ────────────────────────────────────────────────────────┘
```

1. **Subida Web Directa:** Interfaz *drag-and-drop* para arrastrar imágenes (JPEG, PNG) o PDFs de facturas.
2. **Integración con Mensajería (WhatsApp/Telegram):** Envío de una foto del ticket al bot de la comunidad. El bot procesará el archivo y devolverá un enlace web para la confirmación del gasto.
3. **Procesamiento OCR Avanzado:** Extracción automática de: *Fecha de emisión, Nombre del emisor/proveedor, Importe total neto, Impuestos y Concepto principal*.
4. **Registro Manual (Modo Contingencia):** Permitir la creación de un gasto sin archivo adjunto (ej. pérdida de ticket o pago rápido en efectivo).
   * *Regla de negocio:* Estos gastos se marcarán visualmente como **"Sin Comprobante"** para su posterior verificación.

### 4.2. Contabilidad, Saldos y Ciclo de Deuda

El motor financiero calculará las cuotas basándose en el principio de división comunitaria.

* **Tratamiento de Gastos:**
  * Un gasto subido por el *Usuario A* indica que el *Usuario A* ya desembolsó ese dinero.
  * El sistema calcula la parte proporcional de los demás usuarios ($N-1$) y la asigna a sus cuentas como **Deuda Pendiente** con el *Usuario A*.

* **Recibos Bancarios y Seguros Cargados:** El sistema permitirá registrar un extracto bancario de un servicio ya cobrado directamente en la cuenta bancaria de la propiedad o de un individuo. Entra al sistema directamente como **Liquidado en origen**, generando las deudas cruzadas de inmediato.
* **Estados del Registro:**
  * `Pendiente`: Gasto validado en la plataforma, pero los copropietarios aún no han aportado su cuota correspondiente.
  * `Pago Parcial`: Algunos miembros ya transfirieron su parte; otros siguen en deuda.
  * `Liquidado / Compensado`: El 100% de los integrantes ha saldado su cuota. El gasto se archiva en el histórico general.

* **Comprobante y Confirmación de Pago:**
  * El sistema **no procesa pagos reales**: las transferencias ocurren fuera de la app (banco, Bizum). La plataforma solo registra y concilia.
  * Al marcar una cuota individual como "Pagada", el propietario **debe adjuntar un comprobante** (imagen o PDF de la transferencia). El estado pasa a `Pendiente de Confirmación`.
  * La confirmación de recepción puede realizarla el **Administrador o el propietario acreedor original** (quien puso el dinero primero) — cualquiera de los dos cierra el ciclo y pasa la cuota a `Confirmado`.
  * Toda confirmación queda auditada con usuario y timestamp (ver sección 5).

### 4.3. Sistema de Presupuestos, Votaciones y Aprobación de Derramas

Mecanismo estructurado para la toma de decisiones económicas importantes (ej. reformas, compras de activos, mantenimiento mayor).

* **Fase de Propuesta:** Un usuario crea una iniciativa (ej. "Instalación de Portero Automático") y añade una descripción.
* **Fase de Cotización:** Los miembros pueden adjuntar diferentes presupuestos (Opciones A, B, C) con sus respectivos precios, condiciones y enlaces/PDFs.
* **Fase de Votación:** Sistema de votación democrática por opciones.
* **Cierre y Ejecución Automática (Derramas):**
  Cuando una opción/presupuesto resulta ganadora (por mayoría o por decisión del administrador):
  1. La propuesta cambia a estado `Aprobada`.
  2. El sistema genera automáticamente una **Derrama Oficial**: el coste total se fragmenta entre todos los copropietarios y se añade a sus paneles de control como una deuda urgente a pagar.
  3. Se genera una **Tarea de Ejecución** vinculada para realizar el seguimiento de la contratación y la obra.

### 4.4. Módulo de Gestión de Tareas (To-Do)

Asignación de responsabilidades de mantenimiento o burocracia de la propiedad.

* Las tareas pueden crearse manualmente o derivarse automáticamente de una votación aprobada.
* Campos requeridos: *Título, Descripción, Miembro Asignado, Fecha Límite, Prioridad*.
* Flujo de estados simple: `Por Hacer` → `En Progreso` → `Completado`.
* **Evidencia Fotográfica:** cada tarea permite adjuntar fotos etiquetadas como "Antes" y "Después" para verificar que el trabajo se completó correctamente (ver 4.6).

### 4.5. Módulo de Ideas (Bandeja Libre)

Espacio para lanzar iniciativas informales, sin presupuesto ni votación formal — distinto del flujo de Propuestas (4.3), que sí implica cotización y votación.

* **Campos:** Título, Descripción, Autor, Fecha.
* **Flujo de estados:** `Nueva` → `En Discusión` → `Promovida a Propuesta` | `Descartada`.
* Cualquier propietario puede comentar una idea para discutirla.
* **Promoción a Propuesta:** un Administrador o el autor puede "promover" una idea madura, generando automáticamente una Propuesta formal (4.3) que hereda título y descripción como punto de partida, quedando enlazada a la idea de origen.

### 4.6. Documentación Fotográfica del Inmueble

* **Galería General:** timeline cronológico de fotos del estado del inmueble, con fecha y autor de la subida — independiente de tareas concretas.
* **Fotos por Tarea:** evidencia "Antes/Después" adjunta directamente a cada tarea (ver 4.4).
* Ambos tipos de fotos viven en un mismo repositorio de medios, filtrable por tarea, fecha o tipo.

### 4.7. Notificaciones

* **Canales:** WhatsApp (reutilizando el bot ya usado para la captura de gastos) y/o email. Cada propietario activa/desactiva canales desde su perfil.
* **Eventos que disparan notificación:**
  * Nueva deuda asignada.
  * Votación abierta.
  * Tarea asignada.
  * Plazo de tarea o de pago próximo a vencer.

### 4.8. Calendario de Uso y Reservas

* Cada propietario puede reservar un rango de fechas para el uso físico del inmueble.
* El sistema bloquea automáticamente fechas ya reservadas por otro propietario, evitando solapes.
* Reservas por orden de llegada, sin aprobación previa ni límites de noches — mantenido simple de forma intencional.

---

## 5. Requisitos No Funcionales (Calidad y Seguridad)

* **Seguridad y Auditoría:** Cada inserción, modificación de gasto o voto debe quedar registrada con un *timestamp* (fecha y hora) y el ID del usuario para evitar manipulaciones de cuentas.
* **Diseño Mobile-First:** Dado que los usuarios subirán tickets desde sus teléfonos en la propia vivienda, la interfaz web debe ser 100% fluida en dispositivos móviles.
* **Integridad Transaccional:** La lógica de división de deudas debe ejecutarse dentro de transacciones de bases de datos para evitar que caídas de red dejen saldos inconsistentes o mal calculados.
* **Exportación Fiscal/Contable:** Exportación de gastos y pagos a PDF/CSV por rango de fechas, para uso de una gestoría externa. *Asunción a confirmar:* es un libro contable simple, no un formato fiscal certificado (ej. Modelo 347 en España); si se necesita un formato regulatorio específico, es un requisito aparte a definir con la gestoría.

---

## 6. Hoja de Ruta Sugerida de Desarrollo (Roadmap)

* **Fase 1 (MVP - Finanzas Básicas):** Autenticación de usuarios, roles (incluye Invitado), creación del libro de contabilidad general, gastos manuales/bancarios con división de deudas, y flujo de comprobante/confirmación de pago.
* **Fase 2 (Automatización e Integraciones):** Módulo OCR (carga web de imágenes), Webhooks para el bot de WhatsApp/Telegram, y Notificaciones (reutilizando el mismo canal del bot).
* **Fase 3 (Gobernanza y Operaciones):** Módulo de Ideas → Propuestas, carga de presupuestos múltiples, sistema de votación, generación automática de derramas y tareas, y evidencia fotográfica Antes/Después por tarea.
* **Fase 4 (Extras Operativos):** Galería general de fotos del inmueble, calendario de uso/reservas, y exportación fiscal/contable.
