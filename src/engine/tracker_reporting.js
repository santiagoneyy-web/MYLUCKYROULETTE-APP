function validCenter(value) {
    const number = value == null || value === '' ? null : Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 36 ? number : null;
}

function validMode(value) {
    return ['n4', 'n9', 'both'].includes(value) ? value : null;
}

function parseSpinId(spinKey) {
    const value = Number(String(spinKey || '').split(':').pop());
    return Number.isInteger(value) && value > 0 ? value : null;
}

function summarizePredictor(records, key, wheelNeighbors) {
    const forecasts = records.filter(record => validCenter(record[key]?.center) !== null);
    const evaluated = forecasts.filter(record => typeof record[key]?.won === 'boolean');
    const wins = evaluated.filter(record => record[key].won).length;
    const losses = evaluated.length - wins;
    return {
        forecasts: forecasts.length,
        evaluated: evaluated.length,
        wins,
        losses,
        pending: forecasts.length - evaluated.length,
        accuracy: evaluated.length ? Math.round(wins / evaluated.length * 1000) / 10 : null,
        models: key === 'ai' ? summarizeModels(forecasts, wheelNeighbors) : undefined
    };
}

function summarizeModels(forecasts) {
    const groups = new Map();
    for (const record of forecasts) {
        const name = record.ai?.model || 'Modelo no identificado';
        const group = groups.get(name) || { model: name, forecasts: 0, evaluated: 0, wins: 0, losses: 0, pending: 0 };
        group.forecasts++;
        if (typeof record.ai?.won === 'boolean') {
            group.evaluated++;
            if (record.ai.won) group.wins++;
            else group.losses++;
        } else group.pending++;
        groups.set(name, group);
    }
    return Array.from(groups.values()).map(group => ({
        ...group,
        accuracy: group.evaluated ? Math.round(group.wins / group.evaluated * 1000) / 10 : null
    })).sort((left, right) => right.forecasts - left.forecasts);
}

const { buildTrackerPredictionReview } = require('./tracker_postmortem');

function buildTrackerReport({ sessions, audits, entries, window = 'all', mode = 'all', page = 1, pageSize = 50, wheelNeighbors, wheelStep }) {
    const orderedSessions = [...sessions].sort((left, right) => Number(right.session_no || 0) - Number(left.session_no || 0));
    const safeWindow = ['10', '20'].includes(String(window)) ? String(window) : 'all';
    const selectedSessions = safeWindow === 'all' ? orderedSessions : orderedSessions.slice(0, Number(safeWindow));
    const selectedIds = new Set(selectedSessions.map(session => String(session._id)));
    const selectedMode = ['n4', 'n9', 'both'].includes(mode) ? mode : 'all';
    const recordsByKey = new Map();

    const makeRecord = (key, sessionId, sessionNo) => ({
        id: key,
        session_id: String(sessionId || ''),
        session_no: Number(sessionNo || 0),
        mode: null,
        forecast_spin_id: null,
        result_spin_id: null,
        base_number: null,
        result_number: null,
        system: { center: null, metric: '', won: null, status: '', reasoning: null },
        system_pattern: { center: null, metric: '', won: null, status: '', reasoning: null },
        last_direction_zone: { center: null, metric: '', won: null, status: '', reasoning: null },
        ai: { center: null, metric: '', model: '', won: null, status: '', reasoning: '' },
        analyst: { model: '', status: '', summary: '', error: '' },
        prediction_review: null,
        created_at: null
    });

    for (const audit of audits) {
        const sessionId = String(audit.bankroll_session_id || '');
        if (!selectedIds.has(sessionId)) continue;
        const resultSpinId = Number(audit.result_spin_id) > 0 ? Number(audit.result_spin_id) : null;
        const forecastSpinId = Number(audit.spin_id) > 0 ? Number(audit.spin_id) : null;
        const recordKey = resultSpinId ? `${sessionId}:result:${resultSpinId}` : `${sessionId}:forecast:${forecastSpinId}`;
        const session = selectedSessions.find(item => String(item._id) === sessionId);
        const record = makeRecord(recordKey, sessionId, audit.bankroll_session_no || session?.session_no);
        record.mode = validMode(audit.prediction_mode);
        record.forecast_spin_id = forecastSpinId;
        record.result_spin_id = resultSpinId;
        record.base_number = audit.latest_number == null ? null : Number(audit.latest_number);
        record.result_number = audit.result_number == null ? null : Number(audit.result_number);
        record.system = {
            center: validCenter(audit.system_center), metric: String(audit.system_metric_label || ''),
            won: typeof audit.system_won === 'boolean' ? audit.system_won : null,
            status: String(audit.system_status || ''), reasoning: audit.system_reasoning || null
        };
        record.system_pattern = {
            center: validCenter(audit.system_pattern_center), metric: String(audit.system_pattern_metric_label || ''),
            won: typeof audit.system_pattern_won === 'boolean' ? audit.system_pattern_won : null,
            status: String(audit.system_pattern_status || ''), reasoning: audit.system_pattern_reasoning || null
        };
        record.last_direction_zone = {
            center: validCenter(audit.last_direction_zone_center), metric: String(audit.last_direction_zone_metric_label || ''),
            won: typeof audit.last_direction_zone_won === 'boolean' ? audit.last_direction_zone_won : null,
            status: String(audit.last_direction_zone_status || ''), reasoning: audit.last_direction_zone_reasoning || null
        };
        record.ai = {
            center: validCenter(audit.ai_center), metric: String(audit.ai_metric_label || ''),
            model: String(audit.ai_model || ''), won: typeof audit.ai_won === 'boolean' ? audit.ai_won : null,
            status: String(audit.ai_status || ''), reasoning: String(audit.ai_reasoning || '')
        };
        record.analyst = {
            model: String(audit.analyst_model || ''), status: String(audit.analyst_status || ''),
            summary: String(audit.analyst_summary || ''), error: String(audit.analyst_error || '')
        };
        record.prediction_review = audit.prediction_review || null;
        record.created_at = audit.audited_at || audit.created_at || null;
        recordsByKey.set(recordKey, record);
    }

    for (const entry of entries) {
        const sessionId = String(entry.session_id || '');
        if (!selectedIds.has(sessionId)) continue;
        const context = entry.context_snapshot || {};
        const resultSpinId = parseSpinId(entry.spin_key);
        const key = resultSpinId ? `${sessionId}:result:${resultSpinId}` : `${sessionId}:entry:${entry._id}`;
        const session = selectedSessions.find(item => String(item._id) === sessionId);
        const record = recordsByKey.get(key) || makeRecord(key, sessionId, entry.session_no || session?.session_no);
        record.mode = record.mode || validMode(context.prediction_mode);
        record.forecast_spin_id = record.forecast_spin_id || (Number(context.forecast_base_spin_id) > 0 ? Number(context.forecast_base_spin_id) : null);
        if (record.base_number == null && Array.isArray(context.history) && context.history.length) {
            const previousNumber = Number(context.history[context.history.length - 1]);
            if (Number.isInteger(previousNumber) && previousNumber >= 0 && previousNumber <= 36) record.base_number = previousNumber;
        }
        record.result_spin_id = record.result_spin_id || resultSpinId;
        record.result_number = record.result_number == null ? Number(entry.number) : record.result_number;
        record.created_at = record.created_at || entry.created_at || null;
        record.system = {
            ...record.system,
            center: record.system.center ?? validCenter(context.system_center),
            metric: record.system.metric || String(context.system_metric_label || ''),
            won: typeof record.system.won === 'boolean' ? record.system.won : typeof context.system_won === 'boolean' ? context.system_won : null,
            status: record.system.status || String(context.system_status || ''),
            reasoning: record.system.reasoning || context.system_reasoning || null
        };
        record.system_pattern = {
            ...record.system_pattern,
            center: record.system_pattern.center ?? validCenter(context.system_pattern_center),
            metric: record.system_pattern.metric || String(context.system_pattern_metric_label || ''),
            won: typeof record.system_pattern.won === 'boolean' ? record.system_pattern.won : typeof context.system_pattern_won === 'boolean' ? context.system_pattern_won : null,
            status: record.system_pattern.status || String(context.system_pattern_status || ''),
            reasoning: record.system_pattern.reasoning || context.system_pattern_reasoning || null
        };
        record.last_direction_zone = {
            ...record.last_direction_zone,
            center: record.last_direction_zone.center ?? validCenter(context.last_direction_zone_center),
            metric: record.last_direction_zone.metric || String(context.last_direction_zone_metric_label || ''),
            won: typeof record.last_direction_zone.won === 'boolean' ? record.last_direction_zone.won : typeof context.last_direction_zone_won === 'boolean' ? context.last_direction_zone_won : null,
            status: record.last_direction_zone.status || String(context.last_direction_zone_status || ''),
            reasoning: record.last_direction_zone.reasoning || context.last_direction_zone_reasoning || null
        };
        record.ai = {
            ...record.ai,
            center: record.ai.center ?? validCenter(context.ai_center),
            metric: record.ai.metric || String(context.ai_metric_label || ''),
            model: record.ai.model || String(context.ai_model || ''),
            won: typeof record.ai.won === 'boolean' ? record.ai.won : typeof context.ai_won === 'boolean' ? context.ai_won : null,
            status: record.ai.status || String(context.ai_status || ''),
            reasoning: record.ai.reasoning || String(context.ai_reasoning || '')
        };
        record.analyst = {
            model: record.analyst.model || String(context.analyst_model || ''),
            status: record.analyst.status || String(context.analyst_status || ''),
            summary: record.analyst.summary || String(context.analyst_summary || ''),
            error: record.analyst.error || ''
        };
        record.prediction_review = record.prediction_review || context.prediction_review || null;
        recordsByKey.set(key, record);
    }

    let records = Array.from(recordsByKey.values()).filter(record => selectedMode === 'all' || record.mode === selectedMode);
    for (const record of records) {
        if (record.result_number == null || typeof wheelNeighbors !== 'function') continue;
        for (const predictor of ['system', 'system_pattern', 'last_direction_zone', 'ai']) {
            if (validCenter(record[predictor].center) === null || typeof record[predictor].won === 'boolean') continue;
            record[predictor].won = wheelNeighbors(record[predictor].center, 4).includes(record.result_number);
        }
        if (!record.prediction_review) {
            record.prediction_review = buildTrackerPredictionReview({
                previousNumber: record.base_number,
                resultNumber: record.result_number,
                systemCenter: record.system.center,
                systemMetric: record.system.metric,
                systemReasoning: record.system.reasoning,
                systemWon: record.system.won,
                aiCenter: record.ai.center,
                aiMetric: record.ai.metric,
                aiModel: record.ai.model,
                aiReasoning: record.ai.reasoning,
                aiWon: record.ai.won,
                actualTransition: typeof wheelStep === 'function' ? wheelStep(record.base_number, record.result_number) : null,
                wheelNeighbors
            });
        }
    }
    records.sort((left, right) => Number(right.result_spin_id || right.forecast_spin_id || 0) - Number(left.result_spin_id || left.forecast_spin_id || 0)
        || right.session_no - left.session_no);

    const closed = selectedSessions.filter(session => session.status === 'closed');
    const sessionSummary = {
        total: selectedSessions.length,
        won: closed.filter(session => session.final_outcome === 'won').length,
        lost: closed.filter(session => session.final_outcome === 'lost').length,
        break_even: closed.filter(session => session.final_outcome === 'break_even').length,
        active: selectedSessions.filter(session => session.status === 'active').length,
        paused: selectedSessions.filter(session => session.status === 'paused').length,
        draft: selectedSessions.filter(session => session.status === 'draft').length,
        closed: closed.length,
        net_profit: Number(selectedSessions.reduce((sum, session) => sum + Number(session.balance || 0) - Number(session.initial_capital || 0), 0).toFixed(2))
    };
    const system = summarizePredictor(records, 'system', wheelNeighbors);
    const system_pattern = summarizePredictor(records, 'system_pattern', wheelNeighbors);
    const last_direction_zone = summarizePredictor(records, 'last_direction_zone', wheelNeighbors);
    const ai = summarizePredictor(records, 'ai', wheelNeighbors);
    const agreement = records.filter(record => validCenter(record.system.center) !== null && validCenter(record.ai.center) !== null);
    const systemVariantsCompared = records.filter(record => validCenter(record.system.center) !== null && validCenter(record.system_pattern.center) !== null);
    const analyst = {
        complete: records.filter(record => record.analyst.status === 'complete').length,
        pending: records.filter(record => record.analyst.status === 'pending').length,
        failed: records.filter(record => record.analyst.status === 'failed').length,
        unavailable: records.filter(record => !record.analyst.status || record.analyst.status === 'unavailable').length
    };
    const modeBreakdown = {};
    for (const key of ['n4', 'n9', 'both', 'unknown']) {
        const group = records.filter(record => (record.mode || 'unknown') === key);
        if (group.length) modeBreakdown[key] = {
            stored: group.length,
            system: summarizePredictor(group, 'system', wheelNeighbors),
            system_pattern: summarizePredictor(group, 'system_pattern', wheelNeighbors),
            last_direction_zone: summarizePredictor(group, 'last_direction_zone', wheelNeighbors),
            ai: summarizePredictor(group, 'ai', wheelNeighbors)
        };
    }
    const pagination = {
        page: Math.max(1, Number.parseInt(page, 10) || 1),
        page_size: Math.max(1, Math.min(100, Number.parseInt(pageSize, 10) || 50)),
        total: records.length
    };
    pagination.pages = Math.max(1, Math.ceil(pagination.total / pagination.page_size));
    pagination.page = Math.min(pagination.page, pagination.pages);
    const offset = (pagination.page - 1) * pagination.page_size;

    return {
        window: safeWindow,
        mode: selectedMode,
        sessions: selectedSessions.map(session => ({
            id: String(session._id), session_no: Number(session.session_no), status: String(session.status),
            predictor: ['ai', 'system_pattern', 'last_direction_zone'].includes(session.predictor) ? session.predictor : 'system',
            final_outcome: String(session.final_outcome || 'pending'),
            initial_capital: Number(session.initial_capital || 0), balance: Number(session.balance || 0),
            net_profit: Number((Number(session.balance || 0) - Number(session.initial_capital || 0)).toFixed(2)),
            total_spins: Number(session.total_spins || 0), wins: Number(session.wins || 0), losses: Number(session.losses || 0),
            starts_at: session.starts_at || session.created_at || null, closed_at: session.closed_at || null
        })),
        session_summary: sessionSummary,
        prediction_summary: { system, system_pattern, last_direction_zone, ai, compared: agreement.length, system_variants_compared: systemVariantsCompared.length, by_mode: modeBreakdown },
        analyst_summary: analyst,
        pagination,
        predictions: records.slice(offset, offset + pagination.page_size)
    };
}

module.exports = { buildTrackerReport };
