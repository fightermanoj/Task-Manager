// Structural check on a stylesheet: brace balance, and var() references that no
// rule ever defines, plus tokens defined but never used.
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let depth = 0, underflows = 0;
for (const ch of css) {
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) { underflows++; depth = 0; } }
}

const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]));

const undefinedVars = [...used].filter(v => !defined.has(v)).sort();
const unusedVars = [...defined].filter(v => !used.has(v)).sort();

// Class selectors, for a before/after diff.
const classes = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);

console.log(`braces: depth=${depth} underflows=${underflows}`);
console.log(`tokens: defined=${defined.size} used=${used.size}`);
console.log(`undefined var() refs: ${undefinedVars.length ? undefinedVars.join(', ') : 'none'}`);
console.log(`defined but unused:  ${unusedVars.length ? unusedVars.join(', ') : 'none'}`);
console.log(`classes: ${classes.size}`);
if (depth !== 0 || underflows || undefinedVars.length) process.exitCode = 1;
if (process.argv[3]) fs.writeFileSync(process.argv[3], [...classes].sort().join('\n'), 'utf8');
