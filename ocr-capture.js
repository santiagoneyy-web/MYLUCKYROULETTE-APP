// ============================================================
// ocr-capture.js — Auto capture of roulette numbers via OCR
// Usage: node ocr-capture.js --table 1 [--region x,y,w,h] [--interval 4000]
// ============================================================
// HOW IT WORKS:
//   1. Takes a screenshot of a configurable region of your screen
//   2. Crops and preprocesses the image with sharp (contrast, grayscale)
//   3. Runs Tesseract OCR to find numbers 0-36 in the image
//   4. If a new unique number is detected, posts it to the local API
//   5. Repeats every N seconds (default 4s)
// ============================================================

const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('http');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(flag, def) {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const TABLE_ID  = parseInt(getArg('--table', '1'));
const INTERVAL  = parseInt(getArg('--interval', '4000'));
const API_URL   = getArg('--api', 'http://localhost:3000/api/spin');
const REGION    = getArg('--region', '940,642,300,35'); // Calibrated for Betano history on 1366x768 (Maximized)

let regionParts = null;
if (REGION) {
    regionParts = REGION.split(',').map(Number);
    if (regionParts.length !== 4) { console.error('--region must be x,y,w,h'); process.exit(1); }
}

const SCREENSHOT_PATH = path.join(__dirname, '_ocr_tmp.png');
const CROPPED_PATH    = path.join(__dirname, '_ocr_crop.png');

// --- Screenshot using PowerShell / nircmd ---
function takeScreenshot(outputPath) {
    // Uses PowerShell to capture the full screen
    const ps = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height);
$gfx = [System.Drawing.Graphics]::FromImage($bmp);
$gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size);
$bmp.Save('${outputPath.replace(/\\/g, '\\\\')}');
$gfx.Dispose(); $bmp.Dispose();
`;
    execSync(`powershell -Command "${ps.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`);
}

// --- Preprocess image for better OCR ---
async function preprocessImage(input, output) {
    let pipeline = sharp(input);
    if (regionParts) {
        const [left, top, width, height] = regionParts;
        pipeline = pipeline.extract({ left, top, width, height });
    }
    // Scale up for better OCR on small text, then threshold
    await pipeline
        .resize({ width: regionParts ? regionParts[2] * 4 : 2000 }) // 4x scale
        .greyscale()
        .normalize()
        .sharpen({ sigma: 1 })
        .threshold(140)
        .png()
        .toFile(output);
}

// --- Post spin to API ---
function postSpin(number) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ table_id: TABLE_ID, number, source: 'ocr' });
        const url  = new URL(API_URL);
        const req  = https.request({
            hostname: url.hostname,
            port:     url.port || 3000,
            path:     url.pathname,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// --- Extract roulette number from OCR text ---
function extractRouletteNumber(text) {
    // Find all standalone numbers 0-36 in the text
    const matches = text.match(/\b([0-9]|[12][0-9]|3[0-6])\b/g);
    if (!matches) return null;
    
    // In Betano/Olimpo, the newest number is usually on the LEFT.
    // Tesseract reads left-to-right, so the first match is likely the newest.
    // Return the first valid number found.
    return parseInt(matches[0]);
}

// --- Main loop ---
let lastNumber = null;
let consecutiveSame = 0;

async function captureLoop(worker) {
    try {
        takeScreenshot(SCREENSHOT_PATH);
        await preprocessImage(SCREENSHOT_PATH, CROPPED_PATH);

        const { data } = await worker.recognize(CROPPED_PATH);
        const detected = extractRouletteNumber(data.text);

        const ts = new Date().toLocaleTimeString();
        if (detected === null) {
            process.stdout.write(`\r[${ts}] Scanning... (no number detected)     `);
            consecutiveSame = 0;
        } else if (detected === lastNumber) {
            consecutiveSame++;
            process.stdout.write(`\r[${ts}] Same number: ${detected} (stable: ${consecutiveSame}x)      `);
            // If number has been stable for 3+ captures, reset so we can capture it again next change
            if (consecutiveSame >= 3) lastNumber = null;
        } else {
            console.log(`\n[${ts}] ✅ NEW NUMBER DETECTED: ${detected} → Saving to table ${TABLE_ID}...`);
            await postSpin(detected);
            console.log(`[${ts}] ✅ Saved ${detected} to database.`);
            lastNumber = detected;
            consecutiveSame = 0;
        }
    } catch (e) {
        console.error('\n[OCR] Error during capture cycle:', e.message);
    }

    setTimeout(() => captureLoop(worker), INTERVAL);
}

async function main() {
    console.log('🎰 Roulette OCR Auto-Capture');
    console.log(`   Table ID   : ${TABLE_ID}`);
    console.log(`   API URL    : ${API_URL}`);
    console.log(`   Interval   : ${INTERVAL}ms`);
    console.log(`   Region     : ${REGION || 'Full screen'}`);
    console.log('   Press Ctrl+C to stop.\n');
    console.log('⏳ Loading OCR engine...');

    const worker = await createWorker('eng', 1, {
        logger: () => {},
    });
    await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7', // Treat image as single line of text
    });

    console.log('✅ OCR ready. Starting capture loop...\n');
    captureLoop(worker);
}

main().catch(console.error);
