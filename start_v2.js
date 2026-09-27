/**
 * start_v2.js — Launch server + dual crawlers concurrently
 *
 * Starts:
 *   1. server.js      — Express API on PORT (default 3000)
 *   2. crawler_v2.js  — Casino.org API crawler
 *   3. crawler_v2.js  — GamblingCounting browser crawler
 *
 * Usage:
 *   node start_v2.js
 *   npm run stack:v2
 */

const concurrently = require('concurrently');

const port = process.env.PORT || 3000;

console.log('╔══════════════════════════════════════╗');
console.log('║   ROULETTE-CLASSIC V2 STACK         ║');
console.log('╚══════════════════════════════════════╝');
console.log(`API: http://127.0.0.1:${port}`);
console.log('Crawlers: Casino.org (API) + GamblingCounting (Browser)');
console.log('');

concurrently([
    {
        command: 'node server.js',
        name: 'API',
        prefixColor: 'blue'
    },
    {
        command: 'node crawler_v2.js --source casinoorg --interval 3000',
        name: 'CASINO-ORG',
        prefixColor: 'green'
    },
    {
        command: 'node crawler_v2.js --source gamblingcounting --interval 4000',
        name: 'GAMBLING-COUNT',
        prefixColor: 'yellow'
    }
], {
    prefix: 'name',
    killOthers: ['failure', 'success'],
    restartTries: 5
}).catch(err => {
    console.error('Error starting services:', err);
    process.exit(1);
});
