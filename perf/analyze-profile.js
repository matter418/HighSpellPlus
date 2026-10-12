// node perf/analyze-profile.js <file.cpuprofile>   — aggregates self time by function and by script URL
const fs = require('fs');
if (!process.argv[2]) {
    console.error('usage: node perf/analyze-profile.js <file.cpuprofile>');
    process.exit(1);
}
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map(n => [n.id, n]));
const self = new Map();
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i] || 0) / 1000;
    total += dt;
    self.set(p.samples[i], (self.get(p.samples[i]) || 0) + dt);
}
const fn = new Map();
const url = new Map();
for (const [id, ms] of self) {
    const cf = byId.get(id).callFrame;
    const u = (cf.url || '(native/anon)').replace(/^.*\//, '');
    const k = `${cf.functionName || '(anonymous)'}  @ ${u}:${cf.lineNumber + 1}`;
    fn.set(k, (fn.get(k) || 0) + ms);
    url.set(u, (url.get(u) || 0) + ms);
}
const top = (m, n) =>
    [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(
            ([k, v]) =>
                `${((100 * v) / total).toFixed(1).padStart(5)}%  ${v.toFixed(0).padStart(6)}ms  ${k}`
        )
        .join('\n');
console.log(
    `total sampled: ${(total / 1000).toFixed(1)}s\n\n== by script ==\n${top(url, 12)}\n\n== by function (self time) ==\n${top(fn, 40)}`
);
