const http=require('http'),fs=require('fs'),path=require('path');
const DATA_DIR=process.env.DATA_DIR||'/data';
const PERSONAL=path.join(DATA_DIR,'personal.json');
const SHARED=path.join(DATA_DIR,'shared.json');

function readJSON(f){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return {}}}
function writeJSON(f,d){fs.writeFileSync(f,JSON.stringify(d,null,2))}
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(PERSONAL))writeJSON(PERSONAL,{});
if(!fs.existsSync(SHARED))writeJSON(SHARED,{});

function handleStorage(req,res){
  res.setHeader('Content-Type','application/json');
  const url=new URL(req.url,'http://localhost');
  const p=url.pathname;
  // ── CORS headers ──
  res.setHeader('Access-Control-Allow-Origin','*');

  if(p==='/api/storage'&&req.method==='GET'){
    const key=url.searchParams.get('key'),shared=url.searchParams.get('shared')==='true';
    const store=readJSON(shared?SHARED:PERSONAL);
    if(store[key]!==undefined)res.end(JSON.stringify({key,value:store[key],shared}));
    else res.end(JSON.stringify({key,value:null,shared}));
  }else if(p==='/api/storage'&&req.method==='POST'){
    let body='';let bodySize=0;req.on('data',c=>{bodySize+=c.length;if(bodySize>2097152){res.statusCode=413;res.end(JSON.stringify({error:'too large'}));req.destroy();return;}body+=c});req.on('end',()=>{
      try{
        const{key,value,shared}=JSON.parse(body);
        const f=shared?SHARED:PERSONAL;const store=readJSON(f);
        store[key]=value;writeJSON(f,store);
        res.end(JSON.stringify({key,value,shared:!!shared}));
      }catch(e){res.statusCode=400;res.end(JSON.stringify({error:'bad request'}))}
    });
  }else if(p==='/api/storage'&&req.method==='DELETE'){
    const key=url.searchParams.get('key'),shared=url.searchParams.get('shared')==='true';
    const f=shared?SHARED:PERSONAL;const store=readJSON(f);
    const existed=store[key]!==undefined;delete store[key];writeJSON(f,store);
    res.end(JSON.stringify({key,deleted:existed,shared}));
  }else if(p==='/api/storage/list'&&req.method==='GET'){
    const prefix=url.searchParams.get('prefix')||'',shared=url.searchParams.get('shared')==='true';
    const store=readJSON(shared?SHARED:PERSONAL);
    const keys=Object.keys(store).filter(k=>k.startsWith(prefix));
    res.end(JSON.stringify({keys,prefix,shared}));
  }else{res.statusCode=404;res.end(JSON.stringify({error:'not found'}))}
}

const PORT=process.env.PORT||48432;
const PUBLIC=path.join(__dirname,'public');
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'};

http.createServer((req,res)=>{
  if(req.url.startsWith('/api/'))return handleStorage(req,res);
  let file=req.url==='/'?'/index.html':req.url;
  const fp=path.join(PUBLIC,file);
  if(!fp.startsWith(PUBLIC)){res.statusCode=403;res.end();return}
  fs.readFile(fp,(err,data)=>{
    if(err){res.statusCode=404;res.end('Not Found');return}
    const ext=path.extname(fp);
    res.setHeader('Content-Type',MIME[ext]||'application/octet-stream');
    res.setHeader('Cache-Control','no-cache');
    res.end(data);
  });
}).listen(PORT,()=>console.log('LogistiX on :'+PORT));
