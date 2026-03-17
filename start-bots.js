const concurrently = require('concurrently');

module.exports = function startBots(port) {
    console.log("🚀 Server is live! Starting MYLUCKYROULETTE Automations...");
    console.log("   Mesa 1: Auto Roulette     (casino.org)");
    console.log("   Mesa 2: Immersive Roulette (casino.org)");

    const { result } = concurrently(
      [
        { command: `node crawler.js --table 1 --url "https://www.casino.org/casinoscores/es/auto-roulette/" --interval 12000 --delay 8000 --api http://0.0.0.0:${port}/api/spin`, name: 'BOT-1', prefixColor: 'magenta' },
        { command: `node crawler.js --table 2 --url "https://www.casino.org/casinoscores/es/immersive-roulette/" --interval 15000 --delay 12000 --api http://0.0.0.0:${port}/api/spin`, name: 'BOT-2', prefixColor: 'cyan' }
      ],
      {
        prefix: 'name',
        restartTries: 5,
      }
    );

    result.then(
      () => console.log("✅ All bot processes finished."),
      (err) => console.error("❌ A bot process failed:", err)
    );
};
