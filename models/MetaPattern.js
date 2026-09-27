const mongoose = require('mongoose');

const MetaPatternSchema = new mongoose.Schema({
    table_id: { type: String, required: true },
    
    // Tipo de meta-patrón detectado
    type: { 
        type: String, 
        required: true,
        enum: ['PICO', 'OLA', 'ALTERNADO', 'RODILLO', 'BAMBU', 'TENDENCIA_W', 'TENDENCIA_L']
    },
    
    // La secuencia de W/L que generó la detección
    wl_sequence: { type: String, required: true }, // ej: 'WWLL', 'WWWW', 'WLWL'
    
    // El historial completo de W/L al momento de detección (últimos 6-20)
    full_history: [{ type: String }], // ['W','W','L','W','L','L']
    
    // Números involucrados en el historial (para contexto)
    numbers_history: [{ type: Number }],
    
    // Predicción que hizo el Sniper cuando se detectó este meta-patrón
    sniper_prediction: { type: String, enum: ['WIN', 'LOSS', null], default: null },
    
    // Resultado real del siguiente número
    actual_result: { type: String, enum: ['W', 'L', null], default: null },
    
    // Si la predicción basada en el meta-patrón fue correcta
    prediction_accurate: { type: Boolean, default: null },
    
    // Timestamp de detección
    detected_at: { type: Date, default: Date.now },
    
    // Timestamp cuando se resolvió (llegó el siguiente número)
    resolved_at: { type: Date, default: null }
});

// Índices para consultas rápidas
MetaPatternSchema.index({ table_id: 1, type: 1 });
MetaPatternSchema.index({ table_id: 1, detected_at: -1 });
MetaPatternSchema.index({ type: 1, prediction_accurate: 1 }); // Para ver tasa de acierto por tipo

module.exports = mongoose.model('MetaPattern', MetaPatternSchema);
