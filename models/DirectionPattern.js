const mongoose = require('mongoose');

const DirectionPatternSchema = new mongoose.Schema({
    table_id: { type: String, required: true },
    
    // La secuencia de direcciones (ej: 'RRLL', 'RLRL', 'RRRR')
    sequence: { type: String, required: true },
    
    // Longitud de la secuencia (4, 5, 6...)
    length: { type: Number, required: true },
    
    // Qué pasó DESPUÉS de esta secuencia
    next_direction: { type: String, enum: ['R', 'L', null], default: null },
    next_magnitude: { type: String, enum: ['B', 'S', null], default: null },
    
    // Números involucrados en la secuencia
    numbers: [{ type: Number }],
    
    // Distancias de los viajes
    distances: [{ type: Number }],
    
    // Contador de ocurrencias (para estadísticas)
    occurrence_count: { type: Number, default: 1 },
    
    // Para patrones simétricos (RRLL es inverso de LLRR)
    reversed_sequence: { type: String },
    is_palindrome: { type: Boolean, default: false },
    
    timestamp: { type: Date, default: Date.now }
});

// Índices para búsqueda rápida
DirectionPatternSchema.index({ table_id: 1, sequence: 1 });
DirectionPatternSchema.index({ table_id: 1, length: 1 });
DirectionPatternSchema.index({ sequence: 1, next_direction: 1 }); // Para estadísticas

module.exports = mongoose.model('DirectionPattern', DirectionPatternSchema);
