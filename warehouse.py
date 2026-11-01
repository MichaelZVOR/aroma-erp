"""Warehouse preparation only: locations and read-only product reconciliation."""
import hashlib
import json
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime


def init(connect):
 with connect() as c:
  c.executescript('''
CREATE TABLE IF NOT EXISTS warehouse_locations(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT UNIQUE NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('central','store')),note TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_one_central ON warehouse_locations(role) WHERE role='central';
CREATE TABLE IF NOT EXISTS warehouse_location_history(
 location_id TEXT NOT NULL REFERENCES warehouse_locations(id),revision INTEGER NOT NULL,
 snapshot TEXT NOT NULL,changed_at TEXT NOT NULL,PRIMARY KEY(location_id,revision));
CREATE TABLE IF NOT EXISTS warehouse_requests(
 request_key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
''')


def norm(value):
 return ' '.join(unicodedata.normalize('NFKC',str(value or '')).casefold().split())


def text(value,limit,label,required=False):
 if not isinstance(value,str):raise ValueError('Некорректное поле: '+label)
 value=value.strip()
 if (required and not value) or len(value)>limit or any(ord(x)<32 and x not in '\n\t' for x in value):
  raise ValueError('Проверьте поле «'+label+'» (до '+str(limit)+' символов)')
 return value


def handle(path,d,connect):
 if path!='/api/warehouse/location':raise ValueError('Неизвестная операция склада')
 if not isinstance(d,dict):raise ValueError('Нужен объект с настройками места хранения')
 key=text(d.get('request_key'),100,'Ключ запроса',True)
 if len(key)<8:raise ValueError('Обновите форму места хранения')
 name=' '.join(text(d.get('name'),120,'Название',True).split())
 role=d.get('role')
 if role not in ('central','store'):raise ValueError('Выберите центральный склад или магазин')
 note=text(d.get('note',''),1000,'Примечание')
 ident=d.get('id');revision=d.get('revision')
 if ident is not None and (not isinstance(ident,str) or not ident or len(ident)>100):raise ValueError('Некорректное место хранения')
 if ident and (type(revision) is not int or revision<1):raise ValueError('Обновите версию места хранения')
 values={'id':ident,'revision':revision,'name':name,'role':role,'note':note}
 fingerprint=hashlib.sha256(json.dumps(values,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
 with connect() as c:
  c.execute('BEGIN IMMEDIATE')
  previous=c.execute('SELECT * FROM warehouse_requests WHERE request_key=?',(key,)).fetchone()
  if previous:
   if previous['fingerprint']!=fingerprint:raise ValueError('Этот запрос уже сохранён с другими значениями. Откройте форму заново.')
   return json.loads(previous['result'])
  old=c.execute('SELECT * FROM warehouse_locations WHERE id=?',(ident,)).fetchone() if ident else None
  if ident and (not old or old['revision']!=revision):raise ValueError('Место хранения изменилось. Обновите список и откройте его заново.')
  if c.execute('SELECT 1 FROM warehouse_locations WHERE name_key=? AND id<>?',(norm(name),ident or '')).fetchone():raise ValueError('Место с таким названием уже есть')
  if role=='central' and c.execute("SELECT 1 FROM warehouse_locations WHERE role='central' AND id<>?",(ident or '',)).fetchone():raise ValueError('Центральный склад уже создан. Измените существующий.')
  now=datetime.now().astimezone().isoformat(timespec='seconds')
  if old:
   c.execute('UPDATE warehouse_locations SET name=?,name_key=?,role=?,note=?,revision=revision+1,updated=? WHERE id=?',(name,norm(name),role,note,now,ident))
  else:
   ident='location:'+str(uuid.uuid4())
   c.execute('INSERT INTO warehouse_locations VALUES(?,?,?,?,?,?,?,?)',(ident,name,norm(name),role,note,1,now,now))
  row=dict(c.execute('SELECT * FROM warehouse_locations WHERE id=?',(ident,)).fetchone())
  c.execute('INSERT INTO warehouse_location_history VALUES(?,?,?,?)',(ident,row['revision'],json.dumps(row,ensure_ascii=False),now))
  result={'ok':True,'id':ident,'revision':row['revision']}
  c.execute('INSERT INTO warehouse_requests VALUES(?,?,?)',(key,fingerprint,json.dumps(result)))
  return result


def reconciliation(products,sales):
 by_id={p['id']:p for p in products};by_name=defaultdict(list);groups=defaultdict(list)
 for p in products:
  by_name[(p['kind'],norm(p['name']))].append(p)
  groups[(p['kind'],norm(p['name']),p.get('capacity'))].append(p)
 duplicate_ids={p['id'] for group in groups.values() if len(group)>1 for p in group}
 linked=set();rows=[]
 for sale in sales:
  p=by_id.get(sale.get('source_id'));issues=[]
  if p:
   linked.add(p['id']);status='linked'
   if norm(p['name'])!=norm(sale['name']):issues.append('Название в продажах отличается от каталога')
   if p['kind']!=sale['group_name']:issues.append('Категория в продажах отличается от каталога')
   if p['id'] in duplicate_ids:issues.append('Есть карточки с тем же названием, категорией и объёмом')
   if issues:status='review'
  else:
   status='missing' if sale.get('source_id') else 'unlinked'
   issues.append('Указанная складская карточка не найдена' if status=='missing' else 'У позиции продаж нет связи со складской карточкой')
  candidates=[] if p else [{'id':x['id'],'name':x['name'],'code':x['code']} for x in by_name.get((sale['group_name'],norm(sale['name'])),[])][:10]
  if candidates:issues.append('Есть совпадения по названию; автоматическое объединение не выполняется')
  rows.append({'id':'sale:'+sale['id'],'sales_id':sale['id'],'sales_name':sale['name'],'source_id':sale.get('source_id'),'product_id':p['id'] if p else None,'product_name':p['name'] if p else None,'code':p['code'] if p else None,'kind':p['kind'] if p else sale['group_name'],'status':status,'issues':issues,'candidates':candidates})
 for p in products:
  if p['id'] not in linked:
   rows.append({'id':'stock:'+p['id'],'sales_id':None,'sales_name':None,'source_id':None,'product_id':p['id'],'product_name':p['name'],'code':p['code'],'kind':p['kind'],'status':'review' if p['id'] in duplicate_ids else 'stock_only','issues':['Есть карточки с тем же названием, категорией и объёмом'] if p['id'] in duplicate_ids else [],'candidates':[]})
 counts={k:sum(r['status']==k for r in rows) for k in ('linked','review','missing','unlinked','stock_only')}
 return rows,counts


def state(connect):
 with connect() as c:
  locations=[dict(x) for x in c.execute("SELECT * FROM warehouse_locations ORDER BY CASE role WHEN 'central' THEN 0 ELSE 1 END,name")]
  products=[dict(x) for x in c.execute('SELECT id,code,name,kind,capacity FROM products ORDER BY name COLLATE NOCASE')]
  sales=[dict(x) for x in c.execute('SELECT id,source_id,name,group_name FROM sales_catalog ORDER BY name COLLATE NOCASE')]
  rows,counts=reconciliation(products,sales)
  return {'locations':locations,'reconciliation':rows,'counts':counts,'products':len(products),'sales_products':len(sales),'legacy_lots':c.execute("SELECT count(*) FROM lots WHERE status='active' AND remaining>0").fetchone()[0],'phase':'preparation'}
