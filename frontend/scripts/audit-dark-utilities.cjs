const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

const covered = new Set();
for (const m of css.matchAll(/\[class~="([^"]+)"\]/g)) covered.add(m[1]);

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(p);
  }
})(path.join(root, 'src'));

const CLASS_TOKEN = String.raw`(?:text|bg|border|ring|divide|placeholder|shadow|from|via|to)-(?:#[0-9A-Fa-f]{3,8}|[a-z]+-[0-9]{2,3})`;
const TOKEN_RE = new RegExp(String.raw`(?:^|[\s"'\x60])((?:[a-z-]+:)*` + CLASS_TOKEN + String.raw`(?:/[0-9]{1,3})?)`, 'g');

const used = new Map();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(TOKEN_RE)) {
    const token = m[1];
    const bare = token.replace(/^[a-z-]+:/, '');
    const key = bare.split('/')[0];
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(path.relative(root, file) + ' :: ' + token);
  }
}

const missing = [...used.keys()].filter(t => !covered.has(t)).sort();
console.log('MISSING DARK OVERRIDES (base class):');
for (const t of missing) console.log('  ' + t + '  <-  ' + [...used.get(t)].join(' | '));
