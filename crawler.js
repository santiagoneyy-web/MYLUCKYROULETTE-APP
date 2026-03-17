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
    console.log(`\n🤖 Starting Public Scraper for Table ${TABLE_ID}...`);
    console.log(`🔗 Target: ${TARGET_URL}`);
    
    const exePath = getExecutablePath();
    if (exePath) console.log(`🚀 Using Browser at: ${exePath}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: exePath || undefined,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--single-process',
                '--no-zygote'
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
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log("✅ Page loaded. Beginning extraction loop...");

        setInterval(async () => {
            try {
                // Extract spins from the DOM
                const data = await page.evaluate(() => {
                    const rowElements = Array.from(document.querySelectorAll('tr, .row, .spin-item, [class*="history"]'));
                    let extracted = [];
                    
                    for (let el of rowElements) {
                        const text = el.innerText.trim().toLowerCase();
                        
                        // Look for a number between 0 and 36
                        const numMatch = text.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);
                        if (!numMatch) continue;
                        
                        const number = parseInt(numMatch[1]);
                        
                        // Look for direction (CW=Clockwise/Derecha, CCW=CounterClockwise/Izquierda)
                        let direction = null;
                        if (text.includes('cw') || text.includes('right') || text.includes('der') || text.includes('clock')) {
                            direction = 'CW';
                        } else if (text.includes('ccw') || text.includes('left') || text.includes('izq') || text.includes('counter')) {
                            direction = 'CCW';
                        }

                        // Try to find a time/timestamp like "14:23" or "2 mins ago"
                        let timestamp = new Date().toISOString(); 
                        const timeMatch = text.match(/\b\d{1,2}:\d{2}(:\d{2})?\b/);
                        if (timeMatch) {
                            timestamp = timeMatch[0]; // just grab the string for now to use as unique id
                        }

                        extracted.push({ number, direction, timestamp_str: timestamp });
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
