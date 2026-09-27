const concurrently = require('concurrently');

module.exports = function startBots(port) {
    const source = process.env.CRAWLER_SOURCE || 'casinoorg';
    const apiUrl = `http://127.0.0.1:${port}/api/spin`;
    console.log("🚀 Server live! Starting Crawler...");
    console.log(`   API URL: ${apiUrl}`);
    console.log(`   Source : ${source}`);

    const crawlerCmd = `node crawler_v2.js --api "${apiUrl}" --source ${source}`;

    const { result } = concurrently(
        [{ command: crawlerCmd, name: 'BOT', prefixColor: 'magenta' }],
        { prefix: 'name', restartTries: 10 }
    );
    result.catch(() => {});
};
