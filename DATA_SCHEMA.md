# ROULETTE-CLASSIC Data Schema v2

Este archivo fija el contrato de datos del proyecto. La idea es que MongoDB sea la base principal y JSON siga funcionando como respaldo local.

## Mesa activa

Por ahora el sistema trabaja con una sola mesa:

- `table_id`: `1`
- `table_code`: `AUTO`
- `name`: `Auto Roulette`
- `source`: `casino.org`

## Colecciones principales

### `tables`

Identifica cada mesa que el sistema puede leer.

- `schema_version`: version del contrato de datos.
- `id`: identificador numerico interno.
- `code`: codigo corto estable, por ejemplo `AUTO`.
- `name`: nombre visible.
- `provider`: proveedor, por ejemplo `Evolution`.
- `url`: fuente real.
- `source_type`: `casino_org`, `manual` o `import`.
- `status`: `active` o `inactive`.

### `spins`

Cada giro real de la ruleta. Esta es la base cruda del big data.

- `schema_version`: version del contrato de datos.
- `id`: identificador global incremental.
- `table_id` y `table_code`: mesa de origen.
- `number`: numero ganador.
- `source`: origen exacto, por ejemplo `casino_org_live`.
- `source_quality`: `live`, `manual`, `batch` o `import`.
- `session_id`: espacio para agrupar sesiones futuras.
- `round_key` y `event_id`: deduplicacion cuando haya ids externos.
- `distance`, `direction`, `sector`: fisica calculada.
- `raw_history`: historial visible al momento de capturar.
- `predictions`: snapshot rapido de agentes internos.
- `results`: evaluacion posterior.
- `observed_at`: momento real observado.
- `ingested_at`: momento en que entro a la base.

### `metricSnapshots`

Foto analitica por giro o ventana. Se genera automaticamente cuando entra un nuevo giro por `/api/spin`.

- `table_id`, `table_code`, `spin_id`.
- `recent_numbers`: ventana usada.
- `dominant_axis`: `direction`, `size` o `none`.
- `dominant_signal`: senal dominante legible.
- `dominance_score`: fuerza de la dominancia.
- `dominance8`, `momentum15`, `performance8`.
- `routes`: rutas CW/CCW y tasas.
- `context`: notas y fuente del calculo.

Endpoint de revision:

- `GET /api/metrics/:tableId?limit=100`

### `aiPredictions`

Prediccion guardada para poder medir si la IA mejora. Se crea automaticamente despues de cada `metricSnapshot` y se resuelve cuando entra el siguiente giro real.

- `basis`: `dominance`, `ai_analysis`, `strategy` o `hybrid`.
- `dominance_priority`: mantiene tu regla: dominancia es el eje principal.
- `mode`, `route`, `zone`, `n9`, `n4`.
- `analysis`: explicacion de la IA.
- `strategy_refs`: estrategias usadas como apoyo.
- `confidence`: confianza numerica.
- `context_snapshot`: foto del contexto que recibio la IA: dominancia, momentum, travel, W/L, rutas, estrategias y memoria RL.
- `decision_source`: origen de la decision (`groq`, `ollama`, `local-dominance`, etc.).
- `prompt_version`: version del prompt/contrato usado para tomar la decision.
- `rl_reward` y `reward_reason`: recompensa estricta usada para aprendizaje posterior.
- `result`: `pending`, `win`, `loss` o `skip`.

Endpoint de revision:

- `GET /api/ai/predictions/:tableId?limit=100`

### `strategies`

Biblioteca central de estrategias humanas y de IA.

- `source`: `human`, `ai` o `system`.
- `priority`: `suggestion`, `support` o `primary`.
- `pattern`, `trigger`, `action`.
- `confidence_weight`.
- `sample_size` y `effectiveness`.
- `last_context`.

## Regla de prioridad actual

La dominancia manda como primer eje. El analisis IA y las estrategias son apoyo contextual mientras la base de datos todavia esta creciendo. Las predicciones automaticas se guardan con `basis=dominance` y `dominance_priority=true`. Cuando haya suficiente muestra, el motor de evaluacion podra subir o bajar el peso de cada estrategia segun efectividad real.
