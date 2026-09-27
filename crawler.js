const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const clArgs = process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) acc[arg.slice(2)] = arr[i + 1];
    return acc;
}, {});

const POLL_MS = Number(clArgs.interval || process.env.CRAWLER_INTERVAL_MS || 2000);
const STALE_MS = Number(process.env.CRAWLER_STALE_MS || 120000);
const PORT = process.env.PORT || 3000;
const API_URL = clArgs.api || `http://127.0.0.1:${PORT}/api/spin`;

let TABLE = {
    id: 1,
    name: 'Auto Roulette',
    code: 'AUTO',
    url: 'https://gamblingcounting.com/evolution-auto-roulette'
};

function tableLabel() {
    return `${TABLE.code}#${TABLE.id}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postSpin(number) {
    try {
        await axios.post(API_URL, {
            table_id: TABLE.id,
            number,
            source: 'casino_org_live'
        }, { timeout: 4000 });
        console.log(`[${tableLabel()}] Saved number ${number}`);
        return true;
    } catch (err) {
        const status = err.response ? `HTTP ${err.response.status}` : err.message;
        console.log(`[${tableLabel()}] API save failed for ${number}: ${status}`);
        return false;
    }
}

// Runs inside the browser page. Keep it dependency-free.
async function extractHistory() {
    const toNum = (text) => {
        const n = parseInt((text || '').trim(), 10);
        return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
    };

    // Estrategia Suprema: Extraer directamente de la API de Casino.org usando el token de la sesión activa
    try {
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        let tableEndpoint = 'autoroulette'; // default
        for (const seg of pathSegments) {
            if (seg.includes('roulette')) {
                tableEndpoint = seg.replace(/-/g, '');
            }
        }
        
        const res = await fetch(`https://api-cs.casino.org/svc-evolution-game-events/api/${tableEndpoint}?page=0&size=15&sort=data.settledAt,desc&duration=6`);
        if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
                const apiHistory = json.map(item => item?.data?.result?.outcome?.number)
                                       .filter(n => n !== null && n !== undefined && !isNaN(n));
                if (apiHistory.length >= 5) {
                    return apiHistory;
                } else {
                    return ['API_ERROR: Too few numbers: ' + apiHistory.length];
                }
            } else {
                return ['API_ERROR: Empty json array'];
            }
        } else {
            return ['API_ERROR: Fetch failed with status ' + res.status];
        }
    } catch(e) {
        return ['API_ERROR: Exception ' + e.message];
    }

    // Estrategia 1: Selector especifico para CasinoScores / Casino.org DOM
    try {
        const badges = Array.from(document.querySelectorAll('span[data-slot="badge"]'));
        if (badges.length >= 5) {
            const history = badges.map(el => parseInt(el.innerText || el.textContent)).filter(n => !isNaN(n));
            if (history.length >= 5) return history.slice(0, 15);
        }
    } catch(e) {}

    const readNumberRow = (container) => {
        const children = Array.from(container.children || []);
        if (children.length < 5 || children.length > 30) return [];

        const nums = [];
        let garbageCount = 0;

        for (const child of children) {
            const raw = (child.textContent || '').trim();
            if (!raw) continue;

            if (raw.length <= 3) {
                const value = toNum(raw);
                if (value === null) garbageCount++;
                else nums.push(value);
            } else {
                garbageCount++;
            }
        }

        return nums.length >= 5 && garbageCount <= 4 ? nums : [];
    };

    const labels = ['Historial', 'History', 'Results', 'Last', 'Tiradas', 'Resultados', 'Últimos'];
    for (const label of labels) {
        try {
            const result = document.evaluate(
                `//*[contains(text(),"${label}")]`,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            let block = result.singleNodeValue ? result.singleNodeValue.parentElement : null;

            for (let up = 0; up < 5; up++) {
                if (!block) break;

                const containers = block.querySelectorAll(
                    'div.flex-nowrap, div[class*="overflow-x"], div[class*="history"], ul'
                );

                for (const container of containers) {
                    const nums = readNumberRow(container);
                    if (nums.length >= 5) return nums.slice(0, 10);
                }

                block = block.parentElement;
            }
        } catch (e) {}
    }

    // Estrategia 3: Brute force
    const results = [];
    const elements = document.querySelectorAll('span, div, td, li');
    
    for (const el of elements) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (txt.length > 0 && txt.length <= 2) {
            const n = parseInt(txt);
            if (!isNaN(n) && n >= 0 && n <= 36) {
                results.push(n);
            }
        }
    }

    const finalHistory = results.slice(0, 15);
    return finalHistory.length >= 5 ? finalHistory : [];
}

async function createPage(browser) {
    const page = await browser.newPage();
    
    // Stealth: Ocultar que somos un bot
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });
    page.setDefaultTimeout(60000);

    return page;
}

async function startCrawler() {
    console.log(`[CRAWLER] Starting GamblingCounting scraper for ${TABLE.name}`);
    console.log(`[CRAWLER] Poll interval: ${POLL_MS}ms`);

    // Intentar obtener la mesa configurada del servidor antes de empezar
    try {
        const response = await axios.get(API_URL.replace('/spin', '/tables'), { timeout: 5000 });
        if (response.data && response.data.length > 0) {
            const serverTable = response.data.find(t => t.id == (clArgs.id || 1));
            if (serverTable && serverTable.url) {
                TABLE.url = serverTable.url;
                console.log(`[CRAWLER] URL actualizada desde servidor: ${TABLE.url}`);
            }
        }
    } catch (e) {
        console.log(`[CRAWLER] Usando URL por defecto (Servidor no disponible todavia)`);
    }

    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process',
                '--disable-extensions',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,720'
            ]
        });

        const page = await createPage(browser);
        let lastSent = null;
        let lastDetection = Date.now();
        let isReloading = false;
        let isPolling = false;

        console.log(`[${tableLabel()}] ABRIENDO URL: ${TABLE.url}`);
        try {
            await page.goto(TABLE.url, { waitUntil: 'networkidle2', timeout: 90000 });
        } catch (err) {
            console.log(`[${tableLabel()}] Page load warning: ${err.message}`);
        }

        try {
            console.log(`[${tableLabel()}] Page title: ${await page.title()}`);
        } catch (e) {}

        await sleep(8000);

        const initialHistory = await page.evaluate(extractHistory).catch((err) => {
            console.log(`[${tableLabel()}] eval error: ${err.message}`);
            return [];
        });
        console.log(`[${tableLabel()}] Initial history: [${initialHistory.join(', ')}]`);

        if (initialHistory.length > 0) {
            lastSent = initialHistory[0];
            lastDetection = Date.now();
            await postSpin(lastSent);
        }

        setInterval(async () => {
            if (isPolling || isReloading) return;
            isPolling = true;

            try {
                const history = await page.evaluate(extractHistory);
                if (history && history.length > 0) {
                    const current = history[0];
                    if (current !== lastSent) {
                        console.log(`[${tableLabel()}] New number ${current} | recent [${history.slice(0, 5).join(', ')}]`);
                        const saved = await postSpin(current);
                        if (saved) {
                            lastSent = current;
                            lastDetection = Date.now();
                        }
                    }
                }

                if (Date.now() - lastDetection > STALE_MS) {
                    console.log(`[${tableLabel()}] No fresh numbers for ${Math.round(STALE_MS / 1000)}s. Reloading page.`);
                    isReloading = true;
                    lastDetection = Date.now();
                    lastSent = null;

                    try {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                        await sleep(6000);
                    } catch (err) {
                        console.log(`[${tableLabel()}] Reload failed: ${err.message}`);
                    } finally {
                        isReloading = false;
                    }
                }
            } catch (err) {
                const message = String(err.message || '');
                if (
                    !message.includes('detached') &&
                    !message.includes('context') &&
                    !message.includes('Target closed')
                ) {
                    console.log(`[${tableLabel()}] Read error: ${err.message}`);
                }
            } finally {
                isPolling = false;
            }
        }, POLL_MS);
    } catch (err) {
        console.error(`[CRAWLER] Fatal error: ${err.message}`);
        if (browser) await browser.close().catch(() => {});
        console.log('[CRAWLER] Restarting in 20s...');
        setTimeout(startCrawler, 20000);
    }
}

startCrawler();
