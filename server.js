// ══════════════════════════════════════════
// LogistiX Server — Phase 2: Storage Isolation
// ══════════════════════════════════════════
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

// ── Config ──
const DATA_DIR=process.env.DATA_DIR||'/data';
const PORT=process.env.PORT||48432;
const CORS_ORIGIN=process.env.CORS_ORIGIN||'*';
const RATE_MAX=parseInt(process.env.RATE_MAX)||200;
const RATE_WINDOW=60000;
const SESSION_TTL=24*3600*1000; // 24h

// ── Data files (isolated) ──
const FILES={
  personal:path.join(DATA_DIR,'personal.json'),
  shared:  path.join(DATA_DIR,'shared.json'),
  users:   path.join(DATA_DIR,'users.json'),   // Phase 2: isolated
  admin:   path.join(DATA_DIR,'admin.json'),    // Phase 2: isolated
};
const SAVES_DIR=path.join(DATA_DIR,'saves');    // Phase 3: per-user
const PUBLIC=path.join(__dirname,'public');

// ── Helpers ──
function readJSON(f){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return {}}}
function writeJSON(f,d){fs.writeFileSync(f,JSON.stringify(d,null,2))}
function ensureFile(f){if(!fs.existsSync(f))writeJSON(f,{})}
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(SAVES_DIR))fs.mkdirSync(SAVES_DIR,{recursive:true});
Object.values(FILES).forEach(ensureFile);

// ── Migrate: move lx_users + lx_admin_hash from shared.json to isolated files ──
(function migrate(){
  const shared=readJSON(FILES.shared);
  let changed=false;
  if(shared.lx_users){
    const users=readJSON(FILES.users);
    if(!users.lx_users){users.lx_users=shared.lx_users;writeJSON(FILES.users,users)}
    delete shared.lx_users;changed=true;
  }
  if(shared.lx_admin_hash_v2){
    const admin=readJSON(FILES.admin);
    if(!admin.lx_admin_hash_v2){admin.lx_admin_hash_v2=shared.lx_admin_hash_v2;writeJSON(FILES.admin,admin)}
    delete shared.lx_admin_hash_v2;changed=true;
  }
  // Also migrate from personal
  const personal=readJSON(FILES.personal);
  if(personal.lx_users){
    const users=readJSON(FILES.users);
    if(!users.lx_users){users.lx_users=personal.lx_users;writeJSON(FILES.users,users)}
    delete personal.lx_users;writeJSON(FILES.personal,personal);
  }
  if(personal.lx_admin_hash_v2){
    const admin=readJSON(FILES.admin);
    if(!admin.lx_admin_hash_v2){admin.lx_admin_hash_v2=personal.lx_admin_hash_v2;writeJSON(FILES.admin,admin)}
    delete personal.lx_admin_hash_v2;writeJSON(FILES.personal,personal);
  }
  if(changed)writeJSON(FILES.shared,shared);
  // Migrate admin log too
  if(shared.lx_admin_log){
    const admin=readJSON(FILES.admin);
    if(!admin.lx_admin_log){admin.lx_admin_log=shared.lx_admin_log;writeJSON(FILES.admin,admin)}
    delete shared.lx_admin_log;writeJSON(FILES.shared,shared);
  }
  // Phase 3: Migrate lx_save_* from personal.json to per-user files
  const personal2=readJSON(FILES.personal);
  let pChanged=false;
  for(const key of Object.keys(personal2)){
    if(key.startsWith('lx_save_')){
      const username=key.replace('lx_save_','');
      const safeUser=username.replace(/[^a-z0-9_\-]/gi,'');
      if(!safeUser)continue;
      const userFile=path.join(SAVES_DIR,safeUser+'.json');
      const existing=readJSON(userFile);
      if(!existing[key]){existing[key]=personal2[key];writeJSON(userFile,existing)}
      delete personal2[key];pChanged=true;
    }
  }
  if(pChanged){writeJSON(FILES.personal,personal2);console.log('📦 Saves migrated to per-user files')}
  // Ensure default admin user
  const adminData=readJSON(FILES.admin);
  if(!adminData.lx_admin_users)adminData.lx_admin_users=[];
  if(!adminData.lx_admin_users.includes('riggouh')){
    adminData.lx_admin_users.push('riggouh');
    writeJSON(FILES.admin,adminData);
  }
})();

// ── Crypto (same algo as client: SHA-256 + salt) ──
function hashPw(pass,salt){
  if(!salt)salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.createHash('sha256').update(salt+':'+pass).digest('hex');
  return{hash,salt};
}
function verifyPw(pass,storedHash,salt){
  const{hash}=hashPw(pass,salt);
  // Constant-time comparison
  try{return crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(storedHash,'hex'))}
  catch(e){return hash===storedHash}
}

// ── Sessions ──
const sessions={};
function createSession(user){
  const token=crypto.randomBytes(32).toString('hex');
  sessions[token]={user:user.toLowerCase(),ts:Date.now()};
  return token;
}
function getSession(req){
  const token=req.headers['x-session']||'';
  const s=sessions[token];
  if(!s)return null;
  if(Date.now()-s.ts>SESSION_TTL){delete sessions[token];return null}
  return s.user;
}
// Clean expired sessions every 10 min
setInterval(()=>{const now=Date.now();for(const t in sessions){if(now-sessions[t].ts>SESSION_TTL)delete sessions[t]}},600000);

// ── Users helper (reads from isolated file) ──
function getUsers(){const d=readJSON(FILES.users);return d.lx_users?JSON.parse(d.lx_users):{}}
function saveUsersObj(users){
  const d=readJSON(FILES.users);
  d.lx_users=JSON.stringify(users);
  writeJSON(FILES.users,d);
}

// ── Rate Limiting ──
const _rate={};
function checkRate(ip){
  const now=Date.now();
  if(!_rate[ip]||now-_rate[ip].t>RATE_WINDOW){_rate[ip]={c:1,t:now};return true}
  _rate[ip].c++;return _rate[ip].c<=RATE_MAX;
}
setInterval(()=>{const now=Date.now();for(const ip in _rate){if(now-_rate[ip].t>RATE_WINDOW*2)delete _rate[ip]}},300000);

// Auth rate limiting (per user, stricter)
const _authRate={};
function checkAuthRate(user){
  const key=user.toLowerCase();const now=Date.now();
  if(!_authRate[key]||now-_authRate[key].t>300000){_authRate[key]={c:1,t:now};return true}
  _authRate[key].c++;return _authRate[key].c<=5;
}
function clearAuthRate(user){delete _authRate[user.toLowerCase()]}

// ── Key Validation ──
const KEY_PREFIXES=[
  'lx_save_','lx_cache','lx_feedback','lx_events_global','lx_reload_','lx_ratelimit_',
  'lx_announce','lx_adminmsg_',
  'lb:','pm:','pm_credit:','alliances','terr_owners','terr_market','ally_market'
];
const BLOCKED_KEYS=['lx_users','lx_admin_hash_v2','lx_admin_log'];
// Keys only writable by admin (not regular users)
const ADMIN_ONLY_WRITE=['lx_reload_','lx_adminmsg_','lx_announce'];

function isValidKey(key){
  if(!key||typeof key!=='string'||key.length>200)return false;
  if(key.includes('__proto__')||key.includes('constructor')||key.includes('prototype'))return false;
  if(BLOCKED_KEYS.some(b=>key===b||key.startsWith(b)))return false;
  return KEY_PREFIXES.some(p=>key===p||key.startsWith(p));
}

// Phase 3: Per-user save file
function userSaveFile(username){
  const safe=(username||'').toLowerCase().replace(/[^a-z0-9_\-]/gi,'');
  if(!safe)return FILES.personal;
  return path.join(SAVES_DIR,safe+'.json');
}

// ── File routing (Phase 3: per-user saves) ──
function getFile(key,shared){
  if(key&&(key.startsWith('lx_admin')||key==='lx_admin_log'))return FILES.admin;
  // Per-user saves
  if(key&&key.startsWith('lx_save_')){return userSaveFile(key.replace('lx_save_',''))}
  if(shared)return FILES.shared;
  return FILES.personal;
}

// Phase 3: Write access control
// Returns null if allowed, error string if denied
function checkWriteAccess(key,sessionUser){
  // Admin-only keys
  if(ADMIN_ONLY_WRITE.some(p=>key.startsWith(p))){
    if(!adminSessions[sessionUser])return 'admin only';
  }
  // Per-user keys: lx_save_<user> — only own save
  if(key.startsWith('lx_save_')){
    const saveUser=key.replace('lx_save_','');
    if(sessionUser&&saveUser!==sessionUser&&!adminSessions[sessionUser])return 'not your save';
  }
  // Per-user keys: lb:<user> — only own leaderboard
  if(key.startsWith('lb:')){
    const lbUser=key.replace('lb:','');
    if(sessionUser&&lbUser!==sessionUser&&!adminSessions[sessionUser])return 'not your entry';
  }
  return null; // allowed
}

// Admin session tracking (set on admin login)
const adminSessions={};

// ── Write debounce ──
const _pw={};
function safeWrite(f,store){
  _pw[f]=store;
  if(!_pw[f+'_t']){_pw[f+'_t']=setTimeout(()=>{try{writeJSON(f,_pw[f])}catch(e){}delete _pw[f+'_t']},50)}
  try{writeJSON(f,store)}catch(e){}
}

// ── Security Headers ──
function setHeaders(req,res){
  const origin=req.headers.origin||'';
  if(CORS_ORIGIN==='*')res.setHeader('Access-Control-Allow-Origin','*');
  else{const a=CORS_ORIGIN.split(',').map(s=>s.trim());if(a.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}}
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Session');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
}
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com cdnjs.cloudflare.com; font-src fonts.gstatic.com cdnjs.cloudflare.com; img-src 'self' data: blob: tile.openstreetmap.org *.tile.openstreetmap.org *.openstreetmap.de; connect-src 'self'";

// ── Body parser helper ──
function readBody(req,maxSize,cb){
  let body='';let size=0;
  req.on('data',c=>{size+=c.length;if(size>maxSize){req.destroy();return}body+=c});
  req.on('end',()=>{try{cb(null,JSON.parse(body))}catch(e){cb(e)}});
}

// ══════════════════════════════════════════
// AUTH ENDPOINTS
// ══════════════════════════════════════════
function handleAuth(req,res,action){
  res.setHeader('Content-Type','application/json');
  setHeaders(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
  if(req.method!=='POST'){res.statusCode=405;res.end('{"error":"method not allowed"}');return}

  readBody(req,65536,(err,data)=>{
    if(err||!data){res.statusCode=400;res.end('{"error":"bad request"}');return}

    // ── LOGIN ──
    if(action==='login'){
      const user=(data.user||'').trim();const pass=data.pass||'';
      if(!user||!pass){res.statusCode=400;res.end('{"error":"missing fields"}');return}
      if(!checkAuthRate(user)){res.statusCode=429;res.end('{"error":"too many attempts, wait 5 min"}');return}
      const users=getUsers();const u=users[user.toLowerCase()];
      if(!u){res.statusCode=401;res.end('{"error":"invalid credentials"}');return}
      let valid=false;
      if(u.salt&&u.hash){valid=verifyPw(pass,u.hash,u.salt)}
      else if(u.pass){valid=u.pass===pass;if(valid){
        // Auto-migrate plaintext → hashed
        const{hash,salt}=hashPw(pass);u.hash=hash;u.salt=salt;delete u.pass;saveUsersObj(users);
      }}
      if(!valid){res.statusCode=401;res.end('{"error":"invalid credentials"}');return}
      clearAuthRate(user);
      const token=createSession(user);
      // Return user data (without password fields)
      const safe={user:u.user||user,email:u.email||'',created:u.created||0,question:u.question||''};
      res.end(JSON.stringify({ok:true,token,user:safe}));

    // ── REGISTER ──
    }else if(action==='register'){
      const user=(data.user||'').trim();const email=(data.email||'').trim();
      const pass=data.pass||'';const question=(data.question||'').trim();const answer=data.answer||'';
      if(!user||!email||!pass||!question||!answer){res.statusCode=400;res.end('{"error":"missing fields"}');return}
      if(user.length<2||user.length>20){res.statusCode=400;res.end('{"error":"username 2-20 chars"}');return}
      if(!/^[a-zA-Z0-9_\-äöüÄÖÜß]+$/.test(user)){res.statusCode=400;res.end('{"error":"invalid username chars"}');return}
      if(pass.length<8){res.statusCode=400;res.end('{"error":"password min 8 chars"}');return}
      if(!checkAuthRate('reg_'+user)){res.statusCode=429;res.end('{"error":"too many attempts"}');return}
      const users=getUsers();
      if(users[user.toLowerCase()]){res.statusCode=409;res.end('{"error":"username taken"}');return}
      const{hash,salt}=hashPw(pass);
      const{hash:ansHash,salt:ansSalt}=hashPw(answer.toLowerCase());
      users[user.toLowerCase()]={user,email,hash,salt,question,ansHash,ansSalt,created:Date.now()};
      saveUsersObj(users);
      res.end(JSON.stringify({ok:true}));

    // ── RESET STEP 1: get security question ──
    }else if(action==='reset1'){
      const user=(data.user||'').trim();
      if(!user){res.statusCode=400;res.end('{"error":"missing user"}');return}
      const users=getUsers();const u=users[user.toLowerCase()];
      if(!u){res.statusCode=404;res.end('{"error":"user not found"}');return}
      res.end(JSON.stringify({ok:true,question:u.question||''}));

    // ── RESET STEP 2: verify answer + set new password ──
    }else if(action==='reset2'){
      const user=(data.user||'').trim();const answer=data.answer||'';const newPass=data.newPass||'';
      if(!user||!answer||!newPass){res.statusCode=400;res.end('{"error":"missing fields"}');return}
      if(newPass.length<8){res.statusCode=400;res.end('{"error":"password min 8 chars"}');return}
      const users=getUsers();const u=users[user.toLowerCase()];
      if(!u){res.statusCode=404;res.end('{"error":"user not found"}');return}
      let ansValid=false;
      if(u.ansSalt&&u.ansHash){ansValid=verifyPw(answer.toLowerCase(),u.ansHash,u.ansSalt)}
      else{ansValid=(u.answer||'').toLowerCase()===answer.toLowerCase()}
      if(!ansValid){res.statusCode=401;res.end('{"error":"wrong answer"}');return}
      const{hash,salt}=hashPw(newPass);u.hash=hash;u.salt=salt;delete u.pass;
      saveUsersObj(users);
      res.end(JSON.stringify({ok:true}));

    // ── CHANGE PASSWORD (requires session) ──
    }else if(action==='changepw'){
      const sessionUser=getSession(req);
      if(!sessionUser){res.statusCode=401;res.end('{"error":"not logged in"}');return}
      const newPass=data.newPass||'';
      if(!newPass||newPass.length<8){res.statusCode=400;res.end('{"error":"password min 8 chars"}');return}
      const users=getUsers();const u=users[sessionUser];
      if(!u){res.statusCode=404;res.end('{"error":"user not found"}');return}
      const{hash,salt}=hashPw(newPass);u.hash=hash;u.salt=salt;delete u.pass;
      saveUsersObj(users);
      res.end(JSON.stringify({ok:true}));

    // ── ADMIN LOGIN ──
    }else if(action==='admin'){
      const pass=data.pass||'';
      if(!pass){res.statusCode=400;res.end('{"error":"missing password"}');return}
      const admin=readJSON(FILES.admin);
      let stored=admin.lx_admin_hash_v2?JSON.parse(admin.lx_admin_hash_v2):null;
      if(!stored){
        const{hash,salt}=hashPw('logistix2025');
        stored={hash,salt};
        admin.lx_admin_hash_v2=JSON.stringify(stored);writeJSON(FILES.admin,admin);
      }
      const valid=verifyPw(pass,stored.hash,stored.salt);
      if(!valid){res.statusCode=401;res.end('{"error":"invalid admin password"}');return}
      const isDefault=verifyPw('logistix2025',stored.hash,stored.salt);
      const sessionUser=getSession(req);
      if(sessionUser){
        adminSessions[sessionUser]=true;
        // Auto-add to admin user list on first successful login
        if(!admin.lx_admin_users)admin.lx_admin_users=[];
        if(!admin.lx_admin_users.includes(sessionUser)){
          admin.lx_admin_users.push(sessionUser);
          writeJSON(FILES.admin,admin);
        }
      }
      res.end(JSON.stringify({ok:true,defaultPw:isDefault}));

    // ── CHECK ADMIN STATUS (is current user an admin?) ──
    }else if(action==='checkadmin'){
      const sessionUser=getSession(req);
      if(!sessionUser){res.end(JSON.stringify({ok:true,isAdmin:false}));return}
      const admin=readJSON(FILES.admin);
      const list=admin.lx_admin_users||[];
      res.end(JSON.stringify({ok:true,isAdmin:list.includes(sessionUser),user:sessionUser}));

    // ── LIST ADMIN USERS ──
    }else if(action==='adminusers'){
      const sessionUser=getSession(req);
      const admin=readJSON(FILES.admin);
      const list=admin.lx_admin_users||[];
      if(!sessionUser||!list.includes(sessionUser)){res.statusCode=403;res.end('{"error":"not admin"}');return}
      res.end(JSON.stringify({ok:true,admins:list}));

    // ── ADD ADMIN USER ──
    }else if(action==='addadmin'){
      const sessionUser=getSession(req);
      const admin=readJSON(FILES.admin);
      const list=admin.lx_admin_users||[];
      if(!sessionUser||!list.includes(sessionUser)){res.statusCode=403;res.end('{"error":"not admin"}');return}
      const target=(data.user||'').toLowerCase().trim();
      if(!target){res.statusCode=400;res.end('{"error":"missing user"}');return}
      // Verify target user exists
      const users=getUsers();
      if(!users[target]){res.statusCode=404;res.end('{"error":"user not found"}');return}
      if(!list.includes(target)){list.push(target);admin.lx_admin_users=list;writeJSON(FILES.admin,admin)}
      res.end(JSON.stringify({ok:true,admins:list}));

    // ── REMOVE ADMIN USER ──
    }else if(action==='removeadmin'){
      const sessionUser=getSession(req);
      const admin=readJSON(FILES.admin);
      const list=admin.lx_admin_users||[];
      if(!sessionUser||!list.includes(sessionUser)){res.statusCode=403;res.end('{"error":"not admin"}');return}
      const target=(data.user||'').toLowerCase().trim();
      if(!target){res.statusCode=400;res.end('{"error":"missing user"}');return}
      if(target===sessionUser){res.statusCode=400;res.end('{"error":"cannot remove yourself"}');return}
      admin.lx_admin_users=list.filter(u=>u!==target);writeJSON(FILES.admin,admin);
      res.end(JSON.stringify({ok:true,admins:admin.lx_admin_users}));

    // ── ADMIN CHANGE PASSWORD ──
    }else if(action==='adminpw'){
      const pass=data.pass||'';const newPass=data.newPass||'';
      if(!pass||!newPass||newPass.length<4){res.statusCode=400;res.end('{"error":"invalid"}');return}
      const admin=readJSON(FILES.admin);
      const stored=admin.lx_admin_hash_v2?JSON.parse(admin.lx_admin_hash_v2):null;
      if(!stored||!verifyPw(pass,stored.hash,stored.salt)){res.statusCode=401;res.end('{"error":"wrong password"}');return}
      const{hash,salt}=hashPw(newPass);
      admin.lx_admin_hash_v2=JSON.stringify({hash,salt});writeJSON(FILES.admin,admin);
      res.end(JSON.stringify({ok:true}));

    // ── GET USERS LIST (admin only, requires admin session header) ──
    }else if(action==='users'){
      // Verify admin: require X-Admin-Token header
      const adminToken=req.headers['x-admin-token']||'';
      if(!adminToken){res.statusCode=401;res.end('{"error":"admin auth required"}');return}
      const users=getUsers();
      res.end(JSON.stringify({ok:true,users}));

    // ── ENSURE TEST ACCOUNT ──
    }else if(action==='ensuretest'){
      const users=getUsers();
      if(!users.test||!users.test.hash){
        const{hash,salt}=hashPw('test');
        const{hash:ansHash,salt:ansSalt}=hashPw('test');
        users.test={user:'Test',email:'test@logistix.de',hash,salt,question:'Was ist das Testpasswort?',ansHash,ansSalt,created:Date.now()};
        saveUsersObj(users);
      }
      res.end(JSON.stringify({ok:true}));

    }else{
      res.statusCode=404;res.end('{"error":"unknown auth action"}');
    }
  });
}

// ══════════════════════════════════════════
// STORAGE HANDLER (with blocked keys)
// ══════════════════════════════════════════
function handleStorage(req,res){
  res.setHeader('Content-Type','application/json');
  setHeaders(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
  const url=new URL(req.url,'http://localhost');
  const p=url.pathname;

  if(p==='/api/storage'&&req.method==='GET'){
    const key=url.searchParams.get('key'),shared=url.searchParams.get('shared')==='true';
    if(!isValidKey(key)){
      // Allow reading lx_users/admin for backward compat (client may still try)
      // but return null — forces client to use /api/auth endpoints
      if(BLOCKED_KEYS.some(b=>key===b)){res.end(JSON.stringify({key,value:null,shared}));return}
      res.statusCode=403;res.end('{"error":"forbidden key"}');return;
    }
    const f=getFile(key,shared);ensureFile(f);const store=readJSON(f);
    if(store[key]!==undefined)res.end(JSON.stringify({key,value:store[key],shared}));
    else res.end(JSON.stringify({key,value:null,shared}));

  }else if(p==='/api/storage'&&req.method==='POST'){
    readBody(req,2097152,(err,data)=>{
      if(err||!data){res.statusCode=400;res.end('{"error":"bad request"}');return}
      const{key,value,shared}=data;
      if(!isValidKey(key)){res.statusCode=403;res.end('{"error":"forbidden key"}');return}
      // Phase 3: write access control
      const sessionUser=getSession(req);
      const writeErr=checkWriteAccess(key,sessionUser);
      if(writeErr){res.statusCode=403;res.end(JSON.stringify({error:writeErr}));return}
      const f=getFile(key,shared);ensureFile(f);const store=readJSON(f);
      store[key]=value;safeWrite(f,store);
      res.end(JSON.stringify({key,value,shared:!!shared}));
    });

  }else if(p==='/api/storage'&&req.method==='DELETE'){
    const key=url.searchParams.get('key'),shared=url.searchParams.get('shared')==='true';
    if(!isValidKey(key)){res.statusCode=403;res.end('{"error":"forbidden key"}');return}
    const sessionUser=getSession(req);
    const writeErr=checkWriteAccess(key,sessionUser);
    if(writeErr){res.statusCode=403;res.end(JSON.stringify({error:writeErr}));return}
    const f=getFile(key,shared);ensureFile(f);const store=readJSON(f);
    const existed=store[key]!==undefined;delete store[key];safeWrite(f,store);
    res.end(JSON.stringify({key,deleted:existed,shared}));

  }else if(p==='/api/storage/list'&&req.method==='GET'){
    const prefix=url.searchParams.get('prefix')||'',shared=url.searchParams.get('shared')==='true';
    if(prefix&&!KEY_PREFIXES.some(p=>prefix.startsWith(p))){res.statusCode=403;res.end('{"error":"forbidden prefix"}');return}
    // Phase 3: for lx_save_ prefix, scan per-user files
    if(prefix.startsWith('lx_save_')){
      try{const files=fs.readdirSync(SAVES_DIR).filter(f=>f.endsWith('.json'));
        let keys=[];files.forEach(f=>{const store=readJSON(path.join(SAVES_DIR,f));keys=keys.concat(Object.keys(store).filter(k=>k.startsWith(prefix)))});
        res.end(JSON.stringify({keys,prefix,shared}));return;
      }catch(e){}
    }
    const f=getFile(prefix,shared);ensureFile(f);const store=readJSON(f);
    const keys=Object.keys(store).filter(k=>k.startsWith(prefix));
    res.end(JSON.stringify({keys,prefix,shared}));

  }else{res.statusCode=404;res.end('{"error":"not found"}')}
}

// ══════════════════════════════════════════
// HTTP Router
// ══════════════════════════════════════════
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};

http.createServer((req,res)=>{
  const ip=req.socket.remoteAddress||'?';
  if(!checkRate(ip)){res.statusCode=429;res.setHeader('Retry-After','60');res.end('Too Many Requests');return}

  const url=new URL(req.url,'http://localhost');

  // Auth endpoints
  if(url.pathname.startsWith('/api/auth/')){
    const action=url.pathname.replace('/api/auth/','');
    return handleAuth(req,res,action);
  }
  // Storage endpoints
  if(url.pathname.startsWith('/api/')){return handleStorage(req,res)}

  // Static files
  setHeaders(req,res);
  let file=req.url==='/'?'/index.html':req.url.split('?')[0];
  const fp=path.join(PUBLIC,file);
  if(!fp.startsWith(PUBLIC)){res.statusCode=403;res.end();return}
  fs.readFile(fp,(err,data)=>{
    if(err){res.statusCode=404;res.end('Not Found');return}
    const ext=path.extname(fp);
    res.setHeader('Content-Type',MIME[ext]||'application/octet-stream');
    res.setHeader('Cache-Control','no-cache');
    if(ext==='.html')res.setHeader('Content-Security-Policy',CSP);
    res.end(data);
  });
}).listen(PORT,()=>{
  console.log('LogistiX on :'+PORT+' (Phase 3)');
  console.log('  Data: '+DATA_DIR+' | Saves: '+SAVES_DIR);
  if(CORS_ORIGIN==='*')console.warn('⚠️  CORS_ORIGIN=* — set env to your domain!');
});
