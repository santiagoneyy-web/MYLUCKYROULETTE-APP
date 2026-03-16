/**
 * crawler.js — Background Headless Scraper
 * Uses Puppeteer to fetch roulette history without a physical display.
 * Run: node crawler.js --table 1 --url "CASINO_URL"
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const { setTimeout } = require('timers/promises');

puppeteer.use(StealthPlugin());

const args = process.argv.slice(2);
const getArg = (name, def) => {
    const idx = args.indexOf(name);
    return (idx > -1 && args[idx+1]) ? args[idx+1] : def;
};

const TABLE_ID  = getArg('--table', '1');
const TARGET_URL = getArg('--url', 'https://www.betano.pe/casino/live/games/immersive-roulette-deluxe/23563/tables/');
const API_URL    = getArg('--api', 'http://localhost:3000/api/spin');
const INTERVAL   = parseInt(getArg('--interval', '10000')); // Check every 10s

let lastNum = null;

// Render/Cloud sometimes needs a specific path or uses chromium-browser
const getExecutablePath = () => {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    if (process.platform === 'linux') return '/usr/bin/chromium-browser'; // Common on Ubuntu VPS
    return null; // Let puppeteer decide on Windows/Mac
};

async function startScraper() {
    console.log(`\n🤖 Starting Cloud Bot for Table ${TABLE_ID}...`);
    console.log(`🔗 Target: ${TARGET_URL}`);
    
    const exePath = getExecutablePath();
    if (exePath) console.log(`🚀 Using Browser at: ${exePath}`);

    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: exePath || undefined,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log("⏳ Navigating to casino...");
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log("✅ Page loaded. Waiting for game UI...");
        
        // Wait for potential iframe or game container
        await setTimeout(10000); 

        // Evolution/Betano often uses nested iframes for the game
        const findFrame = async (page) => {
            const frames = page.frames();
            for (const f of frames) {
                if (f.url().includes('evolution') || f.url().includes('pragmatic')) return f;
            }
            return page;
        };

        setInterval(async () => {
            try {
                const target = await findFrame(page);
                const data = await target.evaluate(() => {
                    // Optimized selector for Roulette History (Common in Evo/Pragmatic)
                    const elements = Array.from(document.querySelectorAll('[data-tester="history-item"], [class*="recent-number"], [class*="history-number"]'));
                    if (elements.length > 0) {
                        return elements.map(el => {
                            const n = parseInt(el.innerText);
                            return (n >= 0 && n <= 36) ? n : null;
                        }).filter(v => v !== null);
                    }
                    
                    // Fallback: search all small text blocks
                    const allText = document.body.innerText;
                    const matches = allText.match(/\b([0-9]|[12][0-9]|3[0-6])\b/g);
                    return matches ? matches.map(Number) : [];
                });

                if (data && data.length > 0) {
                    const latest = data[0]; 
                    if (latest !== lastNum && lastNum !== null) {
                        console.log(`✨ DETECTED NEW NUMBER: ${latest}`);
                        await axios.post(API_URL, {
                            table_id: TABLE_ID,
                            number: latest,
                            source: 'bot'
                        });
                    }
                    lastNum = latest; // Update tracking
                }
            } catch (e) {
                console.error("❌ Bot Poll Error:", e.message);
            }
        }, INTERVAL);

    } catch (err) {
        console.error("💥 Fatal Error:", err.message);
        await browser.close();
    }
}

startScraper();
