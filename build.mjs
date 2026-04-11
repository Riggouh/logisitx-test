// ══════════════════════════════════════════
// LogistiX Build Script (concatenation-based)
// Combines all src/ files into game.js + index.html
// Usage:
//   node build.mjs           → production (minified)
//   node build.mjs --dev     → development (unminified)
// ══════════════════════════════════════════
import fs from 'fs';
import path from 'path';

const DEV  = process.argv.includes('--dev');
const DIR  = new URL('.', import.meta.url).pathname;
const OUT  = path.join(DIR, 'public');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ── Build timestamp ──
const BUILD_TS = new Date().toISOString().replace('T',' ').slice(0,16);
const BUILD_ID = Date.now().toString(36).slice(-6).toUpperCase();

// ── JS files in dependency order (same as build.sh) ──
const JS_FILES = [
  'src/js/data/cities.js',
  'src/js/data/constants.js',
  'src/js/data/goods.js',
  'src/js/data/buildings.js',
  'src/js/helpers.js',
  'src/js/game/economy.js',
  'src/js/game/state.js',
  'src/js/game/auth.js',
  'src/js/game/persistence.js',
  'src/js/game/order_gen.js',
  'src/js/game/cache.js',
  'src/js/game/quests.js',
  'src/js/game/market_sell.js',
  'src/js/game/duty.js',
  'src/js/game/vehicle_actions.js',
  'src/js/game/building_actions.js',
  'src/js/game/stock_helpers.js',
  'src/js/game/order_actions.js',
  'src/js/game/city_sell.js',
  'src/js/game/standing_orders.js',
  'src/js/game/pm_market.js',
  'src/js/game/alliance.js',
  'src/js/game/tick.js',
  'src/js/game/tick_production.js',
  'src/js/game/tick_vehicles.js',
  'src/js/game/tick_loop.js',
  'src/js/ui/map.js',
  'src/js/ui/search.js',
  'src/js/ui/core.js',
  'src/js/ui/auth_ui.js',
  'src/js/ui/dashboard.js',
  'src/js/ui/dash_tabs.js',
  'src/js/ui/dash_analytics.js',
  'src/js/ui/computer.js',
  'src/js/ui/tips.js',
  'src/js/ui/changelog.js',
  'src/js/ui/terminal.js',
  'src/js/ui/missions.js',
  'src/js/ui/dealer.js',
  'src/js/ui/fleet.js',
  'src/js/ui/logistics.js',
  'src/js/ui/inventory.js',
  'src/js/ui/routes.js',
  'src/js/ui/buildings.js',
  'src/js/ui/popups.js',
  'src/js/ui/wiki.js',
  'src/js/ui/alliance_ui.js',
  'src/js/ui/state_setters.js',
  'src/js/ui/settings.js',
  'src/js/game/admin.js',
  'src/js/ui/admin_ui.js',
  'src/js/game/admin_actions.js',
  'src/js/ui/game_bindings.js',
  'src/js/init.js',
];

// ── Strip import/export statements (concat makes everything global) ──
function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?from\s+['"].*?['"]\s*;?\s*$/gm, '')
    .replace(/^\s*import\s+['"].*?['"]\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+(const|let|var|function|class|async\s+function)\s/gm, '$1 ')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

// ── Concatenate all JS ──
let gameJs = `// LogistiX — Build ${BUILD_ID} — ${BUILD_TS}\n`;

for (const file of JS_FILES) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) {
    console.warn(`⚠️  Missing: ${file}`);
    continue;
  }
  const raw = fs.readFileSync(full, 'utf8');
  const clean = stripModuleSyntax(raw);
  gameJs += `\n// ── ${file} ──\n${clean}\n`;
}

fs.writeFileSync(path.join(OUT, 'game.js'), gameJs);

// ── Polyfill ──
const polyfill = `(function(){
  if(window.storage) return;
  const BASE='/api/storage';
  async function req(method,p,body){
    const opts={method,headers:{'Content-Type':'application/json'}};
    if(body)opts.body=JSON.stringify(body);
    const r=await fetch(BASE+p,opts);
    if(!r.ok)throw new Error('Storage API: '+r.status);
    return r.json();
  }
  window.storage={
    async get(k,s=false){return req('GET','?key='+encodeURIComponent(k)+'&shared='+s)},
    async set(k,v,s=false){return req('POST','',{key:k,value:v,shared:s})},
    async delete(k,s=false){return req('DELETE','?key='+encodeURIComponent(k)+'&shared='+s)},
    async list(p='',s=false){return req('GET','/list?prefix='+encodeURIComponent(p)+'&shared='+s)}
  };
})();`;

// ── Assemble index.html ──
const head = fs.readFileSync(path.join(DIR, 'src/template_head.html'), 'utf8');
const body = fs.readFileSync(path.join(DIR, 'src/template_body.html'), 'utf8');
const css  = fs.readFileSync(path.join(DIR, 'src/css/main.css'), 'utf8');

const stamp = `<div id="buildStamp" style="position:fixed;bottom:8px;right:12px;font-size:10px;font-family:var(--mono);color:rgba(255,255,255,.15);pointer-events:none;z-index:1">Build ${BUILD_ID} · ${BUILD_TS}</div>`;

const html = `${head}
<style>
${css}
</style>
</head>
${body}
${stamp}
<script>${polyfill}</script>
<script src="game.js"></script>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);

// ── Minify ──
if (!DEV) {
  try {
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [path.join(OUT, 'game.js')],
      outfile: path.join(OUT, 'game.js'),
      allowOverwrite: true,
      minify: true,
      target: ['es2022'],
      logLevel: 'silent',
    });
    console.log('✅ Minified');
  } catch (e) {
    console.warn('⚠️  Minify skipped:', e.message);
  }
}

const gameSize = (fs.statSync(path.join(OUT, 'game.js')).size / 1024).toFixed(1);
const htmlSize = (fs.statSync(path.join(OUT, 'index.html')).size / 1024).toFixed(1);
console.log(`✅ Build ${BUILD_ID} — index.html ${htmlSize} KB · game.js ${gameSize} KB`);
