# ROULETTE-CLASSIC Roadmap

## Vision

Una web que:

- captura resultados reales de ruleta desde `casino.org`
- guarda big data en `JSON + Mongo`
- calcula metricas, travel, dominancia, momentum y patrones
- genera predicciones automaticas con IA
- mantiene una biblioteca central de estrategias humanas y de IA
- aprende con el tiempo evaluando efectividad real
- controla acceso por codigo con rol `master` y rol `member`

## What Already Exists

- API Express con historial, spins, SSE y endpoints base
- crawler DOM para `casino.org` en `crawler.js`
- fallback JSON operativo en `roulette_db.json`
- modelos Mongo iniciales de `Spin`, `Table`, `Pattern`, `ExpertRule`
- predictor automatico y chat IA
- biblioteca central de estrategias en `strategy_library.json`

## Data Layers

### Current active layers

- `roulette_db.json`: fallback local
- `strategy_library.json`: biblioteca central de estrategias
- modelos Mongo: listos para base de datos persistente

### Core entities

- `tables`
- `spins`
- `patterns`
- `expertRules`
- `users`
- `strategies`
- `metricSnapshots`
- `aiPredictions`

## Implemented Components

- API Express con historial, spins, SSE y endpoints de analisis.
- `crawler_v2.js` soporta Casino.org y puede iniciarse desde `start-bots.js` al arrancar el servidor. El inicio automatico se puede desactivar con `DISABLE_BOTS=true`.
- `database.js` usa MongoDB cuando `MONGODB_URI` conecta; si no, usa `roulette_db.json` como almacenamiento de respaldo.
- El endpoint `POST /api/spin` recibe giros, evita duplicados consecutivos y procesa persistencia, metricas y predicciones.
- El flujo de IA construye contexto, selecciona un proveedor configurado, aplica prompts por modo y guarda predicciones con `prompt_version`.
- Los modelos y endpoints para revisar metricas, predicciones y evaluacion ya existen.

La existencia de estas piezas en el codigo no confirma por si sola que la fuente, la configuracion de base de datos y el proveedor de IA esten funcionando correctamente en el entorno desplegado.

## Scope: Tracker Live

El flujo principal del trabajo es el modo Tracker de la pantalla. Dentro del Tracker, `MANUAL` y `LIVE` son fuentes separadas: MANUAL contiene solo entradas del usuario y LIVE contiene solo giros recibidos del historial del servidor. Cambiar de fuente cambia el historial visible sin mezclar ni borrar el otro.

Esta separacion ya esta implementada en el cliente: el historial manual se conserva en `localStorage`, el historial Live se resincroniza desde la mesa activa y limpiar el Tracker en MANUAL no borra giros del servidor.

Flujo esperado:

`crawler_v2.js` -> `POST /api/spin` -> MongoDB (o JSON fallback) -> SSE `/api/events/:tableId` -> historial Live del navegador -> Tracker Live -> analisis IA -> evaluacion con el siguiente giro.

## Verification Roadmap

1. Verify Tracker Live ingestion
- iniciar el servidor y confirmar que arranca `crawler_v2.js` con la fuente `casinoorg`.
- confirmar que el crawler recibe numeros actuales validos y los envia a `POST /api/spin` para la mesa elegida.
- comprobar que el servidor persiste el giro y emite `new_spin` por SSE.
- con `Modo Tracker > LIVE` seleccionado, comprobar que cada giro nuevo aparece una sola vez en el historial, grafico y estado del Tracker.
- al reconectar o recargar, verificar que el historial se resincroniza sin perder ni duplicar giros.

2. Verify Tracker database source
- confirmar que MongoDB esta conectado si es la base objetivo; identificar claramente cuando se usa `roulette_db.json` como fallback.
- comprobar que los giros que muestra Tracker coinciden con `/api/history/:tableId` y la coleccion `spins`.
- comprobar que el contexto analitico usa la misma mesa e historial que Tracker Live.

3. Connect and verify Tracker AI analysis
- revisar el endpoint `/api/ai/tracker`: actualmente recibe prompt e historial preparados en el navegador. Conectarlo para que el servidor complete/valide el contexto con historial y metricas persistidas de la mesa antes de llamar al proveedor.
- versionar el prompt de Tracker y registrar proveedor, modo, ventana de datos y respuesta para poder auditar cada analisis.
- probar `ANALIZAR AHORA` y `AUTO BET` por separado; confirmar que el primero analiza bajo demanda y el segundo solo cuando esta activado.
- verificar respuestas validas, errores de proveedor, limites y ausencia de datos suficientes.

4. Build a reliable Tracker learning dataset
- guardar cada analisis/prediccion del Tracker con fuente (`live` o `manual`), mesa, timestamp, ventana de numeros usada, prompt versionado, proveedor/modelo, modo N9/N4, targets, confianza y respuesta original.
- al llegar el siguiente giro real, resolver el acierto con la regla exacta de N9/N4 y vecinos; mantener predicciones `pending` hasta tener resultado observable.
- excluir del entrenamiento datos incompletos, duplicados, generados en pruebas o analizados despues del resultado.
- mantener separados los datos Live y Manual; usar Live para evaluar el rendimiento en operacion y Manual para pruebas controladas.

5. Evaluate before training or changing prompts
- comparar el Tracker y cada prompt/modelo contra una linea base aleatoria apropiada y contra la tasa teorica, usando evaluacion cronologica fuera de muestra.
- informar tamano de muestra, aciertos, tasa de acierto e incertidumbre; no optimizar solo sobre los mismos giros usados para ajustar.
- primero ajustar prompt, variables y calibracion con resultados medidos. Considerar fine-tuning solo si existe un conjunto grande, limpio y etiquetado y una mejora repetible frente a la linea base.
- mantener el sistema en modo de observacion durante la evaluacion; no convertir una prediccion en apuesta automatica por el solo hecho de que la IA la produjo.

6. Defer broader product work
- biblioteca de estrategias, roles, poderes de chat master y paneles administrativos quedan despues de completar y validar Tracker Live.

## Immediate Next Step

Validar primero el aislamiento MANUAL/LIVE y el recorrido de Tracker Live con evidencia en cada etapa: crawler -> API -> persistencia -> SSE -> historial/grafico del Tracker. Luego conectar el endpoint de IA a ese historial persistido y empezar a guardar predicciones junto con sus resultados reales; esa sera la base para evaluar y entrenar de forma responsable.
