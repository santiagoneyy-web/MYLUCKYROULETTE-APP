const concurrently = require('concurrently');
const path = require('path');

console.log("🚀 Initializing MYLUCKYROULETTE Cloud Stack...");

const port = process.env.PORT || 3000;

const { result } = concurrently(
  [
    { command: 'node server.js', name: 'API', prefixColor: 'blue' },
    { command: `node crawler.js --table 1 --url "https://www.betano.pe/casino/live/games/immersive-roulette-deluxe/23563/tables/" --interval 30000 --api http://0.0.0.0:${port}/api/spin`, name: 'BOT-1', prefixColor: 'magenta' },
    { command: `node crawler.js --table 2 --url "https://www.olimpo.bet/casino-en-vivo?machine=5002830" --interval 35000 --api http://0.0.0.0:${port}/api/spin`, name: 'BOT-2', prefixColor: 'cyan' }
  ],
  {
    prefix: 'name',
    killOthers: ['failure', 'success'],
    restartTries: 3,
  }
);

result.then(
  () => console.log("✅ All processes finished successfully."),
  (err) => console.error("❌ A process failed:", err)
);
