const concurrently = require('concurrently');
const path = require('path');

console.log("🚀 Initializing MYLUCKYROULETTE Cloud Stack...");

const { result } = concurrently(
  [
    { command: 'node server.js', name: 'API', prefixColor: 'blue' },
    { command: 'node crawler.js --table 1 --interval 30000', name: 'BOT', prefixColor: 'magenta' }
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
