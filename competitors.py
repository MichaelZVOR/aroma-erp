"""Read-only public price checks; isolated from own prices, sales and inventory."""
import json,re,socket,ssl,http.client,ipaddress,time,threading,unicodedata
import urllib.request,base64
from html.parser import HTMLParser
from urllib.parse import urlsplit,urlunsplit,urljoin,urlencode,unquote
from datetime import datetime
from decimal import Decimal,InvalidOperation

SITES={
 'allure':{'name':'Allure Parfum','host':'allureparfum.ru','url':'https://allureparfum.ru/katalog/zhenskaya-parfyumeriya/amouage/existence.html','search':'/search/?q='},
 'odekolon':{'name':'Odekolon','host':'odekolon-shop.ru','url':'https://odekolon-shop.ru/catalog/probniki/amouage-existence/','search':'/search/index.php?q='},
 'randewoo':{'name':'Randewoo','host':'randewoo.ru','url':'https://randewoo.ru/product/existence','search':'/search?q='},
 'duhi':{'name':'Духи.рф','host':'xn--d1ai6ai.xn--p1ai','url':'https://xn--d1ai6ai.xn--p1ai/catalog/women/Amouage/Existence','search':'/index.php?section=6&top_search=1&search_keyword='},
}
SEARCH_CACHE={};SEARCH_LAST={};SEARCH_VERSION=7
LOCKS={k:threading.Lock() for k in SITES}
class CheckIssue(ValueError):
 def __init__(self,message,status):super().__init__(message);self.status=status
def now():return datetime.now().astimezone().isoformat(timespec='seconds')
def dump(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def normalize(s):
 s=unicodedata.normalize('NFKD',s).casefold()
 return ' '.join(re.findall(r'[a-z0-9а-я]+',''.join(c for c in s if not unicodedata.combining(c))))
def fragrance(s):return re.sub(r'\s*[—–-]\s*\d+(?:[.,]\d+)?\s*мл\.?\s*$','',s,flags=re.I).strip()
def identity(s):
 n=normalize(fragrance(s))
 for phrase in ('парфюмерная вода','eau de parfum'):n=n.replace(phrase,'edp')
 return n
def label(s):
 v=fragrance(str(s or ''))
 if not 3<=len(v)<=200:raise ValueError('Введите название аромата (от 3 до 200 символов)')
 return v
def init(connect):
 with connect() as c:
  c.executescript('''
CREATE TABLE IF NOT EXISTS competitor_links(fragrance TEXT NOT NULL,site TEXT NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,PRIMARY KEY(fragrance,site));
CREATE TABLE IF NOT EXISTS competitor_checks(id INTEGER PRIMARY KEY,fragrance TEXT NOT NULL,site TEXT NOT NULL,checked_at TEXT NOT NULL,result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS competitor_confirmations(fragrance TEXT NOT NULL,site TEXT NOT NULL,url TEXT NOT NULL,confirmed_at TEXT NOT NULL,PRIMARY KEY(fragrance,site));
CREATE INDEX IF NOT EXISTS competitor_check_lookup ON competitor_checks(fragrance,site,id DESC);
''')
  for key,site in SITES.items():
   if site.get('url'):c.execute('INSERT OR IGNORE INTO competitor_links VALUES(?,?,?,?)',(identity('AMOUAGE — Existence (edp)'),key,'AMOUAGE — Existence (edp)',site['url']))

class Node:
 def __init__(self,tag,attrs=None,parent=None):self.tag=tag;self.attrs=dict(attrs or []);self.parent=parent;self.children=[]
 def text(self):return ' '.join(c if isinstance(c,str) else c.text() for c in self.children if isinstance(c,str) or c.tag not in ('script','style'))
 def walk(self):
  for c in self.children:
   if isinstance(c,Node):yield c;yield from c.walk()
 def cls(self,name):return name in self.attrs.get('class','').split()
 def first(self,predicate):return next((n for n in self.walk() if predicate(n)),None)
class Tree(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=True);self.root=Node('root');self.stack=[self.root];self.nodes=[];self.feed(html)
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs,self.stack[-1]);self.stack[-1].children.append(n);self.nodes.append(n)
  if tag not in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:self.stack=self.stack[:i];break
 def handle_data(self,data):self.stack[-1].children.append(data)
def text_of(n):return re.sub(r'\s+',' ',n.text()).strip() if n else ''
def detect_challenge(tree):
 heads=' '.join(text_of(n) for n in tree.nodes if n.tag in ('title','h1')).casefold()
 if any(token in heads for token in ('checking your browser','checking device','checking browser','just a moment','access denied','доступ ограничен','подтвердите, что вы не робот','проверка браузера')):
  raise CheckIssue('Сайт запросил проверку браузера или ограничил доступ. Автоматическая проверка остановлена.','blocked')
def byclass(n,cls):return n.first(lambda x:x.cls(cls))
def rub(v):
 if v is None:return None
 v=re.sub(r'\s+','',str(v)).replace(',','.')
 m=re.fullmatch(r'(\d+(?:\.\d{1,2})?)(?:руб\.?|р\.?|₽)?',v,re.I)
 if not m:return None
 try:n=Decimal(m[1])*100
 except InvalidOperation:return None
 return int(n) if 0<n<=10000000000 else None
def volume(v):
 m=re.search(r'(\d+(?:[.,]\d+)?)\s*мл',v,re.I)
 return float(Decimal(m[1].replace(',','.'))) if m else None
def kind(description,ml):
 d=description.casefold()
 if 'тестер' in d:return 'tester'
 if 'уцен' in d:return 'discounted'
 if 'фирмен' in d:return 'branded_sample'
 if any(x in d for x in ('атомайзер','отливант','распив')):return 'decant'
 if 'пробник' in d:return 'sample'
 return 'bottle' if ml and ml>=30 else 'unknown'
def concentrations(value):
 n=normalize(value);found=set()
 for token,phrases in {'edp':('edp','парфюмерная вода','eau de parfum'),'edt':('edt','туалетная вода','eau de toilette'),'edc':('edc','одеколон','eau de cologne','cologne')}.items():
  if any((' '+phrase+' ') in (' '+n+' ') for phrase in phrases):found.add(token)
 # Pure parfum/extrait is not the word "parfum" inside "eau de parfum".
 residual=n
 for phrase in ('eau de parfum','eau de toilette','eau de cologne'):residual=residual.replace(phrase,' ')
 if any((' '+phrase+' ') in (' '+residual+' ') for phrase in ('extrait','parfum','духи')):found.add('extrait')
 return found

COLLECTION_PREFIXES={'van cleef arpels':('collection extraordinaire',),'guerlain':("l art la matiere",),'chloe':('atelier des fleurs',),'hugo boss':('the collection',)}
BRAND_ALIASES={'bdk':('bdk parfums',),'initio':('initio parfums prives',),'zarkoperfume':('zarko perfume',),'kilian':('by kilian',),'casamorati':('xerjoff casamorati','casamorati xerjoff')}
def compact(value):
 value=unicodedata.normalize('NFKD',value).casefold()
 value=''.join(c for c in value if not unicodedata.combining(c)).replace('&','')
 value=re.sub(r'\b(?:no|n)\.?\s*(?=\d)','',value)
 return ''.join(re.findall(r'[a-z0-9а-я?]+',re.sub(r'\band\b','',value)))
def name_parts(name):
 clean=re.sub(r'\([^)]*\)','',fragrance(name)).strip()
 parts=re.split(r'\s+[—–-]\s+',clean,maxsplit=1)
 return (parts[0].strip(),parts[1].strip()) if len(parts)==2 else ('',clean)
def brand_forms(brand):
 return sorted({compact(brand),*(compact(x) for x in BRAND_ALIASES.get(normalize(brand),()))},key=len,reverse=True)
def pattern_equal(expected,actual):
 return bool(expected) and bool(re.fullmatch(re.escape(expected).replace(r'\?','[a-zа-я0-9]'),actual))
def model_equal(name,value,slug=False):
 brand,model=name_parts(name);value=re.sub(r'\.(?:html?|php)$','',value,flags=re.I)
 # Generic concentration/merchandise labels are not editions of a fragrance.
 labels=r'(?i)\b(?:extrait de parfum|eau de parfum|eau de toilette|eau de cologne|парфюмерная вода|туалетная вода|одеколон|духи|парфюм|parfum|extrait|edp|edt|edc)\b'
 value=re.sub(r'(?i)туалетная и парфюмерная вода',' ',value)
 value=re.sub(labels,' ',value);model=re.sub(labels,' ',model)
 value=compact(value);wanted=compact(model)
 for b in brand_forms(brand) if brand else []:
  if pattern_equal(b,value[:len(b)]):value=value[len(b):];break
  if pattern_equal(b,value[-len(b):]):value=value[:-len(b)];break
 # Some catalog names repeat their own brand, e.g. Casamorati Lira.
 for b in brand_forms(brand) if brand else []:
  if wanted.startswith(b) and len(wanted)>len(b):wanted=wanted[len(b):];break
 for prefix in COLLECTION_PREFIXES.get(normalize(brand),()):
  prefix=compact(prefix)
  if value.startswith(prefix):value=value[len(prefix):]
  if wanted.startswith(prefix):wanted=wanted[len(prefix):]
 if slug:value=re.sub(r'(?<=\D)\d{6,}$','',value)
 return pattern_equal(wanted,value)
def exact_candidate(name,item):
 if not item.get('brand_found'):return False
 wanted=concentrations(name);found=set(item.get('concentrations',[]))
 if wanted and found and not wanted.issubset(found):return False
 slug=unquote(urlsplit(item['url']).path.rstrip('/').rsplit('/',1)[-1]);slug=re.sub(r'^\d{6,}-','',slug)
 return model_equal(name,slug,slug=True) or model_equal(name,item.get('model_title') or item.get('title',''))
def page_identity(name,heads,url=''):
 brand,model=name_parts(name);forms=brand_forms(brand)
 brand_ok=not brand or any(any(re.search(re.escape(b).replace(r'\?','[a-zа-я0-9]'),compact(h)) for b in forms) for h in heads)
 return brand_ok and any(model_equal(name,h) for h in heads)

def offer(ml,price,description,available,sku='',old=None):
 return {'ml':ml,'price':price,'old_price':old,'description':description,'kind':kind(description,ml),'available':available,'sku':sku,'currency':'RUB','price_type':'Публичная цена; доставка не включена'}
def variant_text(node):
 parent=node.parent
 for _ in range(6):
  if not parent:break
  if parent.cls('product-volume__item') or parent.cls('product-volume__col'):return text_of(parent)
  parent=parent.parent
 return ''

def parse(site,html,name,confirmed=False):
 t=Tree(html);detect_challenge(t)
 heads=[text_of(n) for n in t.nodes if n.tag in ('h1','title')]
 if not confirmed and not page_identity(name,heads):raise CheckIssue('На найденных страницах не подтверждены бренд и точная версия аромата.','needs_match')
 concentration=' '.join(text_of(n) if n.tag=='h1' else re.split(r'(?i)\s[-—]\s|\bкупить\b',text_of(n),maxsplit=1)[0] for n in t.nodes if n.tag in ('h1','title'));wanted=concentrations(name)
 if site=='odekolon':concentration+=' '+text_of(byclass(t.root,'product-info__tags-container'))
 if wanted and not wanted.issubset(concentrations(concentration)):
  # Concentration may be specified only in the actual product variants.
  if site=='randewoo':variants=[n.attrs.get('data-variant','') for n in t.nodes if 'data-product-sku' in n.attrs]
  elif site=='allure':variants=[text_of(byclass(n,'offer-title__name')) for n in t.nodes if n.cls('offer-item')]
  elif site=='odekolon':variants=[n.attrs.get('data-full_name','')+' '+variant_text(n) for n in t.nodes if n.cls('product-volume__input-radio')]
  else:variants=[text_of(n) for n in t.nodes if n.tag=='tr' and n.attrs.get('itemprop')=='offers']
  if not any(wanted.issubset(concentrations(x)) for x in variants):
   actual=concentrations(concentration).union(*(concentrations(x) for x in variants))
   if actual:raise CheckIssue('В вашей карточке указано '+', '.join(sorted(wanted))+', а на странице — '+', '.join(sorted(actual))+'. Концентрации различаются.','concentration_mismatch')
   raise CheckIssue('На странице магазина не указана концентрация; автоматически подтвердить товар нельзя.','needs_match')
 result=[]
 if site=='allure':
  for n in t.nodes:
   if not n.cls('offer-item'):continue
   desc=text_of(byclass(n,'offer-title__name')).replace('что это?','').strip();ml=volume(text_of(byclass(n,'offer-volume')))
   price=rub(text_of(byclass(n,'offer-price--inner')));available=byclass(n,'offer-availability') is not None
   result.append(offer(ml,price,desc,available,text_of(byclass(n,'offer-title__note')),rub(text_of(byclass(n,'offer-discount')))))
 elif site=='odekolon':
  for n in t.nodes:
   if not n.cls('product-volume__input-radio'):continue
   a=n.attrs;ml=volume(a.get('data-volume',a.get('value','')))
   result.append(offer(ml,rub(a.get('data-price')),a.get('data-name','')+' '+a.get('data-type','')+' '+a.get('data-full_name','')+' '+variant_text(n),a.get('data-can_buy')=='1',a.get('data-prod_id',''),rub(a.get('data-old_price'))))
 elif site=='randewoo':
  for n in t.nodes:
   if not n.cls('s-productType') or not n.attrs.get('data-product-sku'):continue
   a=n.attrs;desc=a.get('data-variant','');ml=volume(desc)
   if ml is None:continue
   result.append(offer(ml,rub(a.get('data-price')),desc,True if 'data-can-buy' in a else None,a['data-product-sku']))
 elif site in ('duhi','aromabutik'):
  for n in t.nodes:
   if n.tag!='tr' or not (n.attrs.get('itemprop')=='offers' or n.cls('tr_no_avl') or n.cls('no-stock')):continue
   desc=text_of(n)
   price=n.first(lambda x:x.attrs.get('itemprop')=='price');a=n.first(lambda x:x.attrs.get('itemprop')=='availability')
   availability=(a.attrs.get('href','')+a.attrs.get('content','')) if a else ''
   available=True if 'InStock' in availability or n.cls('tr_avl') else False if 'OutOfStock' in availability or n.cls('tr_no_avl') or n.cls('no-stock') else None
   result.append(offer(volume(text_of(n)),rub(price.attrs.get('content') or text_of(price)) if price else None,desc,available,n.attrs.get('id','')))
 if site=='goldapple':
  payload=next((n for n in t.nodes if n.attrs.get('id')=='aroma-browser-offers'),None)
  if payload:
   for row in json.loads(''.join(c for c in payload.children if isinstance(c,str))):
    prices=[rub(x) for x in row.get('values',[])];prices=[x for x in prices if x is not None]
    ml=volume(str(row.get('ml',''))+' мл')
    if not prices or not ml:continue
    conditional=row.get('conditional',False)
    # The struck-through value is the base price when the first price requires login.
    price=prices[1] if conditional and len(prices)>1 else None if conditional else prices[0]
    r=offer(ml,price,row.get('title',''), 'InStock' in (row.get('available') or ''),str(ml))
    if conditional:
     r['conditional_price']=prices[0];r['price_type']='Базовая цена без авторизации; отдельно указана цена при авторизации'
    r['url']=row.get('url','');result.append(r)
 clean=[];seen=set()
 for r in result:
  if r['ml'] is None:continue
  specified=concentrations(r['description'])
  if specified and wanted and not wanted.issubset(specified):continue
  if wanted and not specified and len(concentrations(concentration))>1:continue
  r['concentration']=sorted(specified or concentrations(concentration))
  key=(r['sku'],r['ml'],r['kind'])
  if key not in seen:clean.append(r);seen.add(key)
 if not clean:
  summary=byclass(t.root,'b-productSummary') if site=='randewoo' else None
  if summary and 'нет в наличии' in text_of(summary).lower():raise CheckIssue('На странице магазина товар отмечен как отсутствующий. Текущих предложений по объёмам нет.','out_of_stock')
  actual=set().union(*(concentrations(r['description']) for r in result)) if result else set()
  if wanted and actual and not wanted.issubset(actual):raise CheckIssue('В вашей карточке указано '+', '.join(sorted(wanted))+', а магазин предлагает '+', '.join(sorted(actual))+'. Концентрации различаются.','concentration_mismatch')
  raise ValueError('Варианты объёма не найдены: возможно, сайт изменился или ограничил доступ')
 return clean

def validate_url(site,url):
 if site not in SITES:raise ValueError('Неизвестный конкурент')
 p=urlsplit(str(url).strip());host=p.hostname
 if not host:raise ValueError('Укажите ссылку на карточку товара')
 host=host.encode('idna').decode('ascii').lower()
 if host not in (SITES[site]['host'],'www.'+SITES[site]['host']) or p.scheme!='https' or p.username or p.password or p.port not in (None,443):raise ValueError('Разрешён только HTTPS выбранного магазина')
 if len(url)>1500 or any(x in (p.query or '').lower() for x in ('action=buy','add2basket','action=add')):raise ValueError('Нужна ссылка на товар, без действия покупки')
 return urlunsplit(('https',host,p.path or '/',p.query,''))
def public_addresses(host):
 addrs=list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
 if not addrs or any(not ipaddress.ip_address(ip).is_global for ip in addrs):raise ValueError('Недопустимый сетевой адрес')
 return sorted(addrs,key=lambda ip:ipaddress.ip_address(ip).version)
class PublicHTTPS(http.client.HTTPSConnection):
 def connect(self):
  addresses=public_addresses(self.host)
  # Pin the validated public IP for this connection, while keeping TLS hostname verification.
  proxy=urllib.request.getproxies().get('https')
  if proxy:
   # Honour the user's existing system proxy, never an address supplied by a page/request.
   # CONNECT targets the validated numeric IP, so the proxy cannot re-resolve the target.
   p=urlsplit(proxy)
   if p.scheme!='http' or not p.hostname:raise ValueError('Неподдерживаемый системный прокси')
   tunnel=http.client.HTTPConnection(p.hostname,p.port or 80,timeout=self.timeout)
   headers={}
   if p.username:headers['Proxy-Authorization']='Basic '+base64.b64encode((p.username+':'+(p.password or '')).encode()).decode()
   tunnel.set_tunnel(addresses[0],443,headers=headers)
   try:tunnel.connect();sock=tunnel.sock
   except Exception:tunnel.close();raise
  else:sock=socket.create_connection((addresses[0],443),timeout=self.timeout)
  try:self.sock=self._context.wrap_socket(sock,server_hostname=self.host)
  except Exception:sock.close();raise
def fetch(site,url):
 if SITES[site].get('mode')=='browser':
  import browser_reader
  try:return browser_reader.read(site,validate_url(site,url),public_addresses)
  except browser_reader.BrowserReadError as e:raise CheckIssue(str(e),e.status)
 started=time.monotonic()
 for _ in range(4):
  url=validate_url(site,url);p=urlsplit(url);conn=PublicHTTPS(p.hostname,timeout=8,context=ssl.create_default_context())
  try:
   conn.request('GET',p.path+('?' +p.query if p.query else ''),headers={'User-Agent':'Mozilla/5.0 (compatible; AromaPriceComparison/1.0)','Accept-Language':'ru,en;q=0.7','Accept-Encoding':'identity'})
   response=conn.getresponse()
   if response.status in (301,302,303,307,308):
    url=urljoin(url,response.getheader('Location',''));continue
   if response.status!=200:raise CheckIssue('Сайт вернул HTTP '+str(response.status)+'. Цена не обновлена','blocked' if response.status in (401,403,429,503) else 'network_error')
   content_type=response.getheader('Content-Type','')
   if not any(t in content_type.lower() for t in ('text/html','application/xhtml')):raise ValueError('Сайт вернул не HTML-страницу')
   if response.getheader('Content-Encoding','identity') not in ('','identity'):raise ValueError('Неподдерживаемое сжатие ответа')
   chunks=[];size=0
   while True:
    if time.monotonic()-started>18:raise ValueError('Превышено время ожидания страницы')
    data=response.read(65536)
    if not data:break
    size+=len(data)
    if size>4_000_000:raise ValueError('Страница слишком большая')
    chunks.append(data)
   raw=b''.join(chunks);match=re.search(r'charset=["\']?([\w-]+)',content_type,re.I)
   enc=match[1] if match else ('cp1251' if b'windows-1251' in raw[:3000].lower() else 'utf-8')
   return raw.decode(enc,errors='replace'),url
  finally:conn.close()
 raise ValueError('Слишком много перенаправлений')

def variant_difference(name,description):
 chosen=set(normalize(name).split());seen=set(normalize(description).split())
 extra=(seen-chosen)&{'red','limited','edition','intense','intens','extreme','elixir','absolu','absolue'}
 return ', '.join(sorted(extra))
def search_terms(name):
 brand,model=name_parts(name)
 reliable=lambda text:' '.join(word for word in text.split() if '?' not in word)
 full=reliable((brand+' '+model).strip());short=reliable(model)
 return list(dict.fromkeys(q for q in (full,short) if q)),normalize(brand)

def product_url(site,url):
 p=urlsplit(validate_url(site,url))
 valid=('/katalog/' in p.path and p.path.endswith('.html')) if site=='allure' else '/product/' in p.path if site in ('randewoo','aromabutik') else bool(re.fullmatch(r'/[0-9]{6,}-[^/]+/?',p.path)) if site=='goldapple' else '/catalog/' in p.path
 if not valid:raise ValueError('Нужна карточка товара')
 return urlunsplit((p.scheme,p.netloc,p.path,'',''))
def find_candidates(site,name):
 if not SITES[site].get('search'):
  html,_=fetch(site,'https://'+SITES[site]['host']+'/');detect_challenge(Tree(html))
  raise CheckIssue('Магазин добавлен в список. Автоматический поиск и получение цен пока не подключены. Откройте сайт отдельно.','manual_source')
 cache_key=(site,identity(name));cached=SEARCH_CACHE.get(cache_key)
 if cached and time.monotonic()-cached[0]<60:return {**cached[1],'cached':True}
 delay=3-(time.monotonic()-SEARCH_LAST.get(site,-100))
 if delay>0:time.sleep(delay)
 queries,brand=search_terms(name);short=queries[-1] if queries else '';wanted=normalize(short).split();found={};used=[]
 raw_brand=name_parts(name)[0]
 brand_query=' '.join(word for word in raw_brand.split() if '?' not in word)
 if len(compact(brand_query))>=3 and brand_query not in queries:queries.append(brand_query)
 for i,q in enumerate(queries):
  if i:time.sleep(.4)
  search_url='https://'+SITES[site]['host']+SITES[site]['search']+urlencode({'q':q})[2:]
  SEARCH_LAST[site]=time.monotonic();html,_=fetch(site,search_url);used.append(q)
  tree=Tree(html);detect_challenge(tree)
  for node in tree.nodes:
   if node.tag!='a':continue
   title=(text_of(node)+' '+node.attrs.get('title','')).strip();model_title=node.attrs.get('title','') or text_of(node)
   picture=node.first(lambda x:x.tag=='img')
   if picture:
    title+=' '+picture.attrs.get('alt','')
    model_title=picture.attrs.get('alt','') or model_title
   try:url=product_url(site,urljoin(search_url,node.attrs.get('href','')))
   except ValueError:continue
   evidence=compact(title+' '+unquote(url))
   if not short or compact(short) not in evidence:continue
   photo=''
   if picture:
    for attr in ('data-src','src'):
     try:photo=validate_url(site,urljoin(search_url,picture.attrs.get(attr,''))) if picture.attrs.get(attr) else ''
     except ValueError:photo=''
     if photo:break
   context=title+' '+unquote(url)
   parent=node.parent
   for _ in range(2):
    if not parent:break
    parent_text=text_of(parent)
    if len(parent_text)<1800:context+=' '+parent_text
    parent=parent.parent
   known_brand=bool(brand) and any(re.search(re.escape(b).replace(r'\?','[a-zа-я0-9]'),compact(context)) for b in brand_forms(name_parts(name)[0]))
   item={'url':url,'model_title':model_title,'title':re.sub(r'\s+',' ',title).strip()[:350] or q,'image':photo,'brand_found':known_brand,'variant_warning':variant_difference(name,title+' '+unquote(url)),'concentrations':sorted(concentrations(title))}
   if url not in found or len(item['title'])>len(found[url]['title']):found[url]=item
  if any(exact_candidate(name,x) for x in found.values()):break
 result={'site':site,'name':name,'queries':used,'candidates':sorted(found.values(),key=lambda x:(bool(x['variant_warning']),not x['brand_found'],x['title']))[:24],'cached':False}
 SEARCH_CACHE[cache_key]=(time.monotonic(),result)
 if len(SEARCH_CACHE)>300:SEARCH_CACHE.pop(next(iter(SEARCH_CACHE)))
 return result
def discovery(site,name):
 result=find_candidates(site,name);items=result['candidates']
 if not items:raise CheckIssue('Совпадений нет. Попробуйте другое написание или укажите точную ссылку.','not_found')
 exact=[item for item in items if exact_candidate(name,item)]
 if exact:return exact[0]['url']
 # Single results still need strict validation of the actual product page.
 if len(items)==1 and not items[0].get('variant_warning'):return items[0]['url']
 error=CheckIssue('Автоматическая проверка найденных вариантов пока не подтвердила точную версию аромата.','needs_match');error.candidates=items;raise error


def state(connect):
 with connect() as c:
  links=[dict(x) for x in c.execute('SELECT * FROM competitor_links')];choices={}
  has_sales=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_catalog'").fetchone()
  rows=c.execute("SELECT p.id,p.name,p.kind,p.capacity,p.sale"+(",s.price AS sales_price" if has_sales else '')+" FROM products p "+("LEFT JOIN sales_catalog s ON s.source_id=p.id " if has_sales else '')+"WHERE p.kind IN ('decant','bottle')").fetchall()
  for row in rows:
   p=dict(row);name=fragrance(p['name']);key=identity(name);entry=choices.setdefault(key,{'key':key,'name':name,'own':[]})
   entry['own'].append({'id':p['id'],'name':p['name'],'kind':p['kind'],'ml':p['capacity']/1000 if p['capacity'] else volume(p['name']),'price':p.get('sales_price') if has_sales else p['sale']})
  latest=[]
  for row in c.execute('SELECT result FROM competitor_checks WHERE id IN (SELECT max(id) FROM competitor_checks GROUP BY fragrance,site)'):latest.append(json.loads(row[0]))
 return {'sites':[{'id':k,'name':v['name'],'host':v['host'],'mode':v.get('mode','automatic'),'note':v.get('note','')} for k,v in SITES.items()],'fragrances':sorted(choices.values(),key=lambda x:x['name'].casefold()),'links':links,'results':latest}
def handle(path,d,connect):
 if not isinstance(d,dict):raise ValueError('Неверный запрос')
 name=label(d.get('name'));key=identity(name);site=d.get('site');lookup_name=name
 if site not in SITES:raise ValueError('Выберите конкурента')
 if path=='/api/competitors/select':
  url=product_url(site,str(d.get('url','')))
  with connect() as c:
   c.execute('INSERT INTO competitor_links VALUES(?,?,?,?) ON CONFLICT(fragrance,site) DO UPDATE SET name=excluded.name,url=excluded.url',(key,site,name,url))
   c.execute('INSERT INTO competitor_confirmations VALUES(?,?,?,?) ON CONFLICT(fragrance,site) DO UPDATE SET url=excluded.url,confirmed_at=excluded.confirmed_at',(key,site,url,datetime.now().astimezone().isoformat(timespec='microseconds')))
  return {'ok':True}
 if path=='/api/competitors/search':
  if not LOCKS[site].acquire(blocking=False):raise ValueError('Дождитесь текущей проверки этого сайта')
  try:
   try:return {**find_candidates(site,lookup_name),'status':'ok'}
   except CheckIssue as e:return {'status':e.status,'error':str(e),'candidates':[],'site':site,'name':name}
   except (TimeoutError,OSError,http.client.HTTPException) as e:return {'status':'network_error','error':'Не удалось получить поиск: '+str(e)[:250],'candidates':[],'site':site,'name':name}
   except (ValueError,LookupError) as e:return {'status':'error','error':str(e)[:300],'candidates':[],'site':site,'name':name}
  finally:LOCKS[site].release()
 if path=='/api/competitors/link':
  url=validate_url(site,str(d.get('url','')))
  with connect() as c:c.execute('INSERT INTO competitor_links VALUES(?,?,?,?) ON CONFLICT(fragrance,site) DO UPDATE SET name=excluded.name,url=excluded.url',(key,site,name,url))
  return {'ok':True}
 if path!='/api/competitors/check':raise ValueError('Неизвестная операция')
 if not LOCKS[site].acquire(blocking=False):raise ValueError('Этот сайт уже проверяется. Дождитесь результата')
 try:
  with connect() as c:
   link=c.execute('SELECT url FROM competitor_links WHERE fragrance=? AND site=?',(key,site)).fetchone()
   confirmation=c.execute('SELECT url,confirmed_at FROM competitor_confirmations WHERE fragrance=? AND site=?',(key,site)).fetchone()
   previous=c.execute('SELECT result FROM competitor_checks WHERE fragrance=? AND site=? ORDER BY id DESC LIMIT 1',(key,site)).fetchone()
   # Per-site cooldown, including different fragrances. No hidden recurring jobs.
   recent=c.execute('SELECT checked_at FROM competitor_checks WHERE site=? ORDER BY id DESC LIMIT 1',(site,)).fetchone()
  if previous:
   cached=json.loads(previous[0]);age=(datetime.now().astimezone()-datetime.fromisoformat(cached['checked_at'])).total_seconds()
   fresh_confirmation=confirmation and cached.get('confirmation_stamp')!=confirmation['confirmed_at']
   if age<60 and cached.get('search_version')==SEARCH_VERSION and not fresh_confirmation and (not link or cached.get('url')==link[0]):return {**cached,'cached':True}
  if recent and (datetime.now().astimezone()-datetime.fromisoformat(recent[0])).total_seconds()<3:raise ValueError('Подождите несколько секунд перед следующим запросом к сайту')
  url=link[0] if link else ''
  result={'fragrance':key,'name':name,'site':site,'url':url,'checked_at':now(),'status':'error','offers':[],'cached':False}
  try:
   discovered=not bool(url)
   result['search_version']=SEARCH_VERSION
   result['confirmation_stamp']=confirmation['confirmed_at'] if confirmation else None
   urls=[url] if url else [];issues=[];checked=[];accepted=[];all_offers=[]
   def attempt(candidate_url):
    if candidate_url in checked:return
    checked.append(candidate_url)
    try:
     html,actual=fetch(site,candidate_url)
     offers=parse(site,html,lookup_name,confirmed=bool(confirmation and confirmation['url']==actual))
     if actual not in accepted:
      accepted.append(actual);all_offers.extend({**r,'url':r.get('url') or actual} for r in offers)
    except CheckIssue as issue:
     issue.url=locals().get('actual',candidate_url);issues.append(issue)
    except (TimeoutError,OSError,http.client.HTTPException) as issue:issues.append(CheckIssue('Не удалось получить страницу: '+str(issue)[:250],'network_error'))
    except (ValueError,LookupError) as issue:issues.append(CheckIssue(str(issue)[:300],'error'))
   # Reuse verified routes; a failed old route triggers a fresh automatic search.
   if previous and not confirmation:
    previous_result=json.loads(previous[0])
    if previous_result.get('search_version')==SEARCH_VERSION:urls+=previous_result.get('matched_urls',[])
   for candidate_url in dict.fromkeys(urls):attempt(candidate_url)
   if not confirmation and (not accepted or not url):
    try:
     primary=discovery(site,lookup_name)
     search=SEARCH_CACHE.get((site,identity(lookup_name)));candidates=search[1]['candidates'] if search else []
     urls=[primary]+[item['url'] for item in candidates if exact_candidate(lookup_name,item)]
    except CheckIssue as issue:
     candidates=getattr(issue,'candidates',[])
     if issue.status!='needs_match' or not candidates:raise
     urls=[item['url'] for item in candidates if item.get('brand_found') or not item.get('model_title') or model_equal(lookup_name,item['model_title'])]
     if not urls:raise CheckIssue('В результатах магазина нет товара с совпадающим брендом и точным названием.','not_found')
    result['candidates']=candidates
    # Verify the actual pages instead of asking the owner to inspect every search hit.
    for candidate_url in list(dict.fromkeys(urls))[:8]:
     if any(issue.status=='blocked' for issue in issues):break
     attempt(candidate_url)
   if not accepted:
    if issues:
     chosen=next((issue for status in ('blocked','network_error','concentration_mismatch','out_of_stock','needs_match','error') for issue in issues if issue.status==status),issues[0])
     chosen.candidates=result.get('candidates',[])
     if getattr(chosen,'url',None):result['url']=chosen.url
     if chosen.status=='needs_match' and str(chosen).startswith('На найденных страницах'):chosen.status='not_found'
     raise chosen
    raise CheckIssue('Подходящие страницы аромата не найдены.','not_found')
   result.update(url=accepted[0],matched_urls=accepted,offers=all_offers,status='ok',attempted_urls=checked)
   if not confirmation:
    with connect() as c:c.execute('INSERT INTO competitor_links VALUES(?,?,?,?) ON CONFLICT(fragrance,site) DO UPDATE SET url=excluded.url,name=excluded.name',(key,site,name,accepted[0]))
   result['checked_at']=now()
  except CheckIssue as e:
   result.update(status=e.status,error=str(e)[:400])
   result['candidates']=getattr(e,'candidates',[])
   if e.status=='needs_match' and not result['candidates']:
    cached_search=SEARCH_CACHE.get((site,identity(lookup_name)))
    if cached_search:result['candidates']=cached_search[1]['candidates']
  except (TimeoutError,OSError,http.client.HTTPException) as e:result.update(status='network_error',error='Не удалось получить страницу: '+str(e)[:300])
  except (ValueError,LookupError) as e:result['error']=str(e)[:400]
  result['checked_at']=now()
  with connect() as c:c.execute('INSERT INTO competitor_checks(fragrance,site,checked_at,result) VALUES(?,?,?,?)',(key,site,result['checked_at'],dump(result)))
  return result
 finally:LOCKS[site].release()
