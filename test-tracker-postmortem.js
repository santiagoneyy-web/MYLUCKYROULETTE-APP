const assert = require('node:assert/strict');
const { buildTrackerPredictionReview } = require('./src/engine/tracker_postmortem');
const { wheelNeighbors } = require('./src/engine/analytics_snapshot');

const real = 8;
const aiMiss = Array.from({ length: 37 }, (_, number) => number).find(number => !wheelNeighbors(8, 4).includes(number));
const comparison = buildTrackerPredictionReview({
    previousNumber: 22,
    resultNumber: real,
    systemCenter: 8,
    systemMetric: 'CW_N4S',
    systemReasoning: { direction: 'CW', zone_projection: 'BIG', level_projection: 'OVER', direction_pattern: '2-1-2' },
    systemWon: true,
    aiCenter: aiMiss,
    aiMetric: 'CCW_N4B',
    aiModel: 'google/gemini-flash',
    aiReasoning: 'Razonamiento previo de la IA',
    aiWon: false,
    actualTransition: { signed: 12, direction: 'CW', magnitude: 'BIG' },
    wheelNeighbors
});
assert.equal(comparison.comparison, 'system_only_hit');
assert.equal(comparison.result_number, real);
assert.equal(comparison.system.won, true);
assert.equal(comparison.ai.won, false);
assert.equal(comparison.system.axis_checks.length, 3);
assert.ok(comparison.system.axis_checks.every(check => check.matched));
assert.match(comparison.lesson, /SISTEMA acertó e IA falló/);

const aiSuccess = buildTrackerPredictionReview({
    previousNumber: 22, resultNumber: real,
    systemCenter: aiMiss, systemWon: false,
    aiCenter: 8, aiWon: true,
    actualTransition: { signed: -2, direction: 'CCW', magnitude: 'SMALL' }, wheelNeighbors
});
assert.equal(aiSuccess.comparison, 'ai_only_hit');
assert.match(aiSuccess.lesson, /IA acertó y SISTEMA falló/);

const noResult = buildTrackerPredictionReview({ systemCenter: 8, aiCenter: 9, resultNumber: null, wheelNeighbors });
assert.equal(noResult.result_number, null);
assert.equal(noResult.system.won, null);
assert.equal(noResult.ai.won, null);

console.log('Tracker post-result review checks passed.');
