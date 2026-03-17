/**
 * crawler.js — Public Source Data Extractor
 * Uses Puppeteer to fetch roulette history from statistics sites.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const args = process.argv.slice(2);
const getArg = (name, def) => {
    const idx = args.indexOf(name);
    return (idx > -1 && args[idx+1]) ? args[idx+1] : def;
};

// Defaults to Immersive
const TABLE_ID  = getArg('--table', '1');
const TARGET_URL = getArg('--url', 'https://www.casino.org/casinoscores/es/immersive-roulette/');
const API_URL    = getArg('--api', 'http://0.0.0.0:10000/api/spin');
const INTERVAL   = parseInt(getArg('--interval', '15000'));

// Custom Logger to save to separate folders per table
const logDir = path.join(__dirname, 'logs', `table_${TABLE_ID}`);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'bot.log');

const originalLog = console.log;
console.log = function(...args) {
    const msg = `[${new Date().toISOString()}] ` + args.join(' ');
    originalLog(msg);
    fs.appendFileSync(logFile, msg + '\n');
};

const originalError = console.error;
console.error = function(...args) {
    const msg = `[${new Date().toISOString()}] ERROR: ` + args.join(' ');
    originalError(msg);
    fs.appendFileSync(logFile, msg + '\n');
};

let lastKnownTimestamp = null;
let lastKnownNumber = null;

const getExecutablePath = () => {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    return null;
};

async function startScraper() {
    const delay = parseInt(getArg('--delay', '5000'));
    console.log(`⏳ Waiting ${delay/1000}s for API server to stabilize...`);
    await new Promise(r => setTimeout(r, delay));

    console.log(`\n🤖 Starting Public Scraper for Table ${TABLE_ID}...`);
    console.log(`🔗 Target: ${TARGET_URL}`);
    
    const exePath = getExecutablePath();
    if (exePath) console.log(`🚀 Using Browser at: ${exePath}`);

    let browser;
    try {
        // Use internally detected path if env not set
        const finalExePath = exePath || puppeteer.executablePath();
        console.log(`🎬 Launching browser from: ${finalExePath}`);

        browser = await puppeteer.launch({
            headless: true, // Simplified for modern Puppeteer
            executablePath: finalExePath,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions'
            ]
        });
    } catch (e) {
        console.error("❌ Failed to launch browser:", e.message || e);
        return;
    }

    const page = await browser.newPage();
    
    // Block images, css, and fonts to save memory and bypass ad-heavy sites
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        // Block media and styles. Allow scripts just in case the data is rendered by JS/React.
        if (['image', 'stylesheet', 'font', 'media'].includes(type) || req.url().includes('ads')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        console.log("⏳ Navigating to stats page...");
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log("✅ Page loaded. Beginning extraction loop...");

        setInterval(async () => {
            try {
                if (page.isClosed()) return;
                
                // Extract spins from the DOM based on the site structure
                const data = await page.evaluate(() => {
                    let extracted = [];

                    // 1. Try GamblingCounting format
                    const gcNumbers = document.querySelectorAll('.roulette-number');
                    if (gcNumbers && gcNumbers.length > 0) {
                        for (let el of Array.from(gcNumbers).slice(0, 5)) { // Only need recent ones
                            const text = el.innerText.trim();
                            const numMatch = text.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);
                            if (numMatch) {
                                extracted.push({ number: parseInt(numMatch[1]), direction: null, timestamp_str: new Date().toISOString() });
                            }
                        }
                        if (extracted.length > 0) return extracted;
                    }

                    // 2. Try CasinoScores (casino.org) format
                    const csNumbers = document.querySelectorAll('[data-slot="badge"]');
                    if (csNumbers && csNumbers.length > 0) {
                        for (let el of Array.from(csNumbers).slice(0, 5)) {
                            const text = el.innerText.trim();
                            const numMatch = text.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);
                            if (numMatch) {
                                extracted.push({ number: parseInt(numMatch[1]), direction: null, timestamp_str: new Date().toISOString() });
                            }
                        }
                        if (extracted.length > 0) return extracted;
                    }

                    return extracted;
                });

                if (data && data.length > 0) {
                    // Usually the first valid item is the newest
                    const latest = data[0]; 
                    
                    // Prevent duplicate submissions
                    if (latest.timestamp_str !== lastKnownTimestamp || (latest.number !== lastKnownNumber && lastKnownTimestamp === null)) {
                        console.log(`✨ NEW SPIN EXTRACTED -> Number: ${latest.number} | Dir: ${latest.direction} | Time: ${latest.timestamp_str}`);
                        
                        await axios.post(API_URL, {
                            table_id: parseInt(TABLE_ID),
                            number: latest.number,
                            source: 'public_scraper',
                            direction: latest.direction
                        });
                        
                        lastKnownTimestamp = latest.timestamp_str;
                        lastKnownNumber = latest.number;
                    }
                }
            } catch (e) {
                console.error("❌ Extraction Poll Error:", e.message);
            }
        }, INTERVAL);

    } catch (err) {
        console.error("💥 Fatal Bot Error:", err.message);
        await browser.close();
    }
}

startScraper();
