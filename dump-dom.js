const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

async function run() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    try {
        await page.goto('https://www.casino.org/casinoscores/es/immersive-roulette/', { waitUntil: 'networkidle2', timeout: 60000 });
        console.log("Waiting for network idle...");
        // Wait an extra 5 seconds just in case
        await new Promise(res => setTimeout(res, 5000));
        
        const html = await page.evaluate(() => {
            return document.body.innerHTML;
        });
        
        fs.writeFileSync('dom_dump.html', html);
        console.log("DOM dumped successfully");
        
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
}
run();
