const assert = require('node:assert/strict');
const { buildTrackerReport } = require('./src/engine/tracker_reporting');
const { wheelNeighbors } = require('./src/engine/analytics_snapshot');

const sessions = [
    { _id: 's1', session_no: 1, status: 'closed', final_outcome: 'won', initial_capital: 100, balance: 110, total_spins: 4, wins: 2, losses: 2 },
    { _id: 's2', session_no: 2, status: 'closed', final_outcome: 'lost', initial_capital: 100, balance: 90, total_spins: 3, wins: 0, losses: 3 },
    { _id: 's3', session_no: 3, status: 'active', final_outcome: 'pending', initial_capital: 50, balance: 50, total_spins: 0 }
];
const miss = Array.from({ length: 37 }, (_, number) => number).find(number => !wheelNeighbors(3, 4).includes(number));
const audits = [
    { bankroll_session_id: 's1', bankroll_session_no: 1, spin_id: 100, latest_number: 9, prediction_mode: 'n4', system_center: 3, system_metric_label: 'CW_N4S', system_won: true, ai_center: 3, ai_metric_label: 'CW_N4S', ai_model: 'google/gemini-flash', ai_won: true, analyst_model: 'qwen/qwen3.6-27b', analyst_status: 'complete', analyst_summary: '{"hallazgo":"muestra"}', result_spin_id: 101, result_number: 3 },
    { bankroll_session_id: 's2', bankroll_session_no: 2, spin_id: 100, latest_number: 8, prediction_mode: 'n4', system_center: 15, system_metric_label: 'CCW_N4B', system_won: true, ai_center: 3, ai_metric_label: 'CW_N4S', ai_model: 'google/gemini-flash', ai_won: false, analyst_model: 'qwen/qwen3.6-27b', analyst_status: 'failed', result_spin_id: 101, result_number: miss },
    { bankroll_session_id: 's2', bankroll_session_no: 2, spin_id: 102, latest_number: 12, prediction_mode: 'n4', system_center: 20, system_metric_label: 'CW_N4S', system_won: null, ai_center: 19, ai_metric_label: 'CCW_N4B', ai_model: 'google/gemini-flash', ai_won: null, analyst_model: 'qwen/qwen3.6-27b', analyst_status: 'pending' },
    { bankroll_session_id: 's2', bankroll_session_no: 2, spin_id: 103, latest_number: 14, prediction_mode: 'n9', system_center: 4, system_metric_label: 'CW_N9', ai_center: 4, ai_model: 'google/gemini-flash', analyst_status: 'complete', result_spin_id: 104, result_number: 8 }
];
const entries = [
    { _id: 'e1', session_id: 's1', session_no: 1, spin_key: '1:101', number: 3, context_snapshot: { prediction_mode: 'n4', forecast_base_spin_id: 100, system_center: 3, system_won: true, ai_center: 3, ai_model: 'google/gemini-flash', ai_won: true } },
    { _id: 'e2', session_id: 's2', session_no: 2, spin_key: '1:101', number: miss, context_snapshot: { prediction_mode: 'n4', forecast_base_spin_id: 100, system_center: 15, system_won: true, ai_center: 3, ai_model: 'google/gemini-flash', ai_won: false } }
];

const report = buildTrackerReport({ sessions, audits, entries, window: 'all', mode: 'n4', page: 1, pageSize: 1, wheelNeighbors });
assert.equal(report.session_summary.total, 3);
assert.equal(report.session_summary.won, 1);
assert.equal(report.session_summary.lost, 1);
assert.equal(report.session_summary.active, 1);
assert.equal(report.session_summary.net_profit, 0);
assert.equal(report.prediction_summary.system.forecasts, 3);
assert.equal(report.prediction_summary.system.evaluated, 2);
assert.equal(report.prediction_summary.system.wins, 2);
assert.equal(report.prediction_summary.ai.forecasts, 3);
assert.equal(report.prediction_summary.ai.evaluated, 2);
assert.equal(report.prediction_summary.ai.wins, 1);
assert.equal(report.analyst_summary.complete, 1);
assert.equal(report.analyst_summary.failed, 1);
assert.equal(report.analyst_summary.pending, 1);
assert.equal(report.pagination.total, 3, 'entry and audit rows must deduplicate within a session but never across sessions');
assert.equal(report.pagination.pages, 3);
assert.equal(report.predictions.length, 1);
assert.equal(report.predictions[0].mode, 'n4');
const allN4 = buildTrackerReport({ sessions, audits, entries, window: 'all', mode: 'n4', pageSize: 50, wheelNeighbors });
assert.ok(allN4.predictions.some(prediction => prediction.prediction_review), 'legacy records should get a factual comparison reconstructed from saved centers and result');

const lastTen = buildTrackerReport({ sessions, audits, entries, window: '10', mode: 'all', wheelNeighbors });
assert.equal(lastTen.prediction_summary.by_mode.n4.stored, 3);
assert.equal(lastTen.prediction_summary.by_mode.n9.stored, 1);
const lastOne = buildTrackerReport({ sessions, audits, entries, window: '10', mode: 'n9', wheelNeighbors });
assert.equal(lastOne.pagination.total, 1);
assert.equal(lastOne.predictions[0].mode, 'n9');

console.log('Tracker reporting checks passed.');
