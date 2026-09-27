const concurrently = require('concurrently');

const port = process.env.PORT || 3000;

console.log('Initializing ROULETTE-CLASSIC data stack...');
console.log(`API on port ${port}. The API process starts the casino.org crawler.`);

const { result } = concurrently(
    [
        { command: 'node server.js', name: 'API', prefixColor: 'blue' }
    ],
    {
        prefix: 'name',
        restartTries: 5
    }
);

result.then(
    () => console.log('All processes finished successfully.'),
    (err) => console.error('A process failed:', err)
);
