const fs = require('fs');
const path = require('path');

const STRATEGY_FILE = path.join(__dirname, 'strategy_library.json');

const DEFAULT_LIBRARY = {
    version: 1,
    updatedAt: '2026-05-10T00:00:00.000Z',
    strategies: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags) {
    const raw = Array.isArray(tags) ? tags : String(tags || '').split(',');
    return [...new Set(raw.map(tag => normalizeText(tag).toLowerCase()).filter(Boolean))];
}

function ensureStore() {
    if (!fs.existsSync(STRATEGY_FILE)) {
        fs.writeFileSync(STRATEGY_FILE, JSON.stringify(DEFAULT_LIBRARY, null, 2));
        return;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'));
        if (!parsed || !Array.isArray(parsed.strategies)) {
            fs.writeFileSync(STRATEGY_FILE, JSON.stringify(DEFAULT_LIBRARY, null, 2));
        }
    } catch (err) {
        fs.writeFileSync(STRATEGY_FILE, JSON.stringify(DEFAULT_LIBRARY, null, 2));
    }
}

function readLibrary() {
    ensureStore();
    try {
        const parsed = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'));
        if (!parsed || !Array.isArray(parsed.strategies)) return clone(DEFAULT_LIBRARY);
        return parsed;
    } catch (err) {
        return clone(DEFAULT_LIBRARY);
    }
}

function writeLibrary(library) {
    const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        strategies: Array.isArray(library?.strategies) ? library.strategies : []
    };
    fs.writeFileSync(STRATEGY_FILE, JSON.stringify(payload, null, 2));
    return payload;
}

function normalizeSource(source) {
    const clean = normalizeText(source).toLowerCase();
    if (clean === 'ai' || clean === 'system') return clean;
    return 'human';
}

function normalizeStatus(status) {
    const clean = normalizeText(status).toLowerCase();
    return clean === 'inactive' ? 'inactive' : 'active';
}

function buildStrategyRecord(input) {
    const name = normalizeText(input?.name);
    const summary = normalizeText(input?.summary || input?.note || input?.description);
    if (!name || !summary) return null;

    const now = new Date().toISOString();
    return {
        id: normalizeText(input?.id) || `strategy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        source: normalizeSource(input?.source),
        origin: normalizeText(input?.origin) || 'manual',
        tableId: normalizeText(input?.tableId) || 'global',
        status: normalizeStatus(input?.status),
        name,
        summary,
        pattern: normalizeText(input?.pattern),
        trigger: normalizeText(input?.trigger),
        action: normalizeText(input?.action),
        tags: normalizeTags(input?.tags),
        createdAt: normalizeText(input?.createdAt) || now,
        updatedAt: now
    };
}

function sameStrategy(a, b) {
    return normalizeText(a?.name).toLowerCase() === normalizeText(b?.name).toLowerCase()
        && normalizeSource(a?.source) === normalizeSource(b?.source)
        && normalizeText(a?.tableId || 'global') === normalizeText(b?.tableId || 'global');
}

function listStrategies(filters = {}) {
    const library = readLibrary();
    const source = normalizeText(filters.source).toLowerCase();
    const tableId = normalizeText(filters.tableId);
    const includeInactive = Boolean(filters.includeInactive);

    return library.strategies
        .filter(item => includeInactive || normalizeStatus(item.status) === 'active')
        .filter(item => !source || normalizeSource(item.source) === source)
        .filter(item => !tableId || normalizeText(item.tableId || 'global') === tableId || normalizeText(item.tableId || 'global') === 'global')
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function saveStrategy(input) {
    const library = readLibrary();
    const record = buildStrategyRecord(input);
    if (!record) {
        return { ok: false, error: 'name and summary are required' };
    }

    const idx = library.strategies.findIndex(existing => sameStrategy(existing, record));
    if (idx >= 0) {
        const current = library.strategies[idx];
        library.strategies[idx] = {
            ...current,
            ...record,
            id: current.id || record.id,
            createdAt: current.createdAt || record.createdAt,
            tags: [...new Set([...(current.tags || []), ...(record.tags || [])])],
            updatedAt: new Date().toISOString()
        };
    } else {
        library.strategies.push(record);
    }

    writeLibrary(library);
    return { ok: true, strategy: idx >= 0 ? library.strategies[idx] : record };
}

function buildPromptDigest(options = {}) {
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 12;
    const strategies = listStrategies({
        source: options.source,
        tableId: options.tableId,
        includeInactive: false
    }).slice(0, limit);

    if (strategies.length === 0) return 'Sin estrategias guardadas.';

    return strategies.map((item, index) => {
        const bits = [
            `${index + 1}. [${String(item.source || 'human').toUpperCase()}] ${item.name}: ${item.summary}`
        ];
        if (item.trigger) bits.push(`trigger=${item.trigger}`);
        if (item.action) bits.push(`action=${item.action}`);
        if (item.pattern) bits.push(`pattern=${item.pattern}`);
        return bits.join(' | ');
    }).join('\n');
}

module.exports = {
    STRATEGY_FILE,
    ensureStore,
    readLibrary,
    listStrategies,
    saveStrategy,
    buildPromptDigest
};
