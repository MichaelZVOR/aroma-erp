"""Арома. Локальный склад и производство; Python 3.10+, standard library."""
import competitors as competitors_module
import sales as sales_module
import product_cards as product_cards_module
import warehouse as warehouse_module
import calculator_v3 as calculator_v3_module
import base64,csv,hashlib,io,json,os,re,secrets,sqlite3,sys,threading,uuid,webbrowser
from html.parser import HTMLParser
from datetime import datetime
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP,ROUND_CEILING,ROUND_FLOOR
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,unquote,parse_qs,quote as urlquote

ROOT=Path(__file__).resolve().parent
DATA=Path(os.environ.get('AROMA_DATA_DIR',str(ROOT/'data')))
PORT=int(os.environ.get('AROMA_PORT','8788'))
DB=DATA/'aroma.sqlite3'
TOKEN=secrets.token_urlsafe(32)
VERSION='1.1'
FILES=['server.py','static/index.html','static/app.js','static/style.css','seed.json']
def signature():
 h=hashlib.sha256()
 for name in FILES:h.update((ROOT/name).read_bytes())
 return h.hexdigest()
SIGNATURE=None
KINDS={'bottle':'Полноразмерные флаконы','liquid':'Парфюм в мл','atom':'Атомайзеры','label':'Наклейки','other':'Прочие материалы','decant':'Готовые распивы'}
DEFAULTS={'work':'8','work_mode':'ml','fees':[{'name':'Продавцу','rate':'10'},{'name':'Эквайринг','rate':'3'},{'name':'Реклама','rate':'5'},{'name':'Прочие расходы с продажи','rate':'2'}],'multipliers':{'1':None,'2':'3','3':'2.9','5':'2.8','10':'2.5'},'round_step':'10'}

class Connection(sqlite3.Connection):
 def __exit__(self,*args):
  try:return super().__exit__(*args)
  finally:self.close()
def connect():
 c=sqlite3.connect(DB,timeout=20,factory=Connection);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');return c
def now():return datetime.now().astimezone().isoformat(timespec='seconds')
def dump(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'))
def dec(x,label='Число'):
 try:d=Decimal(str(x).strip().replace(',','.'))
 except (ValueError,InvalidOperation):raise ValueError('Проверьте поле: '+label)
 if not d.is_finite() or d<0 or d>Decimal('100000000'):raise ValueError('Проверьте поле: '+label)
 return d
def amount(x,scale=100,label='Сумма',positive=False):
 d=dec(x,label);v=d*scale
 if (positive and not d) or v!=v.to_integral_value():raise ValueError('Недопустимое значение: '+label)
 return int(v)
def optional(x,scale=100,label='Сумма'):return None if x is None or str(x).strip()=='' else amount(x,scale,label)
def rounded(x):return int(Decimal(x).quantize(Decimal(1),rounding=ROUND_HALF_UP))
def title(x,maxlen=300):
 text=str(x or '').strip()
 if not text or len(text)>maxlen:raise ValueError('Введите название (до '+str(maxlen)+' символов)')
 return text
def note(x):
 s=str(x or '').strip()
 if len(s)>1500:raise ValueError('Заметка слишком длинная')
 return s
def clean_name(s):
 import re
 return re.sub(r'\s*—\s*ОБЪЁМ\s*$','',s,flags=re.I).strip()
def init():
 DATA.mkdir(parents=True,exist_ok=True)
 if DB.exists():backup()
 with connect() as c:
  c.execute('PRAGMA journal_mode=WAL')
  c.executescript('''
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,capacity INTEGER,sale INTEGER,source_id TEXT,note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'posted',request_key TEXT UNIQUE NOT NULL,description TEXT NOT NULL,details TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lots(id INTEGER PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),date TEXT NOT NULL,qty INTEGER NOT NULL,remaining INTEGER NOT NULL,total_cost INTEGER NOT NULL,remaining_cost INTEGER NOT NULL,capacity INTEGER,document_id INTEGER NOT NULL REFERENCES documents(id),status TEXT NOT NULL DEFAULT 'active',CHECK(qty>0),CHECK(remaining>=0 AND remaining<=qty),CHECK(remaining_cost>=0));
CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,doc_id INTEGER NOT NULL REFERENCES documents(id),lot_id INTEGER NOT NULL REFERENCES lots(id),qty INTEGER NOT NULL,cost INTEGER NOT NULL,date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cost_calculations(id TEXT PRIMARY KEY,name TEXT NOT NULL,payload TEXT NOT NULL,updated TEXT NOT NULL);
''')
  replaced=c.execute("SELECT 1 FROM sqlite_master WHERE name='catalog_members'").fetchone() and c.execute('SELECT 1 FROM catalog_members LIMIT 1').fetchone()
  for p in ([] if replaced else json.loads((ROOT/'seed.json').read_text(encoding='utf8'))):
   c.execute('INSERT OR IGNORE INTO products(id,code,name,kind) VALUES(?,?,?,?)',('b:'+p['code'],p['code'],p['name'],'bottle'))
  c.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',('config',dump(DEFAULTS)))
 competitors_module.init(connect)
 sales_module.init(connect)
 warehouse_module.init(connect)
 product_cards_module.init(connect)
 product_cards_module.move_opening_categories(connect,now())
 backup()
def config(c):return json.loads(c.execute("SELECT value FROM settings WHERE key='config'").fetchone()[0])
def fee_rate(s):return sum((dec(x['rate']) for x in s['fees']),Decimal(0))/100
def state():
 with connect() as c:
  products=[dict(x) for x in c.execute('SELECT * FROM products ORDER BY name COLLATE NOCASE')]
  manifest=ROOT/'static'/'image-map.json'
  images=json.loads(manifest.read_text(encoding='utf8')) if manifest.exists() else {}
  details=product_cards_module.profiles(c)
  photo_ids={row[0] for row in c.execute('SELECT product_id FROM product_photos')}
  by_id={p['id']:p for p in products}
  for p in products:
   p['profile']=details.get(p['id'],{})
   source=p;seen=set();p['image']=None
   while source and source['id'] not in seen:
    seen.add(source['id'])
    if source['id'] in photo_ids:p['image']='/product-photo/'+urlquote(source['id'],safe='');break
    filename=images.get(source['code'])
    if filename and re.fullmatch(r'[a-f0-9]{24}\.(?:png|jpe?g|webp)',filename):
     p['image']='/images/'+filename;break
    source=by_id.get(source.get('source_id'))
  return {'version':VERSION,'token':TOKEN,'products':products, 'lots':[dict(x) for x in c.execute('SELECT * FROM lots ORDER BY id DESC')], 'documents':[dict(x) for x in c.execute('SELECT * FROM documents ORDER BY id DESC')], 'movements':[dict(x) for x in c.execute('SELECT * FROM movements ORDER BY id DESC')], 'settings':config(c),'kinds':KINDS,'data_folder':str(DATA)}
def calculator_state():
 seed=ROOT/'calculator-seed.json'
 with connect() as c:
  saved=[dict(x) for x in c.execute('SELECT * FROM cost_calculations ORDER BY updated DESC,id')]
 for row in saved:row['payload']=json.loads(row['payload'])
 return {'presets':json.loads(seed.read_text(encoding='utf8'))['presets'] if seed.exists() else [],'saved':saved}

def discount_analysis(cost,sale,recommended,rate,target=None,discount=0):
 # Money stays in Decimal. Discount limits are rounded DOWN, never above the safe limit.
 target=None if target is None or target=='' else Decimal(amount(target,100,'Минимальный остаток с продажи'))/100
 discount=Decimal(amount(0 if discount is None or discount=='' else discount,100,'Проверяемая скидка'))/100
 if discount>100:raise ValueError('Скидка должна быть от 0 до 100%')
 base=sale if sale is not None else recommended
 cents=lambda v:v.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
 text=lambda v:None if v is None else str(v)
 floor_price=limit=at_limit=remaining_at_limit=None
 if cost is not None and target is not None:
  floor_price=((cost+target)/(1-rate)).quantize(Decimal('.01'),rounding=ROUND_CEILING)
  if base is not None and base>0 and base>=floor_price:
   limit=((base-floor_price)/base*100).quantize(Decimal('.01'),rounding=ROUND_FLOOR)
   at_limit=cents(base*(1-limit/100))
   remaining_at_limit=at_limit*(1-rate)-cost
 price=cents(base*(1-discount/100)) if base is not None else None
 gross=price-cost if price is not None and cost is not None else None
 remaining=price*(1-rate)-cost if gross is not None else None
 margin=gross/price*100 if gross is not None and price>0 else None
 status='incomplete' if remaining is None else 'target_not_set' if target is None else 'below_target' if remaining<target else 'meets_target'
 base_gross=base-cost if base is not None and cost is not None else None
 return {'base_price':text(base),'base_source':'manual' if sale is not None else 'recommended','target':text(target),'minimum_price':text(floor_price),'max_discount':text(limit),'price_at_max':text(at_limit),'remaining_at_max':text(remaining_at_limit),'check_discount':text(discount),'check_price':text(price),'check_gross':text(gross),'check_margin':text(margin),'check_remaining':text(remaining),'status':status,'base_remaining':text(base*(1-rate)-cost if base is not None and cost is not None else None),'base_gross':text(base_gross),'base_margin':text(base_gross/base*100 if base_gross is not None and base>0 else None),'base_markup':text(base_gross/cost*100 if base_gross is not None and cost>0 else None),'base_expenses':text(base*rate if base is not None else None)}

def calculator_quote(d):
 if isinstance(d,dict) and d.get('pricing_model')==calculator_v3_module.MODEL:return calculator_v3_module.quote(d)
 if not isinstance(d,dict):raise ValueError('Неверный расчёт')
 def optional_number(x,label):return None if x is None or x=='' else dec(x,label)
 def cash(x,label):
  value=optional_number(x,label)
  if value is not None:amount(x,100,label)
  return value
 def up(x,step=Decimal(1)):return (x/step).to_integral_value(rounding=ROUND_CEILING)*step
 def text(x):return None if x is None else str(x)
 def delivery(item,label):
  if not isinstance(item,dict) or item.get('mode') not in ('unit','box'):raise ValueError('Выберите способ распределения доставки')
  value=cash(item.get('amount'),label)
  if item['mode']=='unit':return value
  count=optional_number(item.get('count'),'Количество в коробке')
  if count is None:return None
  if count<=0 or count!=count.to_integral_value():raise ValueError('Количество в коробке должно быть целым и больше нуля')
  return None if value is None else value/count
 perfume=d.get('perfume')
 if not isinstance(perfume,dict):raise ValueError('Укажите параметры флакона')
 price=cash(perfume.get('price'),'Цена закупки флакона')
 volume=optional_number(perfume.get('volume'),'Объём флакона')
 if volume is not None and (volume<=0 or volume*1000!=(volume*1000).to_integral_value()):raise ValueError('Объём должен быть больше нуля, точность до 0,001 мл')
 bottle_shipping=delivery(perfume.get('delivery'),'Доставка духов')
 atom_shipping=delivery(d.get('atom_delivery'),'Доставка атомайзеров')
 label=cash(d.get('label'),'Этикетка');work=cash(d.get('work'),'Работа за мл')
 step=cash(d.get('round_step'),'Шаг округления')
 if step is None or step<=0:raise ValueError('Шаг округления цены должен быть больше нуля')
 if not isinstance(d.get('round_cost'),bool):raise ValueError('Выберите округление себестоимости')
 fees=d.get('fees')
 if not isinstance(fees,list) or len(fees)!=4:raise ValueError('Укажите четыре вида переменных расходов')
 rates=[dec(f.get('rate'),'Процент расходов') for f in fees]
 rate=sum(rates,Decimal(0))/100
 if rate>=1:raise ValueError('Сумма переменных расходов должна быть меньше 100%')
 landed=price+bottle_shipping if price is not None and bottle_shipping is not None else None
 base_model=d.get('pricing_model')=='base_ml_v2'
 loss=dec(d.get('loss_percent',2 if base_model else 0),'Потери при распиве')
 if loss>=100:raise ValueError('Потери при распиве должны быть меньше 100%')
 delivery_only=landed/volume if landed is not None and volume is not None else None
 usable_volume=volume*(1-loss/100) if volume is not None else None
 exact=landed/usable_volume if landed is not None and usable_volume is not None else None
 per_ml=up(exact) if d['round_cost'] and exact is not None else exact
 if not isinstance(d.get('rows'),dict):raise ValueError('Укажите упаковку для объёмов')
 one_coef=optional_number(d.get('one_ml_coefficient',d['rows'].get('1',{}).get('coefficient')),'Коэффициент цены 1 мл')
 if one_coef is not None and (one_coef<=0 or one_coef>100):raise ValueError('Коэффициент цены 1 мл должен быть больше 0 и не больше 100')
 one_cost=one_minimum=one_price=None
 if per_ml is not None and work is not None and (base_model or label is not None):
  one_cost=per_ml+work+(0 if base_model else label)
  one_cost=up(one_cost) if d['round_cost'] else one_cost.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
  one_minimum=up(one_cost/(1-rate),Decimal('.01'))
  if one_coef is not None:one_price=up(max(one_cost*one_coef,one_minimum),step)
 one_ml={'cost':text(one_cost),'minimum':text(one_minimum),'price':text(one_price),'coefficient':text(one_coef),'parts':{'liquid':text(per_ml),'work':text(work),'label':text(Decimal(0) if base_model else label)}}
 one_row=d['rows'].get('1',{})
 one_sale=cash(one_row.get('sale'),'Цена продажи 1 мл')
 one_analysis=discount_analysis(one_cost,one_sale,one_price,rate,one_row.get('target_remaining'),one_row.get('check_discount',0))
 one_ml.update(ml=1,recommended=text(one_price),sale=text(one_sale),missing=[] if one_cost is not None else ['закупка, объём, доставка и работа'],discount_analysis=one_analysis)
 results=[]
 for ml in (1,2,3,5,10):
  row=d['rows'].get(str(ml),{})
  if not isinstance(row,dict):raise ValueError('Проверьте строку объёма '+str(ml))
  atom=cash(row.get('atom_price'),'Цена атомайзера '+str(ml)+' мл')
  coef=optional_number(row.get('coefficient'),'Коэффициент '+str(ml)+' мл')
  if coef is not None and (coef<=0 or coef>100):raise ValueError('Коэффициент должен быть больше 0 и не больше 100')
  sale=cash(row.get('sale'),'Цена продажи '+str(ml)+' мл')
  missing=[]
  if per_ml is None:missing.append('цена, объём и доставка духов')
  if atom is None:missing.append('цена атомайзера')
  if atom_shipping is None:missing.append('сумма доставки атомайзеров и количество в коробке')
  if label is None:missing.append('стоимость этикетки')
  if work is None:missing.append('стоимость работы')
  parts={'liquid':None,'atom':atom,'atom_delivery':atom_shipping,'label':label,'work':None}
  cost=packaging=gross=margin=net=minimum=discount=recommended=None
  if not missing:
   packaging=atom+atom_shipping+label
   if d['round_cost']:packaging=up(packaging)
   parts['liquid']=per_ml*ml;parts['work']=work*ml
   cost=packaging+parts['liquid']+parts['work']
   cost=up(cost) if d['round_cost'] else cost.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
   recommended=up(cost*coef,step) if coef is not None else None
   minimum=up(cost/(1-rate),Decimal('.01'))
   if sale is not None:
    gross=sale-cost;net=sale*(1-rate)-cost
    if sale>0:
     margin=gross/sale*100
     if sale>=minimum:discount=(sale-minimum)/sale*100
  analysis=discount_analysis(cost,sale,recommended,rate,row.get('target_remaining'),row.get('check_discount',0))
  results.append({'ml':ml,'missing':missing,'cost':text(cost),'packaging':text(packaging),'recommended':text(recommended),'sale':text(sale),'gross':text(gross),'margin':text(margin),'net':text(net),'minimum':text(minimum),'max_discount':text(discount),'below_minimum':sale is not None and minimum is not None and sale<minimum,'parts':{k:text(v) for k,v in parts.items()},'discount_analysis':analysis})
 return {'bottle_delivery':text(bottle_shipping),'atom_delivery':text(atom_shipping),'bottle_landed':text(landed),'per_ml_delivery_only':text(delivery_only),'usable_volume':text(usable_volume),'loss_percent':text(loss),'per_ml_exact':text(exact),'per_ml':text(per_ml),'fees_percent':text(rate*100),'rows':results,'one_ml':one_ml}

def calculator_save(d):
 payload=d.get('payload');calculator_quote(payload)
 name=title(payload.get('name'))
 ident=str(d.get('id') or uuid.uuid4())
 if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',ident):raise ValueError('Неверный идентификатор расчёта')
 updated=now()
 with connect() as c:
  c.execute('BEGIN IMMEDIATE')
  previous=c.execute('SELECT payload FROM cost_calculations WHERE id=?',(ident,)).fetchone()
  if previous and (json.loads(previous['payload']).get('pricing_model')==calculator_v3_module.MODEL)!=(payload.get('pricing_model')==calculator_v3_module.MODEL):raise ValueError('Сохраните новую версию отдельной копией; прежняя формула остаётся в старом расчёте')
  c.execute('INSERT INTO cost_calculations(id,name,payload,updated) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated=excluded.updated',(ident,name,dump(payload),updated))
 return {'ok':True,'id':ident,'updated':updated}

def lot(c,ident):
 row=c.execute('SELECT l.*,p.name,p.kind,p.code FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=?',(ident,)).fetchone()
 if not row or row['status']!='active':raise ValueError('Выберите действующую партию')
 return dict(row)
def require_quantity(l,raw):return amount(raw,1000 if l['kind']=='liquid' else 1,'Количество',True)
def cost_of(l,qty):
 if qty>l['remaining']:raise ValueError('Недостаточно остатка: '+l['name'])
 if not l['remaining']:raise ValueError('Партия израсходована: '+l['name'])
 return l['remaining_cost'] if qty==l['remaining'] else rounded(Decimal(l['remaining_cost'])*qty/l['remaining'])
def document(c,kind,key,description,details):
 cur=c.execute('INSERT INTO documents(kind,date,request_key,description,details) VALUES(?,?,?,?,?)',(kind,now(),key,description,dump(details)))
 return cur.lastrowid
def take(c,doc,l,qty):
 cost=cost_of(l,qty)
 c.execute('UPDATE lots SET remaining=remaining-?,remaining_cost=remaining_cost-? WHERE id=?',(qty,cost,l['id']))
 c.execute('INSERT INTO movements(doc_id,lot_id,qty,cost,date) VALUES(?,?,?,?,?)',(doc,l['id'],-qty,-cost,now()))
 return {'lot_id':l['id'],'qty':qty,'cost':cost,'name':l['name']}
def new_lot(c,doc,product,qty,cost,capacity=None):
 cur=c.execute('INSERT INTO lots(product_id,date,qty,remaining,total_cost,remaining_cost,capacity,document_id) VALUES(?,?,?,?,?,?,?,?)',(product,now(),qty,qty,cost,cost,capacity,doc));ident=cur.lastrowid
 c.execute('INSERT INTO movements(doc_id,lot_id,qty,cost,date) VALUES(?,?,?,?,?)',(doc,ident,qty,cost,now()))
 return ident
def finish(c,doc,details):c.execute('UPDATE documents SET details=? WHERE id=?',(dump(details),doc))
def unit_cost(l):
 if not l['remaining']:raise ValueError('Партия израсходована')
 return Decimal(l['remaining_cost'])/l['remaining']
def quote(c,d):
 s=config(c);ml=amount(d.get('ml'),1000,'Миллилитры',True)
 if ml not in (1000,2000,3000,5000,10000):raise ValueError('Выберите объём 1, 2, 3, 5 или 10 мл')
 liquid=lot(c,d.get('liquid'));atom=lot(c,d.get('atom'));label=lot(c,d['label']) if d.get('label') else None
 if liquid['kind']!='liquid' or atom['kind']!='atom' or (label and label['kind']!='label'):raise ValueError('Проверьте типы компонентов')
 if atom['capacity'] is None or atom['capacity']<ml:raise ValueError('Атомайзер меньше объёма наполнения')
 if not atom['remaining'] or (label and not label['remaining']):raise ValueError('Упаковка закончилась')
 if liquid['remaining']<ml:raise ValueError('Недостаточно парфюма для одной штуки')
 liquid_cost=unit_cost(liquid)*ml;atom_cost=unit_cost(atom);label_cost=unit_cost(label) if label else Decimal(0)
 work=dec(s['work'])*100*(Decimal(ml)/1000 if s['work_mode']=='ml' else 1)
 extra=amount(d.get('extra','0'),100,'Дополнительные расходы')
 total=liquid_cost+atom_cost+label_cost+work+extra
 multiplier=s['multipliers'][str(ml//1000)]
 step=dec(s['round_step'])*100
 recommended=(total*dec(multiplier)/step).to_integral_value(rounding=ROUND_CEILING)*step if multiplier is not None else None
 sale=optional(d.get('sale'),100,'Цена продажи');rate=fee_rate(s)
 net=None if sale is None else Decimal(sale)*(1-rate)-total
 minimum=(total/(1-rate)).to_integral_value(rounding=ROUND_CEILING)
 out={'ml':ml,'liquid_id':liquid['id'],'atom_id':atom['id'],'label_id':label['id'] if label else None,'liquid':str(liquid_cost/100),'atom':str(atom_cost/100),'label':str(label_cost/100),'work':str(work/100),'extra':str(Decimal(extra)/100),'cost':str(total/100),'recommended':None if recommended is None else str(recommended/100),'minimum':str(minimum/100),'sale':None if sale is None else str(Decimal(sale)/100),'net':None if net is None else str(net/100),'margin':None if not sale else str(net/Decimal(sale)*100),'fees_percent':str(rate*100),'discount':None if not sale or sale<minimum else str((Decimal(sale)-minimum)/sale*100)}
 digest={k:out[k] for k in ['ml','liquid_id','atom_id','label_id','liquid','atom','label','work','extra','cost']}
 out['fingerprint']=hashlib.sha256(dump(digest).encode()).hexdigest()
 return out
def mutate(path,d):
 if not isinstance(d,dict):raise ValueError('Неверный запрос')
 with connect() as c:
  c.execute('BEGIN IMMEDIATE')
  if path=='/api/product/archive':
   product_cards_module.archive_catalog(c,d.get('ids'),ROOT,now())
   return {'ok':True}
  if path=='/api/product':
   ident=d.get('id');kind=d.get('kind');name=title(d.get('name'));code=title(d.get('code'),60)
   if kind not in KINDS:raise ValueError('Выберите категорию')
   cap=optional(d.get('capacity'),1000,'Объём');sale=optional(d.get('sale'),100,'Цена продажи')
   if cap==0:raise ValueError('Объём должен быть больше нуля')
   if kind=='atom' and cap is None:raise ValueError('Укажите вместимость атомайзера')
   old=c.execute('SELECT * FROM products WHERE id=?',(ident,)).fetchone() if ident else None
   if ident and not old:raise ValueError('Карточка не найдена')
   if old and old['kind']!=kind:raise ValueError('Категорию существующей карточки менять нельзя')
   if old:
    c.execute('UPDATE products SET code=?,name=?,capacity=?,sale=?,note=? WHERE id=?',(code,name,cap,sale,note(d.get('note')),ident))
   else:
    ident=str(uuid.uuid4());c.execute('INSERT INTO products(id,code,name,kind,capacity,sale,note) VALUES(?,?,?,?,?,?,?)',(ident,code,name,kind,cap,sale,note(d.get('note'))))
   details=(d.get('profile') or {}).get('creation_details') if isinstance(d.get('profile'),dict) else None
   stock=product_cards_module.retail_stock(ROOT) if isinstance(details,dict) and details.get('related') else ()
   product_cards_module.save(c,ident,d,now(),stock)
   return {'ok':True,'id':ident}
  if path=='/api/settings':
   s=d.get('settings')
   if not isinstance(s,dict) or s.get('work_mode') not in ('ml','unit'):raise ValueError('Проверьте настройки')
   dec(s.get('work'),'Работа')
   amount(s.get('round_step'),100,'Шаг округления',True)
   if not isinstance(s.get('fees'),list) or len(s['fees'])>20:raise ValueError('Проверьте расходы')
   for f in s['fees']:title(f.get('name'),80);dec(f.get('rate'),'Процент')
   if fee_rate(s)>=1:raise ValueError('Сумма расходов должна быть меньше 100%')
   for n in ('1','2','3','5','10'):
    m=s.get('multipliers',{}).get(n)
    if m is not None and (dec(m)<=0 or dec(m)>100):raise ValueError('Коэффициенты: больше 0 и не больше 100')
   c.execute("UPDATE settings SET value=? WHERE key='config'",(dump(s),));return {'ok':True}
  key=str(d.get('key',''))
  if not key or len(key)>100:raise ValueError('Обновите страницу и повторите операцию')
  existing=c.execute('SELECT id FROM documents WHERE request_key=?',(key,)).fetchone()
  if existing:return {'ok':True,'id':existing['id'],'duplicate':True}
  if path=='/api/receipt':
   p=c.execute('SELECT * FROM products WHERE id=?',(d.get('product'),)).fetchone()
   if not p or p['kind']=='decant':raise ValueError('Выберите флакон, жидкость или материал. Распивы создаются производством.')
   scale=1000 if p['kind']=='liquid' else 1;q=amount(d.get('qty'),scale,'Количество',True)
   price=amount(d.get('price'),100,'Цена закупки',True)
   shipping=optional(d.get('delivery'),100,'Доставка');extra=amount(d.get('extra',0),100,'Допрасходы')
   cap=optional(d.get('capacity'),1000,'Объём одного флакона') if p['kind'] in ('bottle','atom') else None
   cap=cap if cap is not None else p['capacity']
   if p['kind'] in ('bottle','atom') and not cap:raise ValueError('Укажите объём одного флакона / атомайзера')
   goods=rounded(Decimal(price)*q/scale);cost=goods+(shipping or 0)+extra
   details={'inputs':[],'goods':goods,'delivery':shipping,'extra':extra,'note':note(d.get('note'))}
   doc=document(c,'receipt',key,'Поступление · '+p['name'],details);details['output']=new_lot(c,doc,p['id'],q,cost,cap);finish(c,doc,details)
  elif path=='/api/open':
   source=lot(c,d.get('lot'));q=amount(d.get('qty'),1,'Количество флаконов',True)
   if source['kind']!='bottle' or not source['capacity']:raise ValueError('Выберите партию полноразмерных флаконов с объёмом')
   loss=amount(d.get('loss','0'),1000,'Общие потери, мл');volume=source['capacity']*q-loss
   if volume<=0:raise ValueError('Потери должны быть меньше вскрываемого объёма')
   cost_of(source,q);liquid_id='liquid:'+source['product_id']
   p=c.execute('SELECT * FROM products WHERE id=?',(source['product_id'],)).fetchone()
   c.execute('INSERT OR IGNORE INTO products(id,code,name,kind,source_id) VALUES(?,?,?,?,?)',(liquid_id,'ML-'+p['code'],clean_name(p['name']),'liquid',p['id']))
   doc=document(c,'open',key,'Открытие на распив · '+source['name'],{})
   used=take(c,doc,source,q);out=new_lot(c,doc,liquid_id,volume,used['cost']);finish(c,doc,{'inputs':[used],'output':out,'loss':loss,'note':note(d.get('note'))})
  elif path=='/api/produce':
   calc=quote(c,d)
   if d.get('fingerprint')!=calc['fingerprint']:raise ValueError('Расчёт изменился. Пересчитайте перед выпуском.')
   q=amount(d.get('qty'),1,'Количество готовых штук',True);liquid=lot(c,d['liquid']);atom=lot(c,d['atom']);label=lot(c,d['label']) if d.get('label') else None
   ml=calc['ml'];cost_of(liquid,ml*q);cost_of(atom,q)
   if label:cost_of(label,q)
   product_key=liquid['product_id']+'|'+str(ml)+'|'+atom['product_id']+'|'+(label['product_id'] if label else '')
   ident='decant:'+str(uuid.uuid5(uuid.NAMESPACE_URL,product_key));sale=optional(d.get('sale'),100,'Цена продажи')
   if not c.execute('SELECT id FROM products WHERE id=?',(ident,)).fetchone():
    sequence=c.execute("SELECT count(*) FROM products WHERE kind='decant'").fetchone()[0]+1
    while c.execute('SELECT id FROM products WHERE code=?',('R-'+str(sequence).zfill(6),)).fetchone():sequence+=1
    code='R-'+str(sequence).zfill(6)
    c.execute('INSERT INTO products(id,code,name,kind,capacity,sale,source_id) VALUES(?,?,?,?,?,?,?)',(ident,code,liquid['name']+' — '+str(ml//1000)+' мл','decant',ml,sale,liquid['product_id']))
   doc=document(c,'production',key,'Выпуск · '+liquid['name']+' · '+str(q)+' × '+str(ml//1000)+' мл',{})
   inputs=[take(c,doc,liquid,ml*q),take(c,doc,atom,q)]
   if label:inputs.append(take(c,doc,label,q))
   manufacture=rounded((dec(calc['work'])+dec(calc['extra']))*100*q);cost=sum(x['cost'] for x in inputs)+manufacture
   out=new_lot(c,doc,ident,q,cost,ml);finish(c,doc,{'inputs':inputs,'output':out,'manufacture':manufacture,'quote':calc,'sale':sale,'qty':q,'note':note(d.get('note'))})
  elif path=='/api/writeoff':
   source=lot(c,d.get('lot'));q=require_quantity(source,d.get('qty'));reason=title(d.get('reason'),200);cost_of(source,q)
   doc=document(c,'writeoff',key,'Списание · '+source['name'],{});used=take(c,doc,source,q);finish(c,doc,{'inputs':[used],'reason':reason,'note':note(d.get('note'))})
  elif path=='/api/reverse':
   old=c.execute('SELECT * FROM documents WHERE id=?',(d.get('document'),)).fetchone()
   if not old or old['kind']=='reversal' or old['status']!='posted':raise ValueError('Документ уже отменён или недоступен для отмены')
   detail=json.loads(old['details']);output=detail.get('output')
   if output:
    out=lot(c,output)
    if out['remaining']!=out['qty'] or out['remaining_cost']!=out['total_cost']:raise ValueError('Отмена невозможна: товар уже использован. Сначала отмените связанные операции.')
   reason=title(d.get('reason'),300);doc=document(c,'reversal',key,'Отмена документа №'+str(old['id']),{'original':old['id'],'reason':reason})
   if output:
    c.execute("UPDATE lots SET remaining=0,remaining_cost=0,status='void' WHERE id=?",(output,));c.execute('INSERT INTO movements(doc_id,lot_id,qty,cost,date) VALUES(?,?,?,?,?)',(doc,output,-out['remaining'],-out['remaining_cost'],now()))
   for used in detail.get('inputs',[]):
    source=lot(c,used['lot_id'])
    if source['remaining']+used['qty']>source['qty']:raise ValueError('Нарушена связь остатков; отмена остановлена')
    c.execute('UPDATE lots SET remaining=remaining+?,remaining_cost=remaining_cost+? WHERE id=?',(used['qty'],used['cost'],source['id']));c.execute('INSERT INTO movements(doc_id,lot_id,qty,cost,date) VALUES(?,?,?,?,?)',(doc,source['id'],used['qty'],used['cost'],now()))
   c.execute("UPDATE documents SET status='reversed' WHERE id=?",(old['id'],))
  else:raise ValueError('Неизвестная операция')
  return {'ok':True,'id':doc}
def csv_text(d):
 try:raw=base64.b64decode(d.get('content',''),validate=True)
 except Exception:raise ValueError('Не удалось прочитать CSV')
 if len(raw)>5_000_000:raise ValueError('CSV должен быть меньше 5 МБ')
 try:return raw.decode('utf-8-sig')
 except UnicodeDecodeError:return raw.decode('cp1251')

def parse_csv(d):
 kind=d.get('kind')
 if kind not in KINDS or kind=='liquid':raise ValueError('Выберите категорию импорта')
 text=csv_text(d)
 try:delimiter=csv.Sniffer().sniff(text[:8000],delimiters=';,	').delimiter
 except csv.Error:delimiter=';'
 definitions=json.loads((ROOT/'frontend/app/product-categories.json').read_text(encoding='utf-8-sig')) if (ROOT/'frontend/app/product-categories.json').is_file() else []
 categories={entry['title']:entry['kind'] for entry in definitions if 'kind' in entry}
 target=d.get('category')
 if target and target not in categories:raise ValueError('Неизвестная категория импорта')
 reader=csv.DictReader(io.StringIO(text),delimiter=delimiter);items=[];codes=set()
 import re
 for index,row in enumerate(reader,2):
  r={str(k).strip().upper():v for k,v in row.items() if k is not None}
  code=title(r.get('EXTERNAL_CODE') or r.get('КОД') or r.get('CODE'),60);name=title(r.get('NAME') or r.get('НАИМЕНОВАНИЕ') or r.get('НАЗВАНИЕ'))
  if code in codes:raise ValueError('Повтор кода в CSV: '+code+' (строка '+str(index)+')')
  codes.add(code);capacity=r.get('VOLUME') or r.get('ОБЪЕМ') or r.get('ОБЪЁМ')
  if not capacity:
   match=re.search(r'(\d+(?:[.,]\d+)?)\s*мл\.?\s*$',name,re.I);capacity=match.group(1) if match else None
  cap=optional(capacity,1000,'Объём');sale=optional(r.get('PRICE') or r.get('ЦЕНА ПРОДАЖИ'),100,'Цена продажи')
  raw_purchase=r.get('PURCHASE_PRICE') or r.get('ЦЕНА ЗАКУПКИ') or r.get('ЗАКУПОЧНАЯ ЦЕНА') or ''
  try:purchase=optional(re.sub(r'[\s₽]','',raw_purchase),100,'Цена закупки')
  except ValueError as error:raise ValueError(f'Строка {index}: {error}') from error
  category=target or (r.get('GROUP') or '').strip()
  item_kind=categories.get(category,kind if target else (r.get('KIND') or kind))
  if item_kind not in KINDS or item_kind=='liquid':raise ValueError('Выберите товарную категорию для '+code)
  if category and not target and category not in categories:raise ValueError('Неизвестная категория: '+category)
  if item_kind=='atom' and not cap:raise ValueError('Для атомайзера нужен объём: '+code)
  items.append({'code':code,'name':name,'capacity':cap,'sale':sale,'purchase':purchase,'kind':item_kind,'category':category})
 if not items:raise ValueError('CSV пуст или не содержит строк. Нужны колонки NAME / EXTERNAL_CODE либо Название / Код.')
 if len(items)>10000:raise ValueError('Импортируйте не более 10 000 карточек за раз')
 return items
def parse_price_csv(d):
 text=csv_text(d)
 identifiers=('ID','EXTERNAL_CODE','КОД','CODE','КОД ТОВАРА','ВНЕШНИЙ КОД')
 price_columns=('PRICE','ЦЕНА ПРОДАЖИ','ЦЕНА ПРОДАЖИ, ₽')
 for delimiter in (';',',','	'):
  reader=csv.reader(io.StringIO(text),delimiter=delimiter,strict=True)
  try:
   first=next((row for row in reader if any(cell.strip() for cell in row)),[])
   headers=[cell.strip().upper() for cell in first]
   if set(headers)&set(identifiers) and set(headers)&set(price_columns):
    if len([key for key in headers if key in price_columns])!=1 or len(set(headers))!=len(headers):
     raise ValueError('В CSV повторяются заголовки колонок')
    rows=[(reader.line_num,row) for row in reader if any(cell.strip() for cell in row)]
    break
   if len(first) in (22,28,30) and first[0].strip().isdigit() and first[3].strip() and first[21].strip() in ('DEFAULT','SET','PRODUCT','BUNDLE'):
    headers=['ID','EXTERNAL_CODE','EXTERNAL_ID','NAME','FEATURES','PRICE','BARCODE','VENDOR_CODE','NDS','PAYMENT_SUBJECT','GROUP','UNIT_CODE','PURCHASE_PRICE','WEIGHTED','ALCOHOL','GTIN','MARK_TYPE','GROUPED']
    headers+=['']*(len(first)-len(headers))
    rows=[(reader.line_num,first)]+[(reader.line_num,row) for row in reader if any(cell.strip() for cell in row)]
    break
  except csv.Error as error:
   if delimiter in text.splitlines()[0]:raise ValueError('Проверьте кавычки в CSV') from error
 else:
  raise ValueError('Нужны колонки «Код» и «Цена продажи» или файл номенклатуры БИФИТ с заголовками')
 items=[]
 for line,row in rows:
  if len(row)!=len(headers):raise ValueError(f'Строка {line}: количество ячеек отличается от заголовка. Дробную цену в CSV с запятыми заключите в кавычки.')
  values=dict(zip(headers,(cell.strip() for cell in row)))
  if values.get('GROUPED')=='1':continue
  code=next((values.get(key) for key in identifiers[1:] if values.get(key)),None)
  bifit=values.get('ID')
  if not (code or bifit):raise ValueError(f'Строка {line}: укажите код или ID товара')
  raw=next(values[key] for key in price_columns if key in values)
  try:price=optional(re.sub(r'[\s₽]','',raw),100,'Цена продажи')
  except ValueError as error:raise ValueError(f'Строка {line}: {error}') from error
  raw_purchase=values.get('PURCHASE_PRICE') or values.get('ЦЕНА ЗАКУПКИ') or values.get('ЗАКУПОЧНАЯ ЦЕНА') or ''
  try:purchase=optional(re.sub(r'[\s₽]','',raw_purchase),100,'Цена закупки')
  except ValueError:purchase=None
  items.append((line,code,bifit,values.get('NAME') or values.get('НАИМЕНОВАНИЕ') or values.get('НАЗВАНИЕ'),price,purchase))
 if not items:raise ValueError('CSV не содержит товаров')
 if len(items)>10000:raise ValueError('Импортируйте не более 10 000 товаров за раз')
 return items

def import_sale_prices(d,apply):
 rows=parse_price_csv(d)
 target=d.get('category')
 with connect() as c:
  if apply:c.execute('BEGIN IMMEDIATE')
  profiles=product_cards_module.profiles(c)
  products={p['id']:p for p in c.execute("SELECT id,code,name,kind,sale FROM products WHERE kind!='liquid'")
            if not profiles.get(p['id'],{}).get('archived_from_catalog')}
  by_code={p['code']:p for p in products.values()}
  by_bifit={}
  for pid,p in products.items():
   key=profiles.get(pid,{}).get('bifit_id')
   if key:by_bifit.setdefault(str(key),[]).append(p)
  counts={'changed':0,'unchanged':0,'missing':0,'blank':0,'outside':0}
  preview=[];purchases=[];seen=set()
  for line,code,bifit,name,price,purchase in rows:
   matches=by_bifit.get(bifit,[])
   if len(matches)>1:raise ValueError(f'Строка {line}: этот ID БИФИТ связан с несколькими карточками')
   p=matches[0] if matches else by_code.get(code)
   profile=profiles.get(p['id'],{}) if p else {}
   if matches and code and code not in (p['code'],profile.get('external_code')):
    raise ValueError(f'Строка {line}: код и ID БИФИТ не совпадают с карточкой товара')
   if not p:status='missing'
   elif target and (profile.get('category') or ('Распив' if p['kind']=='decant' else KINDS[p['kind']]))!=target:status='outside'
   else:
    if p['id'] in seen:raise ValueError(f'Строка {line}: товар повторяется в файле')
    seen.add(p['id'])
    if price is None:status='blank'
    elif price==p['sale']:status='unchanged'
    else:status='changed'
   counts[status]+=1
   preview.append({'line':line,'code':p['code'] if p else code or bifit,'name':p['name'] if p else name,
                   'previous':p['sale'] if p else None,'sale':price,'status':status,'id':p['id'] if p else None})
   purchases.append({'purchase':purchase if purchase is not None else profile.get('purchase_price'),
                     'purchaseFromFile':purchase is not None})
  fingerprint=hashlib.sha256(dump(preview).encode()).hexdigest()
  if apply:
   if d.get('fingerprint')!=fingerprint:raise ValueError('Цены или карточки изменились. Проверьте файл ещё раз.')
   for row in preview:
    if row['status']=='changed':
     c.execute('UPDATE products SET sale=? WHERE id=?',(row['sale'],row['id']))
  return {'ok':True,'count':len(rows),**counts,'fingerprint':fingerprint,
          'rows':[{**row,**details} for row,details in zip(preview[:50],purchases)]}

def import_csv(d,apply=False):
 if d.get('mode')=='prices':return import_sale_prices(d,apply)
 rows=parse_csv(d)
 with connect() as c:
  if apply:c.execute('BEGIN IMMEDIATE')
  existing={p['code']:dict(p) for p in c.execute('SELECT * FROM products')}
  for p in rows:
   if p['code'] in existing and existing[p['code']]['kind']!=p['kind']:raise ValueError('Код уже используется в другой категории: '+p['code'])
  added=sum(p['code'] not in existing for p in rows);updates=len(rows)-added
  if apply:
   for p in rows:
    prior=existing.get(p['code'])
    if prior and not d.get('update_existing'):continue
    pid=prior['id'] if prior else str(uuid.uuid4())
    if prior:c.execute('UPDATE products SET name=?,capacity=?,sale=? WHERE id=?',(p['name'],p['capacity'],p['sale'] if p['sale'] is not None else prior['sale'],pid))
    else:c.execute('INSERT INTO products(id,code,name,kind,capacity,sale) VALUES(?,?,?,?,?,?)',(pid,p['code'],p['name'],p['kind'],p['capacity'],p['sale']))
    if p['category'] or p['purchase'] is not None or not prior:
     profile={'archived_from_catalog':False} if p['category'] or not prior else {}
     if p['category']:profile['category']=p['category']
     if p['purchase'] is not None:profile['purchase_price']=p['purchase']
     product_cards_module.update_catalog_profile(c,pid,profile,now())
  return {'ok':True,'count':len(rows),'new':added,'existing':updates,'rows':rows[:50]}
def backup():
 DATA.mkdir(parents=True,exist_ok=True);folder=DATA/'backups';folder.mkdir(exist_ok=True)
 p=folder/('aroma-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
 src=connect();dst=sqlite3.connect(p)
 try:src.backup(dst)
 finally:src.close();dst.close()
 return p

class InlineScripts(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=False);self.inside=False;self.current=[];self.hashes=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script' and not dict(attrs).get('src'):self.inside=True;self.current=[]
 def handle_data(self,data):
  if self.inside:self.current.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.inside:
   digest=base64.b64encode(hashlib.sha256(''.join(self.current).encode('utf8')).digest()).decode('ascii')
   self.hashes.append("'sha256-"+digest+"'");self.inside=False

def web_asset(path):
 """Serve only exported Next assets from the web directory, never the database."""
 root=(ROOT/'web').resolve()
 if not (root/'index.html').is_file():return None
 relative=unquote(path).lstrip('/') or 'index.html'
 file=(root/relative).resolve()
 if not file.is_relative_to(root) or not file.is_file():return None
 allowed={'.html': 'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
          '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
          '.txt':'text/plain; charset=utf-8','.ico':'image/x-icon','.png':'image/png',
          '.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2'}
 if file.suffix not in allowed:return None
 body=file.read_bytes();headers={}
 if file.suffix=='.html':
  parser=InlineScripts();parser.feed(body.decode('utf8'))
  headers['Content-Security-Policy']="default-src 'self'; script-src 'self' "+' '.join(parser.hashes)+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://allureparfum.ru https://www.allureparfum.ru https://odekolon-shop.ru https://www.odekolon-shop.ru https://randewoo.ru https://www.randewoo.ru https://xn--d1ai6ai.xn--p1ai https://www.xn--d1ai6ai.xn--p1ai; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
 return body,allowed[file.suffix],headers

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,status,data,ctype='application/json; charset=utf-8',headers=None,allow_frame=False):
  body=data if isinstance(data,bytes) else dump(data).encode('utf8')
  self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
  if not allow_frame:self.send_header('X-Frame-Options','DENY')
  for k,v in (headers or {}).items():self.send_header(k,v)
  self.end_headers();self.wfile.write(body)
 def allowed(self):return self.headers.get('Host') in ('127.0.0.1:'+str(self.server.server_port),'localhost:'+str(self.server.server_port))
 def do_GET(self):
  if not self.allowed():return self.send(403,{'error':'Доступ только с этого компьютера'})
  parsed=urlparse(self.path);path=parsed.path
  embedded=path in ('/','/index.html') and parse_qs(parsed.query).get('embed')==['1']
  if path in ('/','/index.html') and not embedded:return self.send(303,b'',headers={'Location':'http://127.0.0.1:8791/overview'})
  if path=='/api/health':return self.send(200,{'app':'aroma','root':str(ROOT),'version':VERSION,'signature':SIGNATURE})
  if path=='/api/state':return self.send(200,state())
  if path=='/api/competitors/state':return self.send(200,competitors_module.state(connect))
  if path=='/api/warehouse/state':return self.send(200,warehouse_module.state(connect))
  if path=='/api/sales/state':
   answer=sales_module.state(connect)
   with connect() as c:members={x[0] for x in c.execute('SELECT product_id FROM catalog_members')}
   if members:answer['catalog']=[x for x in answer['catalog'] if x.get('source_id') in members]
   return self.send(200,answer)
  if path=='/api/cost/state':return self.send(200,calculator_state())
  asset=web_asset(path)
  if asset is not None:
   body,ctype,headers=asset
   if embedded and ctype.startswith('text/html'):
    css=b'<style>.erp-sider,.erp-header,.erp-footer,.mobile-nav{display:none!important}.erp-content{padding:0!important;margin:0!important;max-width:none!important;width:100%!important}</style>'
    body=body.replace(b'</head>',css+b'</head>',1)
    headers=dict(headers);headers['Content-Security-Policy']=headers['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors http://127.0.0.1:8791")
    return self.send(200,body,ctype,headers,allow_frame=True)
   return self.send(200,body,ctype,headers)
  if re.fullmatch(r'/product-photo/[^/]{1,500}',path):
   with connect() as c:photo=c.execute('SELECT content FROM product_photos WHERE product_id=?',(unquote(path.rsplit('/',1)[1]),)).fetchone()
   return self.send(200,photo[0],'image/jpeg') if photo else self.send(404,{'error':'Фото не найдено'})
  if path.startswith('/images/'):
   filename=path[len('/images/'):]
   if re.fullmatch(r'[a-f0-9]{24}\.(?:png|jpe?g|webp)',filename):
    photo=ROOT/'static'/'images'/filename
    if photo.is_file():
     ctype={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[photo.suffix]
     return self.send(200,photo.read_bytes(),ctype)
   return self.send(404,{'error':'Фото не найдено'})
  resources={'/':('static/index.html','text/html; charset=utf-8'),'/app.js':('static/app.js','text/javascript; charset=utf-8'),'/style.css':('static/style.css','text/css; charset=utf-8')}
  if path in resources:
   file,ctype=resources[path]
   return self.send(200,(ROOT/file).read_bytes(),ctype,{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
  return self.send(404,{'error':'Не найдено'})
 def do_POST(self):
  if not self.allowed() or self.headers.get('X-Aroma-Token')!=TOKEN:return self.send(403,{'error':'Обновите страницу'})
  origin=self.headers.get('Origin')
  if origin and origin not in ('http://127.0.0.1:'+str(self.server.server_port),'http://localhost:'+str(self.server.server_port)):return self.send(403,{'error':'Недопустимый источник запроса'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<0 or n>8_000_000:return self.send(413,{'error':'Слишком большой запрос'})
   d=json.loads(self.rfile.read(n) or b'{}');path=urlparse(self.path).path
   if path.startswith('/api/competitors/'):return self.send(200,competitors_module.handle(path,d,connect))
   if path=='/api/sales/export':
    body,mime,filename=sales_module.export_document(d,connect)
    return self.send(200,body,mime,{'Content-Disposition':'attachment; filename="'+filename+'"'})
   if path.startswith('/api/warehouse/'):return self.send(200,warehouse_module.handle(path,d,connect))
   if path.startswith('/api/sales/'):return self.send(200,sales_module.handle(path,d,connect))
   if path=='/api/cost/calculate':return self.send(200,calculator_quote(d))
   if path=='/api/cost/save':return self.send(200,calculator_save(d))
   if path=='/api/backup':
    p=backup();return self.send(200,p.read_bytes(),'application/octet-stream',{'Content-Disposition':'attachment; filename="'+p.name+'"'})
   if path=='/api/stop':self.send(200,{'ok':True});threading.Thread(target=self.server.shutdown,daemon=True).start();return
   if path=='/api/product/card-options':return self.send(200,{'stock':product_cards_module.retail_stock(ROOT)})
   if path=='/api/product/barcode':
    with connect() as c:return self.send(200,{'barcode':product_cards_module.generate_barcode(c)})
   if path=='/api/quote':
    with connect() as c:return self.send(200,quote(c,d))
   if path in ('/api/import/preview','/api/import/apply'):return self.send(200,import_csv(d,path.endswith('/apply')))
   return self.send(200,mutate(path,d))
  except (ValueError,TypeError,InvalidOperation,KeyError,OverflowError) as e:return self.send(400,{'error':str(e)})
  except sqlite3.IntegrityError:return self.send(400,{'error':'Такой код уже есть или операция нарушает связь данных. Изменения не сохранены.'})
  except Exception:return self.send(500,{'error':'Не удалось сохранить операцию. Изменения отменены. Проверьте доступ к папке данных.'})
def main():
 global SIGNATURE
 # Bind before database initialization: a duplicate launcher cannot change an active database.
 try:http=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
 except OSError:raise SystemExit('Адрес программы занят. Откройте Арома.exe — он проверит работающую копию.')
 try:
  init();SIGNATURE=signature();print('AROMA_READY http://127.0.0.1:'+str(PORT),flush=True)
  if '--no-browser' not in sys.argv:threading.Timer(.5,lambda:webbrowser.open('http://127.0.0.1:'+str(PORT))).start()
  http.serve_forever()
 except KeyboardInterrupt:pass
 finally:http.server_close()
if __name__=='__main__':main()
# Competitor discovery and status fix, 22 October 2026.

# Calculator v3: independent cost parts and empty-field display, 24 October 2026.

# Calculator plan update: explicit free shipping, 24 October 2026.

# Competitor search v2: candidate selection and stored confirmations, 29 October 2026.

# Competitor volume selection: own catalog sizes, 29 October 2026.

# Competitor exact model selection among different editions, 29 October 2026.

# Competitor catalog resolver: exact product pages, CSV search names and variants, 29 October 2026.

# Restore original catalog names; remove alternate search names, 29 October 2026.

# Add Gold Apple and Aroma-Butik sources with explicit access status, 29 October 2026.

# Browser price readers for Gold Apple and Aroma-Butik, 29 October 2026.

# Remove Gold Apple and Aroma-Butik from active price search, 29 October 2026.
