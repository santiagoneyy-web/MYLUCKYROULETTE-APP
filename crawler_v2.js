/**
 * crawler_v2.js — Multi-source live roulette data collector
 *
 * Sources:
 *   casinoorg        — Casino.org internal API (HTTP, no browser needed)
 *   gamblingcounting — GamblingCounting.com via Puppeteer DOM scraping
 *
 * Usage:
 *   node crawler_v2.js --source casinoorg
 *   node crawler_v2.js --source gamblingcounting
 *   node crawler_v2.js --source all        (run both in parallel)
 *
 * The API endpoint /api/spin expects: { table_id, number, source, raw_history }
 */

const axios = require('axios');
const https = require('https');

// Agent HTTPS que ignora certificados (solo para desarrollo local)
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// ═══════════════════════════════════════════════════════════════
// Puppeteer — lazy loaded (only used by gamblingcounting mode)
// ═══════════════════════════════════════════════════════════════
let puppeteer = null;
let StealthPlugin = null;
function loadPuppeteer() {
    if (!puppeteer) {
        puppeteer = require('puppeteer-extra');
        StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
    }
    return puppeteer;
}

// ═══════════════════════════════════════════════════════════════
// CLI arguments
// ═══════════════════════════════════════════════════════════════
const clArgs = process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) {
        const val = arr[i + 1];
        if (val && !val.startsWith('--')) acc[arg.slice(2)] = val;
        else acc[arg.slice(2)] = 'true';
    }
    return acc;
}, {});

const PORT          = Number(process.env.PORT) || 3000;
const POLL_MS       = Number(clArgs.interval  || process.env.CRAWLER_INTERVAL_MS || 3000);
const API_URL       = clArgs.api || process.env.API_URL || `http://127.0.0.1:${PORT}/api/spin`;
const SOURCE_ARG    = (clArgs.source || process.env.CRAWLER_SOURCE || 'casinoorg').toLowerCase();

// ═══════════════════════════════════════════════════════════════
// Table definitions
// ═══════════════════════════════════════════════════════════════
const TABLES = {
    casinoorg: {
        name:     'Auto Roulette (Casino.org)',
        code:     'AUTO',
        id:       1,
        source:   'casino_org_live',
        apiUrl:   'https://api-cs.casino.org/svc-evolution-game-events/api/autoroulette',
        pageUrl:  'https://www.casino.org/casinoscores/es/auto-roulette/'
    },
    gamblingcounting: {
        name:     'Auto Roulette (GamblingCounting)',
        code:     'AUTO',
        id:       1,
        source:   'gamblingcounting',
        pageUrl:  'https://gamblingcounting.com/evolution-autod-roulette'
    }
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
    return new Date().toISOString();
}

function log(source, message) {
    console.log(`[${ts()}] [${source}] ${message}`);
}

function logError(source, message) {
    console.error(`[${ts()}] [${source}] ERROR: ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// API: Post a detected spin to the local server
// ═══════════════════════════════════════════════════════════════
async function postSpin(table, number, rawHistory = [], event = {}) {
    try {
        const payload = {
            table_id: table.id,
            number,
            source: table.source,
            raw_history: rawHistory,
            event_id: event.eventId || undefined,
            round_key: event.eventId || undefined,
            observed_at: event.observedAt || new Date().toISOString()
        };

        const response = await axios.post(API_URL, payload, {
            timeout: 8000,
            headers: { 'Content-Type': 'application/json' }
        });

        const status = response.data?.status || 'ok';
        log(table.source, `+ Saved spin #${number} → ${status}`);
        return true;
    } catch (err) {
        const detail = err.response
            ? `HTTP ${err.response.status}`
            : err.message;
        logError(table.source, `Save failed for #${number}: ${detail}`);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// SOURCE A: Casino.org — Pure HTTP API polling (no browser)
// ═══════════════════════════════════════════════════════════════
async function fetchCasinoOrgApi(table, useInsecure = false) {
    try {
        const config = {
            params: {
                page:     0,
                size:     100,
                sort:     'data.settledAt,desc',
                duration: 6
            },
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Origin': 'https://www.casino.org',
                'Referer': 'https://www.casino.org/'
            }
        };
        if (useInsecure) config.httpsAgent = insecureAgent;

        const response = await axios.get(table.apiUrl, config);

        if (Array.isArray(response.data) && response.data.length > 0) {
            const records = response.data
                .map(item => ({
                    number: item?.data?.result?.outcome?.number,
                    eventId: item?.id || item?.data?.id || item?.data?.settledAt,
                    observedAt: item?.data?.settledAt
                }))
                .filter(item => typeof item.number === 'number' && item.number >= 0 && item.number <= 36);
            if (records.length >= 3) return records;
        }
        return null;
    } catch (err) {
        const msg = err.message || '';
        const isSslError = msg.includes('certificate') || msg.includes('TLS') || msg.includes('SSL');
        if (isSslError && !useInsecure) {
            log(table.source, 'SSL error detected, retrying without certificate validation...');
            return fetchCasinoOrgApi(table, true);
        }
        logError(table.source, `API fetch: ${err.response?.status || err.message}`);
        return null;
    }
}

async function runApiCrawler(table) {
    log(table.source, '=== CRAWLER STARTED (API mode) ===');
    log(table.source, `API: ${table.apiUrl}`);
    log(table.source, `Poll: ${POLL_MS}ms`);

    let lastObserved = null;
    const pendingRecords = [];
    const pendingIds = new Set();
    let staleCount = 0;
    const MAX_STALE = 40; // 40 * POLL_MS before reconnect attempt

    while (true) {
        try {
            const records = await fetchCasinoOrgApi(table);

            if (records && records.length > 0) {
                let newlyObserved;
                const observedIndex = records.findIndex(record => record.eventId === lastObserved);
                if (lastObserved === null) {
                    newlyObserved = records.slice(0, 1);
                } else if (observedIndex >= 0) {
                    newlyObserved = records.slice(0, observedIndex).reverse();
                } else {
                    newlyObserved = records.slice().reverse();
                    log(table.source, `Last observed round is outside the source window; ${newlyObserved.length} available rounds will be checked.`);
                }
                lastObserved = records[0].eventId;

                for (const record of newlyObserved) {
                    if (record.eventId && !pendingIds.has(record.eventId)) {
                        pendingRecords.push(record);
                        pendingIds.add(record.eventId);
                    }
                }

                while (pendingRecords.length > 0) {
                    const record = pendingRecords[0];
                    const recent = records.map(item => item.number);
                    log(table.source, `New round ${record.eventId}: #${record.number} | pending=${pendingRecords.length} | recent: [${recent.slice(0,8).join(', ')}]`);
                    const ok = await postSpin(table, record.number, recent.slice(0, 15), record);
                    if (!ok) break;
                    pendingRecords.shift();
                    pendingIds.delete(record.eventId);
                    staleCount = 0;
                }

                if (newlyObserved.length === 0 && pendingRecords.length === 0) {
                    staleCount++;
                    if (staleCount % 10 === 0) {
                        log(table.source, `Waiting for new spin... (stale=${staleCount})`);
                    }
                    if (staleCount >= MAX_STALE) {
                        log(table.source, `No new data for ${MAX_STALE} cycles. Checking connection...`);
                        staleCount = 0;
                    }
                } else if (pendingRecords.length > 0) {
                    log(table.source, `Mongo/API unavailable; keeping ${pendingRecords.length} round(s) queued in memory.`);
                }
            } else {
                log(table.source, 'Empty response. Retrying...');
                await sleep(5000);
            }
        } catch (err) {
            logError(table.source, `Poll error: ${err.message}`);
            await sleep(10000);
        }

        await sleep(POLL_MS);
    }
}

// ═══════════════════════════════════════════════════════════════
// SOURCE B: GamblingCounting — Puppeteer DOM scraping
// ═══════════════════════════════════════════════════════════════

// Extraction script injected into the browser page
const EXTRACT_GC = `
(() => {
    const toNum = (t) => {
        const n = parseInt(String(t || '').trim(), 10);
        return (Number.isInteger(n) && n >= 0 && n <= 36) ? n : null;
    };

    // Strategy 1: Look for elements with history/result related classes
    const classSelectors = [
        '[class*="history"]',
        '[class*="result"]',
        '[class*="numbers"]',
        '[class*="roulette"]',
        '[class*="last"]',
        '[class*="stats"]',
        '[data-testid*="history"]',
        '[data-testid*="result"]'
    ];

    for (const sel of classSelectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
            const nums = [];
            const walk = (node) => {
                for (const child of (node.children || [])) {
                    const txt = (child.textContent || '').trim();
                    if (/^\\d{1,2}$/.test(txt)) {
                        const n = parseInt(txt, 10);
                        if (n >= 0 && n <= 36) nums.push(n);
                    } else if (child.children.length > 0 && child.children.length < 50) {
                        walk(child);
                    }
                }
            };
            walk(el);
            if (nums.length >= 5) return nums.slice(0, 20);
        }
    }

    // Strategy 2: All spans/divs with numeric text in a compact format
    const allElements = document.querySelectorAll('span, div, td, li');
    const nums = [];
    for (const el of allElements) {
        const txt = (el.textContent || '').trim();
        if (/^\\d{1,2}$/.test(txt) && el.children.length === 0) {
            nums.push(parseInt(txt, 10));
        }
    }

    // Filter to roulette-relevant consecutive numbers
    const valid = nums.filter(n => n >= 0 && n <= 36);
    if (valid.length >= 5) return valid.slice(0, 20);

    return [];
})();
`;

async function launchBrowser() {
    const pptr = loadPuppeteer();
    const browser = await pptr.launch({
        headless: true,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720',
            '--single-process'
        ]
    });
    return browser;
}

async function createPage(browser) {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });
    page.setDefaultTimeout(45000);

    return page;
}

async function runBrowserCrawler(table) {
    log(table.source, '=== CRAWLER STARTED (Browser mode) ===');
    log(table.source, `URL: ${table.pageUrl}`);

    let browser = null;
    let page = null;
    let lastSent = null;
    let lastPageLoad = 0;
    const PAGE_RELOAD_INTERVAL = 5 * 60 * 1000; // Reload page every 5 min to keep fresh
    let consecutiveFails = 0;

    async function ensureBrowser() {
        if (!browser || !browser.isConnected()) {
            if (browser) {
                try { await browser.close(); } catch (e) { /* ignore */ }
            }
            browser = await launchBrowser();
        }
    }

    async function ensurePage() {
        await ensureBrowser();
        if (!page || page.isClosed()) {
            page = await createPage(browser);
            log(table.source, `Loading: ${table.pageUrl}`);
            try {
                await page.goto(table.pageUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 90000
                });
            } catch (err) {
                logError(table.source, `Page load warning: ${err.message}`);
            }
            await sleep(8000); // Let dynamic content render
            lastPageLoad = Date.now();
        }
    }

    try {
        await ensurePage();
        log(table.source, `Page loaded: "${await page.title().catch(() => 'N/A')}"`);

        while (true) {
            try {
                // Periodic page refresh to prevent stale content / memory leaks
                if (Date.now() - lastPageLoad > PAGE_RELOAD_INTERVAL) {
                    log(table.source, 'Scheduled page refresh...');
                    try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
                    await sleep(8000);
                    lastPageLoad = Date.now();
                    lastSent = null; // Reset to detect new number
                }

                const numbers = await page.evaluate(EXTRACT_GC);
                consecutiveFails = 0;

                if (numbers && numbers.length >= 3) {
                    const current = numbers[0];

                    if (current !== lastSent) {
                        log(table.source, `New number: ${current} | recent: [${numbers.slice(0,8).join(', ')}]`);
                        const ok = await postSpin(table, current, numbers.slice(0, 15));
                        if (ok) lastSent = current;
                    }
                } else {
                    log(table.source, 'Could not extract numbers. DOM may have changed.');
                    await sleep(POLL_MS);
                }
            } catch (err) {
                consecutiveFails++;
                const msg = String(err.message || '');

                if (
                    msg.includes('detached') ||
                    msg.includes('closed') ||
                    msg.includes('Target') ||
                    msg.includes('Session')
                ) {
                    log(table.source, 'Page/browser disconnected. Reconnecting...');
                    try { page = null; await ensurePage(); } catch (e) {
                        logError(table.source, `Reconnect failed: ${e.message}`);
                        try { browser = null; } catch (_) {}
                    }
                } else {
                    logError(table.source, `Poll error (${consecutiveFails}): ${msg}`);
                }

                if (consecutiveFails >= 10) {
                    log(table.source, 'Too many failures. Full restart...');
                    try { await browser.close(); } catch (e) {}
                    browser = null;
                    page = null;
                    lastSent = null;
                    consecutiveFails = 0;
                    await sleep(15000);
                    await ensurePage();
                }
            }

            await sleep(POLL_MS);
        }
    } catch (err) {
        logError(table.source, `FATAL: ${err.message}`);
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        log(table.source, 'Restarting in 30s...');
        await sleep(30000);
        runBrowserCrawler(table);
    }
}

// ═══════════════════════════════════════════════════════════════
// Main entry — route to the correct crawler
// ═══════════════════════════════════════════════════════════════
async function main() {
    console.log('╔═══════════════════════════════╗');
    console.log('║  ROULETTE-CLASSIC CRAWLER V2 ║');
    console.log('╚═══════════════════════════════╝');
    console.log(`API target: ${API_URL}`);
    console.log(`Poll interval: ${POLL_MS}ms`);
    console.log('');

    if (SOURCE_ARG === 'all') {
        log('MAIN', 'Running ALL sources in parallel...');
        await Promise.all([
            runApiCrawler(TABLES.casinoorg),
            runBrowserCrawler(TABLES.gamblingcounting)
        ]);
    } else if (SOURCE_ARG === 'gamblingcounting') {
        log('MAIN', `Source: GamblingCounting (Browser)`);
        await runBrowserCrawler(TABLES.gamblingcounting);
    } else {
        log('MAIN', `Source: Casino.org (API)`);
        await runApiCrawler(TABLES.casinoorg);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[CRAWLER] Shutting down...');
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\n[CRAWLER] Terminated.');
    process.exit(0);
});

main().catch(err => {
    console.error('[CRAWLER] Fatal startup error:', err.message);
    process.exit(1);
});
