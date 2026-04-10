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
<script>${polyfill}</script>
<script type="module" src="game.js"></script>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);

const gameSize = (fs.statSync(path.join(OUT, 'game.js')).size / 1024).toFixed(1);
const htmlSize = (fs.statSync(path.join(OUT, 'index.html')).size / 1024).toFixed(1);
console.log(`✅ index.html ${htmlSize} KB  |  game.js ${gameSize} KB`);
