// ══════════════════════════════════════════
// LogistiX Build Script (esbuild)
// Usage:
//   node build.mjs           → production (minified)
//   node build.mjs --dev     → development (source maps)
//   node build.mjs --watch   → watch mode
// ══════════════════════════════════════════
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const DEV   = process.argv.includes('--dev');
const WATCH = process.argv.includes('--watch');
const DIR   = new URL('.', import.meta.url).pathname;
const OUT   = path.join(DIR, 'public');

// ── Ensure output dir ──
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ── Build game.js ──
const ctx = await esbuild.context({
  entryPoints: [path.join(DIR, 'src/js/main.js')],
  bundle:      true,
  outfile:     path.join(OUT, 'game.js'),
  format:      'esm',
  platform:    'browser',
  target:      ['es2022'],
  minify:      !DEV,
  treeShaking: false,  // Global-scope architecture: all exports must survive
  sourcemap:   DEV ? 'inline' : false,
  define: {
    'process.env.NODE_ENV': DEV ? '"development"' : '"production"'
  },
  logLevel: 'info',
});

if (WATCH) {
  await ctx.watch();
  console.log('👀 Watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

// ── Queue script: proxy onclick= functions until game.js is ready ──
const queueScript = "(function(){\n  var _q=[];\n  var _r=false;\n  var _fns=['showAuth', 'doLogin', 'doRegister', 'doResetStep1', 'doResetStep2', 'doChangePass', 'doChangeEmail', 'togglePassVis', 'openComputer', 'closeComputer', 'toggleAdmin', 'toggleDuty', 'toggleHamburger', 'closeHamburger', 'openSettings', 'toggleView', 'toggleMinimap', 'renDash', 'openAlliancePanel', 'closeAlliancePanel', 'showLeaderboard', 'showProfile', 'showAchievements', 'showTutorial', 'showWiki', 'showChangelog', 'showDutyHelp', 'showExplorerUI', 'doLogout'];\n  function _wrap(name){\n    window[name]=function(){\n      var a=arguments;\n      if(_r&&typeof window['_lx_'+name]==='function'){window['_lx_'+name].apply(this,a);return;}\n      _q.push([name,a]);\n    };\n  }\n  _fns.forEach(_wrap);\n  document.addEventListener('lxReady',function(){\n    _r=true;\n    // Re-map with real functions\n    _fns.forEach(function(n){window['_lx_'+n]=window[n]});\n    _q.forEach(function(c){\n      if(typeof window[c[0]]==='function')window[c[0]].apply(null,c[1]);\n    });\n    _q=[];\n  });\n})();";

// ── Assemble index.html ──
const head    = fs.readFileSync(path.join(DIR, 'src/template_head.html'), 'utf8');
const body    = fs.readFileSync(path.join(DIR, 'src/template_body.html'), 'utf8');
const css     = fs.readFileSync(path.join(DIR, 'src/css/main.css'), 'utf8');

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

const html = `${head}
<style>
${css}
</style>
</head>
${body}
<script>${queueScript}</script>
<script>${polyfill}</script>
<script src="game.js"></script>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);

const gameSize = (fs.statSync(path.join(OUT, 'game.js')).size / 1024).toFixed(1);
const htmlSize = (fs.statSync(path.join(OUT, 'index.html')).size / 1024).toFixed(1);
console.log(`✅ index.html ${htmlSize} KB  |  game.js ${gameSize} KB`);
