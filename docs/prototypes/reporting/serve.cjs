const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const allowed = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css']]);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer((req,res)=>{
  const file = allowed.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if(!file){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200, {'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});
  res.end(fs.readFileSync(path.join(__dirname,file)));
}).listen(8766,'127.0.0.1',()=>console.log('Prototype available at http://127.0.0.1:8766'));
