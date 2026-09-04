const fs = require('fs');
const path = 'D:/Desktop/py/amazon-ai-ops/amazon-ai-ops-autonomy-prototype/src/App.jsx';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('export default')) {
    console.log((i + 1) + ': ' + l);
    // Print surrounding lines
    for (let j = Math.max(0, i - 3); j < Math.min(lines.length, i + 5); j++) {
      console.log((j + 1) + ': ' + lines[j]);
    }
  }
});
