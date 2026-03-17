const fs = require('fs');
const html = fs.readFileSync('dom_dump.html', 'utf8');

// The most recent spins on casino.org usually have numbers 0-36 inside a circular div.
const matches = html.match(/<[^>]+class="[^"]*(spin|number|result|item|recent|history)[^"]*"[^>]*>\s*\d+\s*<\/[^>]+>/gi);
if (matches) {
    console.log("Found matches:");
    matches.slice(0, 5).forEach(m => console.log(m));
} else {
    console.log("No simple matches. Let's try raw regex for numbers inside classes.");
    const numMatches = html.match(/<[a-z]+[^>]+class="[^"]+"[^>]*>\s*([0-9]|[1-2][0-9]|3[0-6])\s*<\/[a-z]+>/gi);
    if (numMatches) {
        console.log("Generic number matches:");
        numMatches.slice(0, 15).forEach(m => console.log(m));
    }
}
