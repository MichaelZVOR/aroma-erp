"""Isolated browser reader. HTTPS tunnels are pinned to validated public addresses."""
import json,os,subprocess,threading,socket,select,http.client,urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

ROOT=Path(__file__).resolve().parent
RUNTIME=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
class BrowserReadError(ValueError):
 def __init__(self,message,status='browser_error'):super().__init__(message);self.status=status

def read(site,url,public_addresses):
 hosts={'goldapple':'goldapple.ru','aromabutik':'aroma-butik.ru'}
 if site not in hosts:raise BrowserReadError('Браузерная загрузка этого источника не настроена.')
 host=hosts[site]
 node=RUNTIME/'bin/node.exe';module=RUNTIME/'node_modules/playwright'
 if not node.exists() or not (module/'package.json').exists():raise BrowserReadError('Не найден браузерный модуль. Требуется восстановить компоненты приложения.')
 profile=Path(os.environ.get('AROMA_DATA_DIR',str(ROOT/'data')))/'competitor-browser'/site
 profile.mkdir(parents=True,exist_ok=True)
 sockets=set();guard=threading.Lock()
 def allowed(name):return name==host or name.endswith('.'+host)
 def tunnel_socket(name,port):
  if port!=443 or not allowed(name):raise ValueError('Адрес не разрешён')
  addresses=public_addresses(name)
  proxy=urllib.request.getproxies().get('https')
  if proxy:
   from urllib.parse import urlsplit
   import base64
   p=urlsplit(proxy)
   if p.scheme!='http' or not p.hostname:raise ValueError('Неподдерживаемый системный прокси')
   conn=http.client.HTTPConnection(p.hostname,p.port or 80,timeout=10);headers={}
   if p.username:headers['Proxy-Authorization']='Basic '+base64.b64encode((p.username+':'+(p.password or '')).encode()).decode()
   conn.set_tunnel(addresses[0],port,headers=headers);conn.connect();return conn.sock
  return socket.create_connection((addresses[0],port),timeout=10)
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*args):pass
  def do_CONNECT(self):
   upstream=None
   try:
    target,port=self.path.rsplit(':',1)
    upstream=tunnel_socket(target.lower(),int(port))
    with guard:sockets.add(upstream)
    self.send_response(200,'Connection established');self.end_headers()
    peers=[self.connection,upstream]
    for peer in peers:peer.setblocking(False)
    while True:
     ready,_,_=select.select(peers,[],[],10)
     if not ready:break
     for src in ready:
      chunk=src.recv(65536)
      if not chunk:return
      dst=upstream if src is self.connection else self.connection
      dst.setblocking(True);dst.sendall(chunk);dst.setblocking(False)
   except (ValueError,OSError,http.client.HTTPException):
    try:self.send_error(403,'Destination not available')
    except OSError:pass
   finally:
    if upstream:
     with guard:sockets.discard(upstream)
     upstream.close()
  def do_GET(self):self.send_error(403,'HTTPS only')
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
 worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
 request={'site':site,'url':url,'host':host,'profile':str(profile),'playwright':str(module),'proxy':'http://127.0.0.1:'+str(server.server_port)}
 try:
  result=subprocess.run([str(node),str(ROOT/'competitor_browser.cjs')],input=json.dumps(request),text=True,encoding='utf-8',capture_output=True,timeout=100,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  try:reply=json.loads(result.stdout)
  except (ValueError,TypeError):raise BrowserReadError('Браузерный загрузчик не ответил. Проверьте установленный Chrome.')
  if reply.get('error'):raise BrowserReadError(reply['error'],reply.get('status','browser_error'))
  if not isinstance(reply.get('html'),str) or len(reply['html'].encode('utf-8'))>4_000_000:raise BrowserReadError('Браузер вернул слишком большую или пустую страницу.')
  return reply['html'],reply['url']
 except subprocess.TimeoutExpired:raise BrowserReadError('Браузер не успел загрузить страницу. Повторите проверку позже.','browser_timeout')
 finally:
  server.shutdown();server.server_close()
  with guard:
   for connection in list(sockets):
    try:connection.close()
    except OSError:pass
