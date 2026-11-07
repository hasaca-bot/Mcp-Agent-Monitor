// Build a single self-contained HTML file (fonts, CSS and JS inlined) that runs
// the dashboard in in-browser demo mode — for sharing a live preview without a hub.
// usage: node scripts/build-standalone.mjs [out.html] [--fragment]
//   --fragment omits <!doctype>/<html>/<head>/<body> (for hosts that add their own skeleton)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] || 'dist/agent-monitor.html';
const fragment = process.argv.includes('--fragment');
const pub = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url));

let css = pub('app.css').toString();
css = css.replace(/url\("fonts\/([^"]+\.woff2)"\)/g, (_, f) => `url(data:font/woff2;base64,${pub(`fonts/${f}`).toString('base64')})`);

const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export (?=(async )?(function|class|const|let))/gm, '').replace(/^export \* from .*$/gm, '');
const store = strip(pub('shared/store.js').toString());
const demo = strip(pub('shared/demo.js').toString());
let app = strip(pub('app.js').toString());
app = app.replace("const wantDemo = params.has('demo') || location.protocol === 'file:';", 'const wantDemo = true;');

const js = `
const { Store } = (() => { ${store}\n return { Store }; })();
const { seed, simulate, SESSION_TITLE } = (() => { ${demo}\n return { seed, simulate, SESSION_TITLE }; })();
${app}`;

const body = `<title>Agent Monitor</title>
<meta name="description" content="ASCII mission-control for sub-agents, driven over MCP (demo data).">
<style>${css}
html, body { height: 100%; }
</style>
<main id="screen" aria-live="off" aria-label="Sub-agent monitor"></main>
<div class="crt" aria-hidden="true"></div>
<script type="module">${js}</script>`;

const html = fragment ? body : `<!doctype html>\n<html lang="en" data-theme="phosphor">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${body.replace('<main', '</head>\n<body>\n<main')}\n</body>\n</html>\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
