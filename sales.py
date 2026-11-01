"""Manual sales journal. Independent of inventory and calculator settings."""
import json,uuid,hashlib
from datetime import date,datetime
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP

def dump(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'))
def init(connect):
 with connect() as c:
  c.executescript('''
CREATE TABLE IF NOT EXISTS sales_catalog(id TEXT PRIMARY KEY,source_id TEXT UNIQUE,name TEXT NOT NULL,cost INTEGER,price INTEGER,updated TEXT NOT NULL,group_name TEXT NOT NULL DEFAULT 'other',cost_source TEXT NOT NULL DEFAULT 'manual');
CREATE TABLE IF NOT EXISTS manual_sales(id INTEGER PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,date TEXT NOT NULL,created TEXT NOT NULL,status TEXT NOT NULL,payment TEXT NOT NULL,rate TEXT NOT NULL,note TEXT NOT NULL,payload TEXT NOT NULL,void_reason TEXT,void_at TEXT);
CREATE TABLE IF NOT EXISTS sales_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sales_history(doc_id INTEGER NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,changed_at TEXT NOT NULL,reason TEXT NOT NULL,request_key TEXT UNIQUE,fingerprint TEXT,PRIMARY KEY(doc_id,revision));
''')
  columns={r[1] for r in c.execute('PRAGMA table_info(manual_sales)')}
  if 'revision' not in columns:c.execute('ALTER TABLE manual_sales ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
  if 'updated' not in columns:c.execute('ALTER TABLE manual_sales ADD COLUMN updated TEXT')
  for row in c.execute('SELECT * FROM manual_sales').fetchall():
   r=dict(row);c.execute('INSERT OR IGNORE INTO sales_history(doc_id,revision,snapshot,changed_at,reason) VALUES(?,?,?,?,?)',(r['id'],r['revision'],dump(r),r['updated'] or r['created'],'Исходная сохранённая версия'))
  has_import=c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decant_import'").fetchone()
  for p in c.execute("SELECT * FROM products WHERE kind IN ('bottle','decant','atom','other')").fetchall():
   cost=None
   if has_import:
    imported=c.execute('SELECT purchase_price FROM decant_import WHERE code=?',(p['code'],)).fetchone()
    if imported:cost=imported[0]
   c.execute('INSERT OR IGNORE INTO sales_catalog VALUES(?,?,?,?,?,?,?,?)',(p['id'],p['id'],p['name'],cost,p['sale'],datetime.now().astimezone().isoformat(),p['kind'],'csv' if cost is not None else 'manual'))

def money(x,label):
 try:v=Decimal(str(x).replace(',','.'))
 except (InvalidOperation,ValueError):raise ValueError('Укажите '+label)
 if not v.is_finite() or v<0 or v>100000000 or v*100!=(v*100).to_integral_value():raise ValueError('Проверьте '+label+' (до двух знаков после запятой)')
 return int(v*100)
def text(x,limit=300):
 v=str(x or '').strip()
 if not v or len(v)>limit:raise ValueError('Заполните текст (до '+str(limit)+' символов)')
 return v
def cents(v):return int(Decimal(v).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
def metrics(row):
 r=dict(row);r['gross']=r['revenue']-r['cost'];r['remaining']=r['gross']-r['fee']
 r['margin']=str(Decimal(r['gross'])*100/r['revenue']) if r['revenue'] else None
 r['markup']=str(Decimal(r['gross'])*100/r['cost']) if r['cost'] else None
 return r
def document(row):
 r=dict(row);p=json.loads(r['payload']) if isinstance(r['payload'],str) else json.loads(dump(r['payload']))
 for i,line in enumerate(p['rows']):
  line.setdefault('line_id','legacy:'+str(i));line.setdefault('payment',r['payment']);line.setdefault('rate',r['rate'] if line['payment']=='card' else '0')
 p['totals']['cash']=sum(x['revenue'] for x in p['rows'] if x['payment']=='cash')
 p['totals']['card']=sum(x['revenue'] for x in p['rows'] if x['payment']=='card')
 r['payload']=p;r.setdefault('revision',1);return r
def saved_document(c,ident):
 row=c.execute('SELECT * FROM manual_sales WHERE id=?',(ident,)).fetchone()
 if not row:raise ValueError('Документ не найден')
 return document(row)
def history(c,ident):
 saved_document(c,ident)
 return [{'revision':r['revision'],'changed_at':r['changed_at'],'reason':r['reason'],'document':document(json.loads(r['snapshot']))} for r in c.execute('SELECT * FROM sales_history WHERE doc_id=? ORDER BY revision DESC',(ident,))]
def remember(c,ident,reason,key=None,fingerprint=None):
 r=dict(c.execute('SELECT * FROM manual_sales WHERE id=?',(ident,)).fetchone())
 c.execute('INSERT INTO sales_history VALUES(?,?,?,?,?,?,?)',(ident,r['revision'],dump(r),r['updated'] or r['created'],reason,key,fingerprint))
def state(connect):
 with connect() as c:
  catalog=[dict(x) for x in c.execute('SELECT * FROM sales_catalog ORDER BY name COLLATE NOCASE')]
  docs=[]
  for row in c.execute('SELECT * FROM manual_sales ORDER BY date DESC,id DESC'):
   docs.append(document(row))
  prefs=dict(c.execute('SELECT key,value FROM sales_preferences'))
 return {'catalog':catalog,'documents':docs,'card_rate':prefs.get('card_rate')}
def quote(c,d):
 items=d.get('items')
 if not isinstance(items,list) or not 1<=len(items)<=200:raise ValueError('Добавьте от 1 до 200 позиций')
 prior={};editing=d.get('document_id') is not None
 if editing:
  old=saved_document(c,d['document_id'])
  if old['status']!='posted':raise ValueError('Аннулированный документ нельзя исправлять')
  if d.get('revision')!=old['revision']:raise ValueError('Документ уже изменён. Обновите журнал и откройте последнюю версию')
  prior={r['line_id']:r for r in old['payload']['rows']}
 row_mode=editing or any(isinstance(x,dict) and 'payment' in x for x in items)
 rows=[];seen=set()
 for index,item in enumerate(items):
  if not isinstance(item,dict):raise ValueError('Неверная строка продажи')
  line_id=item.get('line_id','new:'+str(index))
  if not isinstance(line_id,str) or not line_id or len(line_id)>100 or line_id in seen:raise ValueError('Неверный или повторный идентификатор строки')
  seen.add(line_id);frozen=prior.get(line_id)
  if frozen:
   if frozen['id']!=item.get('id'):raise ValueError('Для замены товара удалите строку и добавьте новую')
   p={'id':frozen['id'],'name':frozen['name'],'cost':frozen['unit_cost'],'price':frozen['list_price'],'group_name':frozen['group_name'],'cost_source':frozen['cost_source']}
   if 'cost_override' in item:p.update(cost=money(item['cost_override'],'исправленную себестоимость'),cost_source='manual')
   if 'list_price_override' in item:p['price']=money(item['list_price_override'],'исправленную цену до скидки')
  else:p=c.execute('SELECT * FROM sales_catalog WHERE id=?',(item.get('id'),)).fetchone()
  if p is None:raise ValueError('Товар не найден')
  if p['cost'] is None or p['price'] is None:raise ValueError('Заполните себестоимость и цену: '+p['name'])
  q=item.get('qty')
  if isinstance(q,bool) or not isinstance(q,int) or not 1<=q<=100000:raise ValueError('Количество должно быть целым от 1 до 100000')
  price=money(item.get('price'),'фактическую цену')
  if price>p['price']:raise ValueError('Цена выше прайса: сначала измените цену товара в базе')
  payment=item.get('payment',d.get('payment'))
  if payment not in ('cash','card'):raise ValueError('Выберите оплату для каждой позиции')
  rate=Decimal(money(item.get('rate',d.get('rate')) if payment=='card' else 0,'тариф эквайринга строки'))/100
  if rate>=100:raise ValueError('Тариф должен быть меньше 100%')
  revenue=q*price;cost=q*p['cost'];base=q*p['price']
  rows.append({'line_id':line_id,'id':p['id'],'name':p['name'],'group_name':p['group_name'],'cost_source':p['cost_source'],'qty':q,'unit_cost':p['cost'],'list_price':p['price'],'price':price,'base':base,'discount':base-revenue,'revenue':revenue,'cost':cost,'fee':cents(Decimal(revenue)*rate/100) if row_mode else 0,'payment':payment,'rate':str(rate)})
 # Legacy clients retain payment-level rounding; new daily journals round each recorded payment row.
 total_revenue=sum(r['revenue'] for r in rows);fee=cents(Decimal(total_revenue)*rate/100) if not row_mode else sum(r['fee'] for r in rows)
 if any(sum(r[k] for r in rows)>100000000000000 for k in ('base','revenue','cost')):raise ValueError('Слишком большая сумма документа')
 if total_revenue and not row_mode:
  shares=[Decimal(fee)*r['revenue']/total_revenue for r in rows]
  allocated=[int(x) for x in shares]
  for i in sorted(range(len(rows)),key=lambda i:shares[i]-allocated[i],reverse=True)[:fee-sum(allocated)]:allocated[i]+=1
  for r,f in zip(rows,allocated):r['fee']=f
 totals=metrics({key:sum(r[key] for r in rows) for key in ('base','discount','revenue','cost','fee')})
 totals.update(cash=sum(r['revenue'] for r in rows if r['payment']=='cash'),card=sum(r['revenue'] for r in rows if r['payment']=='card'))
 methods={r['payment'] for r in rows};rates={r['rate'] for r in rows if r['payment']=='card'}
 return {'rows':[metrics(r) for r in rows],'totals':totals,'payment':next(iter(methods)) if len(methods)==1 else 'mixed','rate':next(iter(rates)) if len(rates)==1 else '0','payment_mode':'rows' if row_mode else 'document'}
def handle(path,d,connect):
 if not isinstance(d,dict):raise ValueError('Неверный документ')
 if path=='/api/sales/catalog':
  name=text(d.get('name'));cost=None if d.get('cost') in (None,'') else money(d['cost'],'себестоимость')
  price=None if d.get('price') in (None,'') else money(d['price'],'цену продажи')
  group=d.get('group_name')
  if group not in ('bottle','decant','atom','other'):raise ValueError('Выберите группу товара')
  with connect() as c:
   c.execute('BEGIN IMMEDIATE');ident=d.get('id')
   if ident:
    if not c.execute('SELECT 1 FROM sales_catalog WHERE id=?',(ident,)).fetchone():raise ValueError('Товар не найден')
    previous=c.execute('SELECT cost,cost_source FROM sales_catalog WHERE id=?',(ident,)).fetchone()
    cost_source=previous['cost_source'] if cost==previous['cost'] else 'manual'
    c.execute('UPDATE sales_catalog SET name=?,cost=?,price=?,updated=?,group_name=?,cost_source=? WHERE id=?',(name,cost,price,datetime.now().astimezone().isoformat(),group,cost_source,ident))
   else:
    ident='manual:'+str(uuid.uuid4());c.execute('INSERT INTO sales_catalog VALUES(?,NULL,?,?,?,?,?,?)',(ident,name,cost,price,datetime.now().astimezone().isoformat(),group,'manual'))
  return {'id':ident}
 if path=='/api/sales/quote':
  with connect() as c:return quote(c,d)
 if path=='/api/sales/history':
  with connect() as c:return {'history':history(c,d.get('id'))}
 if path=='/api/sales/save':
  key=text(d.get('request_key'),100)
  canonical={k:v for k,v in d.items() if k!='request_key'}
  fingerprint=hashlib.sha256(json.dumps(canonical,sort_keys=True).encode()).hexdigest()
  with connect() as c:
   c.execute('BEGIN IMMEDIATE')
   old=c.execute('SELECT id,fingerprint FROM manual_sales WHERE request_key=?',(key,)).fetchone()
   if old:
    if old['fingerprint']!=fingerprint:raise ValueError('Запрос уже использован для другой продажи')
    return {'id':old['id']}
   sold_on=text(d.get('date'),10)
   try:
    if date.fromisoformat(sold_on).isoformat()!=sold_on:raise ValueError()
   except ValueError:raise ValueError('Проверьте дату продажи')
   result=quote(c,d)
   if d.get('expected')!=result:raise ValueError('Цены или себестоимость изменились. Пересчитайте документ перед сохранением')
   memo=str(d.get('note') or '').strip()
   if len(memo)>1500:raise ValueError('Примечание до 1500 символов')
   cursor=c.execute('INSERT INTO manual_sales(request_key,fingerprint,date,created,status,payment,rate,note,payload) VALUES(?,?,?,?,?,?,?,?,?)',(key,fingerprint,sold_on,datetime.now().astimezone().isoformat(),'posted',result['payment'],result['rate'],memo,dump(result)))
   remember(c,cursor.lastrowid,'Создание документа')
   cards=[r for r in result['rows'] if r['payment']=='card']
   if cards:c.execute("INSERT INTO sales_preferences VALUES('card_rate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(cards[-1]['rate'],))
   return {'id':cursor.lastrowid}
 if path=='/api/sales/update':
  key=text(d.get('request_key'),100);reason=text(d.get('reason'),500)
  fingerprint=hashlib.sha256(json.dumps({k:v for k,v in d.items() if k!='request_key'},sort_keys=True).encode()).hexdigest()
  with connect() as c:
   c.execute('BEGIN IMMEDIATE')
   previous=c.execute('SELECT doc_id,fingerprint,revision FROM sales_history WHERE request_key=?',(key,)).fetchone()
   if previous:
    if previous['fingerprint']!=fingerprint:raise ValueError('Запрос исправления уже использован')
    return {'id':previous['doc_id'],'revision':previous['revision']}
   ident=d.get('document_id');old=saved_document(c,ident)
   sold_on=text(d.get('date'),10)
   try:
    if date.fromisoformat(sold_on).isoformat()!=sold_on:raise ValueError()
   except ValueError:raise ValueError('Проверьте дату продажи')
   result=quote(c,d)
   if d.get('expected')!=result:raise ValueError('Данные изменились. Пересчитайте исправленный документ')
   memo=str(d.get('note') or '').strip()
   if len(memo)>1500:raise ValueError('Примечание до 1500 символов')
   c.execute('UPDATE manual_sales SET date=?,payment=?,rate=?,note=?,payload=?,revision=revision+1,updated=? WHERE id=?',(sold_on,result['payment'],result['rate'],memo,dump(result),datetime.now().astimezone().isoformat(),ident))
   remember(c,ident,reason,key,fingerprint)
   return {'id':ident,'revision':old['revision']+1}
 if path=='/api/sales/void':
  reason=text(d.get('reason'),500)
  with connect() as c:
   c.execute('BEGIN IMMEDIATE')
   row=c.execute('SELECT status,revision FROM manual_sales WHERE id=?',(d.get('id'),)).fetchone()
   if not row:raise ValueError('Документ не найден')
   if row['status']=='posted':
    if d.get('revision',row['revision'])!=row['revision']:raise ValueError('Документ изменён. Обновите журнал')
    changed=datetime.now().astimezone().isoformat();c.execute("UPDATE manual_sales SET status='void',void_reason=?,void_at=?,updated=?,revision=revision+1 WHERE id=?",(reason,changed,changed,d['id']))
    remember(c,d['id'],'Аннулирование: '+reason)
  return {'ok':True}
 raise ValueError('Неизвестная операция продаж')

def export_document(d,connect):
 import sales_exports
 ident=d.get('id');revision=d.get('revision')
 with connect() as c:
  doc=saved_document(c,ident)
  if revision is not None and revision!=doc['revision']:
   row=c.execute('SELECT snapshot FROM sales_history WHERE doc_id=? AND revision=?',(ident,revision)).fetchone()
   if not row:raise ValueError('Версия документа не найдена')
   doc=document(json.loads(row['snapshot']))
  versions=history(c,ident)
 return sales_exports.export(doc,d.get('format'),versions)
