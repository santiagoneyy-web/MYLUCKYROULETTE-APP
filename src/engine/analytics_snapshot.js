const { WHEEL_ORDER, WHEEL_INDEX } = require('./predictor');

function wheelNumberAt(from, offset) {
    const idx = WHEEL_INDEX[from];
    if (idx === undefined) return null;
    return WHEEL_ORDER[(idx + offset + 37 * 2) % 37];
}

function calcDistance(from, to) {
    const i1 = WHEEL_INDEX[from];
    const i2 = WHEEL_INDEX[to];
    if (i1 === undefined || i2 === undefined) return 0;

    let d = i2 - i1;
    if (d > 18) d -= 37;
    if (d < -18) d += 37;
    return d;
}

function wheelNeighbors(num, radius) {
    const idx = WHEEL_INDEX[num];
    if (idx === undefined) return [];

    const result = [];
    for (let i = -radius; i <= radius; i++) {
        result.push(WHEEL_ORDER[(idx + i + 37) % 37]);
    }
    return result;
}

function getRoutes(lastNumber) {
    return {
        cw: {
            n9: wheelNumberAt(lastNumber, 9),
            n4Small: wheelNumberAt(lastNumber, 4),
            n4Big: wheelNumberAt(lastNumber, 14),
            hitRate: 0
        },
        ccw: {
            n9: wheelNumberAt(lastNumber, -9),
            n4Small: wheelNumberAt(lastNumber, -4),
            n4Big: wheelNumberAt(lastNumber, -14),
            hitRate: 0
        },
        small: {
            n9: wheelNumberAt(lastNumber, 0),
            hitRate: 0
        },
        big: {
            n9: wheelNumberAt(lastNumber, 19),
            hitRate: 0
        }
    };
}

function classifyTravel(distance) {
    return {
        dir: distance >= 0 ? 'CW' : 'CCW',
        zone: Math.abs(distance) >= 10 ? 'BIG' : 'SMALL'
    };
}

function buildTravelEvents(history) {
    const events = [];
    for (let i = 1; i < history.length; i++) {
        const distance = calcDistance(history[i - 1], history[i]);
        events.push({
            from: history[i - 1],
            to: history[i],
            distance,
            ...classifyTravel(distance)
        });
    }
    return events;
}

function countWindow(events, size) {
    const sample = events.slice(-size);
    return sample.reduce((acc, event) => {
        acc.cw += event.dir === 'CW' ? 1 : 0;
        acc.ccw += event.dir === 'CCW' ? 1 : 0;
        acc.big += event.zone === 'BIG' ? 1 : 0;
        acc.small += event.zone === 'SMALL' ? 1 : 0;
        return acc;
    }, { cw: 0, ccw: 0, big: 0, small: 0 });
}

function detectPattern(events) {
    const dirs = events.slice(-8).map(e => e.dir === 'CW' ? 'R' : 'L').join('');
    if (!dirs) return { label: 'Cargando historial', stability: 'red' };

    const last4 = dirs.slice(-4);
    const last6 = dirs.slice(-6);
    const last8 = dirs.slice(-8);
    const counts = countWindow(events, 8);
    const maxDir = Math.max(counts.cw, counts.ccw);

    if (/RRRR$/.test(last4) || /LLLL$/.test(last4)) {
        return { label: 'Bloque direccional fuerte', stability: 'green' };
    }
    if (last8 === 'RRLLRRLL' || last8 === 'LLRRLLRR') {
        return { label: 'Ola 2-2 clara', stability: 'green' };
    }
    if (last6 === 'RLRLRL' || last6 === 'LRLRLR') {
        return { label: 'Zigzag perfecto', stability: 'yellow' };
    }
    if (maxDir >= 6) {
        return { label: 'Dominancia direccional', stability: 'green' };
    }
    if (maxDir >= 5) {
        return { label: 'Transicion con ventaja parcial', stability: 'yellow' };
    }
    return { label: 'Mesa mixta', stability: 'red' };
}

function detectDominance(dominance8) {
    const dirDiff = Math.abs(dominance8.cw - dominance8.ccw);
    const zoneDiff = Math.abs(dominance8.big - dominance8.small);

    if (dirDiff === 0 && zoneDiff === 0) {
        return { dominant_axis: 'none', dominant_signal: 'Sin dominancia clara', dominance_score: 0 };
    }

    if (dirDiff >= zoneDiff) {
        const signal = dominance8.cw >= dominance8.ccw ? 'CW' : 'CCW';
        return { dominant_axis: 'direction', dominant_signal: signal, dominance_score: dirDiff };
    }

    const signal = dominance8.big >= dominance8.small ? 'BIG' : 'SMALL';
    return { dominant_axis: 'size', dominant_signal: signal, dominance_score: zoneDiff };
}

function hitInRadius(target, number, radius) {
    if (target === null || number === null) return false;
    return wheelNeighbors(target, radius).includes(number);
}

function getRouteTargets(previousNumber) {
    return {
        cw: {
            n9: wheelNumberAt(previousNumber, 9),
            n4Small: wheelNumberAt(previousNumber, 4),
            n4Big: wheelNumberAt(previousNumber, 14)
        },
        ccw: {
            n9: wheelNumberAt(previousNumber, -9),
            n4Small: wheelNumberAt(previousNumber, -4),
            n4Big: wheelNumberAt(previousNumber, -14)
        },
        small: {
            n9: wheelNumberAt(previousNumber, 0)
        },
        big: {
            n9: wheelNumberAt(previousNumber, 19)
        }
    };
}

function buildPerformance(history, routeKey, targetKey, limit = 8) {
    const marks = [];
    const start = Math.max(1, history.length - limit);

    for (let i = start; i < history.length; i++) {
        const targets = getRouteTargets(history[i - 1]);
        const target = targets[routeKey][targetKey];
        const radius = targetKey === 'n9' ? 9 : 4;
        marks.push(hitInRadius(target, history[i], radius) ? 'W' : 'L');
    }

    return marks.join('');
}

function routeHitRate(history, routeKey, limit = 8) {
    const marks = buildPerformance(history, routeKey, 'n9', limit);
    if (!marks) return 0;
    const wins = marks.split('').filter(x => x === 'W').length;
    return Number(((wins / marks.length) * 100).toFixed(0));
}

function buildMetricSnapshot({ tableId, tableCode = 'AUTO', spinId = null, history, mode = 'AUTO' }) {
    const cleanHistory = (Array.isArray(history) ? history : [])
        .map(n => Number(n))
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 36);

    const lastNumber = cleanHistory[cleanHistory.length - 1];
    const events = buildTravelEvents(cleanHistory);
    const dominance8 = countWindow(events, 8);
    const momentum15 = countWindow(events, 15);
    const pattern = detectPattern(events);
    const dominance = detectDominance(dominance8);
    const routes = getRoutes(lastNumber);

    routes.cw.hitRate = routeHitRate(cleanHistory, 'cw');
    routes.ccw.hitRate = routeHitRate(cleanHistory, 'ccw');

    return {
        table_id: Number(tableId),
        table_code: tableCode,
        spin_id: spinId,
        window_size: Math.min(15, Math.max(0, events.length)),
        recent_numbers: cleanHistory.slice(-15),
        stability_level: pattern.stability,
        pattern_label: pattern.label,
        dominant_axis: dominance.dominant_axis,
        dominant_signal: dominance.dominant_signal,
        dominance_score: dominance.dominance_score,
        dominance8,
        momentum15,
        performance8: {
            cwN9: buildPerformance(cleanHistory, 'cw', 'n9'),
            cwN4: [
                buildPerformance(cleanHistory, 'cw', 'n4Small'),
                buildPerformance(cleanHistory, 'cw', 'n4Big')
            ].join('/'),
            ccwN9: buildPerformance(cleanHistory, 'ccw', 'n9'),
            ccwN4: [
                buildPerformance(cleanHistory, 'ccw', 'n4Small'),
                buildPerformance(cleanHistory, 'ccw', 'n4Big')
            ].join('/'),
            sN9: buildPerformance(cleanHistory, 'small', 'n9'),
            bN9: buildPerformance(cleanHistory, 'big', 'n9')
        },
        routes,
        context: {
            source: 'server_ingest',
            notes: `mode=${mode}; dominance-first snapshot`
        },
        captured_at: new Date().toISOString()
    };
}

function normalizeRouteLabel(routeKey) {
    return routeKey === 'ccw' ? 'CCW' : 'CW';
}

function chooseDominancePrediction(snapshot, spinId = null) {
    if (!snapshot || !snapshot.routes || !snapshot.routes.cw || !snapshot.routes.ccw) {
        return null;
    }

    const dominance8 = snapshot.dominance8 || {};
    const momentum15 = snapshot.momentum15 || {};
    const cw = snapshot.routes.cw;
    const ccw = snapshot.routes.ccw;
    const windowSize = Number(snapshot.window_size || 0);

    const scoreCW = (Number(dominance8.cw) || 0) * 2
        + (Number(momentum15.cw) || 0) * 3
        + (Number(cw.hitRate) || 0) / 10;
    const scoreCCW = (Number(dominance8.ccw) || 0) * 2
        + (Number(momentum15.ccw) || 0) * 3
        + (Number(ccw.hitRate) || 0) / 10;
    const scoreBig = (Number(dominance8.big) || 0) * 2
        + (Number(momentum15.big) || 0) * 3;
    const scoreSmall = (Number(dominance8.small) || 0) * 2
        + (Number(momentum15.small) || 0) * 3;

    const routeKey = scoreCW >= scoreCCW ? 'cw' : 'ccw';
    const zoneKey = scoreBig >= scoreSmall ? 'big' : 'small';
    const route = snapshot.routes[routeKey];
    const routeDiff = Math.abs(scoreCW - scoreCCW);
    const zoneDiff = Math.abs(scoreBig - scoreSmall);
    const stability = String(snapshot.stability_level || 'red').toLowerCase();
    const stabilityBonus = stability === 'green' ? 16 : stability === 'yellow' ? 8 : 0;
    const confidence = Math.min(99, Math.round(35 + stabilityBonus + routeDiff * 2 + zoneDiff * 1.5));

    const shouldSkip = windowSize < 4 || (stability === 'red' && confidence < 58);
    if (shouldSkip) {
        return {
            table_id: snapshot.table_id,
            table_code: snapshot.table_code || 'AUTO',
            spin_id: spinId,
            basis: 'dominance',
            dominance_priority: true,
            mode: 'SAFE',
            route: 'ESPERAR',
            zone: 'ESPERAR',
            n9: 'ESPERAR',
            n4: 'ESPERAR',
            analysis: `Dominancia insuficiente: ${snapshot.pattern_label || 'sin patron claro'}.`,
            strategy_refs: [],
            confidence,
            context_hash: buildContextHash(snapshot),
            result: 'skip',
            n9_result: 'skip',
            n4_result: 'skip',
            created_at: new Date().toISOString()
        };
    }

    return {
        table_id: snapshot.table_id,
        table_code: snapshot.table_code || 'AUTO',
        spin_id: spinId,
        basis: 'dominance',
        dominance_priority: true,
        mode: 'SAFE',
        route: normalizeRouteLabel(routeKey),
        zone: zoneKey === 'big' ? 'BIG' : 'SMALL',
        n9: String(route.n9),
        n4: String(zoneKey === 'big' ? route.n4Big : route.n4Small),
        analysis: [
            `Dominancia ${normalizeRouteLabel(routeKey)} con zona ${zoneKey.toUpperCase()}.`,
            `Patron: ${snapshot.pattern_label || 'sin etiqueta'}.`,
            `Score ruta ${Math.round(Math.max(scoreCW, scoreCCW))}, confianza ${confidence}%.`
        ].join(' '),
        strategy_refs: [],
        confidence,
        context_hash: buildContextHash(snapshot),
        result: 'pending',
        n9_result: 'pending',
        n4_result: 'pending',
        created_at: new Date().toISOString()
    };
}

function buildContextHash(snapshot) {
    const recent = Array.isArray(snapshot.recent_numbers) ? snapshot.recent_numbers.join('-') : '';
    return [
        snapshot.table_code || 'AUTO',
        snapshot.spin_id || 'na',
        snapshot.stability_level || 'na',
        snapshot.dominant_signal || 'na',
        recent
    ].join('|');
}

function getRunInfo(events, extractor) {
    let current = 0;
    let previous = 0;
    let currentValue = null;
    let previousValue = null;

    for (let i = events.length - 1; i >= 0; i--) {
        const value = extractor(events[i]);
        if (currentValue === null) {
            currentValue = value;
            current = 1;
            continue;
        }
        if (value === currentValue) {
            current++;
            continue;
        }
        previousValue = value;
        previous = 1;
        for (let j = i - 1; j >= 0; j--) {
            const prev = extractor(events[j]);
            if (prev !== previousValue) break;
            previous++;
        }
        break;
    }

    return { current, previous, currentValue, previousValue };
}

function classifyTurbulence(dirRun, zoneRun) {
    const shortestRun = Math.min(dirRun.current || 0, zoneRun.current || 0);
    if (!shortestRun) return { level: 'none', size: 0 };
    if (shortestRun <= 1) return { level: 'micro', size: shortestRun };
    if (shortestRun === 2) return { level: 'short', size: shortestRun };
    if (shortestRun <= 4) return { level: 'medium', size: shortestRun };
    return { level: 'large', size: shortestRun };
}

function buildTableStateSnapshot({ metricSnapshot, tableId, tableCode = 'AUTO', spinId = null }) {
    if (!metricSnapshot) return null;

    const recentNumbers = Array.isArray(metricSnapshot.recent_numbers) ? metricSnapshot.recent_numbers : [];
    const events = buildTravelEvents(recentNumbers);
    const dirRun = getRunInfo(events, event => event.dir);
    const zoneRun = getRunInfo(events, event => event.zone);
    const turbulence = classifyTurbulence(dirRun, zoneRun);
    const VALID_DOMINANCE_SIDES = ['CW', 'CCW', 'BIG', 'SMALL', 'NONE'];
    const rawSide = String(metricSnapshot.dominant_signal || 'NONE').toUpperCase();
    const dominantSide = VALID_DOMINANCE_SIDES.includes(rawSide) ? rawSide : 'NONE';
    const dominanceStrength = Number(metricSnapshot.dominance_score || 0);

    let dominanceState = 'none';
    if (dominanceStrength >= 5) dominanceState = 'strong';
    else if (dominanceStrength >= 3) dominanceState = 'forming';
    else if (dominanceStrength > 0) dominanceState = 'breaking';

    let blockState = 'none';
    if ((dirRun.current || 0) >= 4 || (zoneRun.current || 0) >= 4) blockState = 'active';
    else if ((dirRun.current || 0) >= 2 || (zoneRun.current || 0) >= 2) blockState = 'forming';

    let dominanceFatigue = 0;
    if (dominanceState === 'strong') {
        dominanceFatigue = Math.max(0, (dirRun.current || 0) + (zoneRun.current || 0) - 6);
        if (dominanceFatigue >= 3) dominanceState = 'tired';
    }

    let farolState = 'none';
    let farolSide = 'NONE';
    if (
        dominanceStrength >= 4 &&
        dirRun.previousValue &&
        dirRun.currentValue &&
        dirRun.previousValue !== dirRun.currentValue &&
        (dirRun.current || 0) <= 2 &&
        (dirRun.previous || 0) >= 3
    ) {
        farolState = 'suspected';
        farolSide = dirRun.currentValue;
    }
    if (
        dominanceStrength >= 4 &&
        zoneRun.previousValue &&
        zoneRun.currentValue &&
        zoneRun.previousValue !== zoneRun.currentValue &&
        (zoneRun.current || 0) <= 3 &&
        (zoneRun.previous || 0) >= 4
    ) {
        farolState = farolState === 'suspected' ? 'active' : 'suspected';
        farolSide = zoneRun.currentValue;
    }

    let reversalRisk = 'low';
    if (dominanceState === 'tired' || farolState === 'suspected') reversalRisk = 'medium';
    if (farolState === 'active' || turbulence.level === 'large') reversalRisk = 'high';

    if (dominanceState === 'breaking' && reversalRisk !== 'low') {
        dominanceState = 'reversing';
    }
    if (blockState === 'active' && turbulence.level === 'large') {
        blockState = 'broken';
    } else if (blockState === 'active' && turbulence.level === 'medium') {
        blockState = 'weakening';
    }

    const continuationBias = dominanceState === 'strong' || dominanceState === 'forming'
        ? dominantSide
        : 'NONE';

    const interpretation = [
        `Dominancia ${dominanceState} en ${dominantSide}.`,
        `Bloque ${blockState} (${Math.max(dirRun.current || 0, zoneRun.current || 0)}t).`,
        `Turbulencia ${turbulence.level}.`,
        farolState !== 'none' ? `Farol ${farolState} en ${farolSide}.` : 'Sin farol claro.',
        `Riesgo de rebote ${reversalRisk}.`
    ].join(' ');

    return {
        table_id: Number(tableId),
        table_code: tableCode,
        spin_id: spinId,
        metric_snapshot_id: metricSnapshot.id || null,
        recent_numbers: recentNumbers,
        block_state: blockState,
        block_size: Math.max(dirRun.current || 0, zoneRun.current || 0),
        turbulence_level: turbulence.level,
        turbulence_size: turbulence.size,
        dominance_state: dominanceState,
        dominance_side: dominantSide,
        dominance_strength: dominanceStrength,
        dominance_fatigue: dominanceFatigue,
        farol_state: farolState,
        farol_side: farolSide === 'NONE' ? 'NONE' : String(farolSide).toUpperCase(),
        continuation_bias: continuationBias,
        reversal_risk: reversalRisk,
        color_state: metricSnapshot.stability_level || 'red',
        interpretation,
        created_at: new Date().toISOString()
    };
}

function evaluatePredictionHit(prediction, resolvedNumber) {
    if (!prediction || prediction.result === 'skip') {
        return { result: 'skip', n9_result: 'skip', n4_result: 'skip' };
    }
    const n9 = Number(prediction.n9);
    const n4 = Number(prediction.n4);
    const number = Number(resolvedNumber);
    if (!Number.isInteger(number) || number < 0 || number > 36) {
        return { result: 'pending', n9_result: 'pending', n4_result: 'pending' };
    }

    const n9Hit = Number.isInteger(n9) && hitInRadius(n9, number, 9);
    const n4Hit = Number.isInteger(n4) && hitInRadius(n4, number, 4);
    const n9Result = !Number.isInteger(n9) || prediction.n9 === 'ESPERAR' ? 'skip' : (n9Hit ? 'win' : 'loss');
    const n4Result = !Number.isInteger(n4) || prediction.n4 === 'ESPERAR' ? 'skip' : (n4Hit ? 'win' : 'loss');
    const overall = (n9Result === 'win' || n4Result === 'win')
        ? 'win'
        : (n9Result === 'skip' && n4Result === 'skip' ? 'skip' : 'loss');

    return {
        result: overall,
        n9_result: n9Result,
        n4_result: n4Result
    };
}

module.exports = {
    buildMetricSnapshot,
    buildTableStateSnapshot,
    chooseDominancePrediction,
    evaluatePredictionHit,
    calcDistance,
    wheelNumberAt,
    wheelNeighbors
};
