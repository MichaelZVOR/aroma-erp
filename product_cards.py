
"""Product card metadata and explicit BIFIT catalog import; no stock movements."""
import csv,io,json,re,uuid,hashlib,unicodedata
from decimal import Decimal
def norm(s):
 s=unicodedata.normalize('NFKD',s.lower().replace('ё','е'))
 s=re.sub(r'\([^)]*\)',' ',s)
 s=re.sub(r'\d+(?:[.,]\d+)?\s*мл\.?\s*$|объ[её]м\s*$','',s)
 return ''.join(c for c in s if c.isalnum() and not unicodedata.combining(c))
def init(connect):
 with connect() as c:
  c.executescript("""CREATE TABLE IF NOT EXISTS product_profiles(product_id TEXT PRIMARY KEY REFERENCES products(id),revision INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_imports(digest TEXT PRIMARY KEY,created TEXT NOT NULL,report TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_members(product_id TEXT PRIMARY KEY REFERENCES products(id));
CREATE TABLE IF NOT EXISTS archived_products(id TEXT PRIMARY KEY,archived TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_profile_history(id INTEGER PRIMARY KEY,product_id TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,data TEXT NOT NULL);""")
def profiles(c):
 return {r['product_id']:{**json.loads(r['data']),'revision':r['revision']} for r in c.execute('SELECT * FROM product_profiles')}
def cents(v):
 if v is None or str(v).strip()=='':return None
 n=Decimal(str(v).strip().replace(',','.'))
 if not n.is_finite() or n<0 or n>100000000 or n*100!=(n*100).to_integral_value():raise ValueError('Проверьте цену закупки')
 return int(n*100)
def save(c,pid,d,now):
 if 'profile' not in d:return
 incoming=d['profile']
 if not isinstance(incoming,dict):raise ValueError('Проверьте карточку')
 old=c.execute('SELECT * FROM product_profiles WHERE product_id=?',(pid,)).fetchone()
 revision=old['revision'] if old else 0
 if d.get('profile_revision',0)!=revision:raise ValueError('Карточка уже изменена. Обновите страницу и повторите.')
 data=json.loads(old['data']) if old else {}
 for key in ('category','short_name','description','barcode','vendor_code','vat','payment_subject','unit_code','shelf_life','shelf_unit','pack_qty','pack_unit','mark_type','gtin','agent_type','good_type'):
  value=incoming.get(key,'')
  if value is None:value=''
  if not isinstance(value,(str,int,float)):raise ValueError('Проверьте поле '+key)
  value=str(value).strip()
  if len(value)>(5000 if key=='description' else 300):raise ValueError('Слишком длинное поле '+key)
  data[key]=value
 for key in ('adult','weighted','focus'):
  if type(incoming.get(key,False)) is not bool:raise ValueError('Проверьте признак '+key)
  data[key]=incoming.get(key,False)
 data['purchase_price']=cents(incoming.get('purchase_price'))
 if data.get('gtin') and not re.fullmatch(r'\d{14}',data['gtin']):raise ValueError('GTIN должен содержать 14 цифр')
 for key in ('shelf_life','pack_qty'):
  if data.get(key):
   try:v=Decimal(data[key].replace(',','.'))
   except Exception:raise ValueError('Проверьте количество / срок годности')
   if not v.is_finite() or v<0:raise ValueError('Количество / срок не может быть отрицательным')
 if old:c.execute('INSERT INTO product_profile_history(product_id,revision,created,data) VALUES(?,?,?,?)',(pid,revision,now,old['data']))
 c.execute('INSERT INTO product_profiles VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,data=excluded.data',(pid,revision+1,json.dumps(data,ensure_ascii=False)))
def parse(raw):
 try:text=raw.decode('utf-8-sig')
 except UnicodeDecodeError:text=raw.decode('cp1251')
 rows=list(csv.DictReader(io.StringIO(text),delimiter=';'));goods=[];groups=[]
 ids=set();codes=set()
 for r in rows:
  if r.get('GROUPED')=='1':groups.append(r['NAME']);continue
  if r.get('GROUP') not in ('Распив','Объёмы'):raise ValueError('Неизвестная категория: '+str(r.get('GROUP')))
  if not r.get('ID') or not r.get('EXTERNAL_CODE') or not r.get('NAME'):raise ValueError('Пустой идентификатор/название')
  if r['ID'] in ids or r['EXTERNAL_CODE'] in codes:raise ValueError('Повтор ID/кода')
  ids.add(r['ID']);codes.add(r['EXTERNAL_CODE'])
  m=re.search(r'(\d+(?:[.,]\d+)?)\s*мл\.?\s*$',r['NAME'],re.I)
  cap=Decimal(m[1].replace(',','.'))*1000 if m else None
  if cap is not None and (cap<=0 or cap!=cap.to_integral_value()):raise ValueError('Проверьте объём')
  goods.append((r,'decant' if r['GROUP']=='Распив' else 'bottle',int(cap) if cap is not None else None))
 return goods,groups
def import_catalog(connect,raw,now,volumes=None,replace=False):
 volumes=volumes or {}
 digest=hashlib.sha256(raw+json.dumps([volumes,replace],sort_keys=True).encode()).hexdigest();goods,groups=parse(raw)
 with connect() as c:
  c.execute('BEGIN IMMEDIATE')
  done=c.execute('SELECT report FROM catalog_imports WHERE digest=?',(digest,)).fetchone()
  if done:return {**json.loads(done['report']),'duplicate':True}
  db={p['code']:dict(p) for p in c.execute('SELECT * FROM products')}
  trusted_codes={x['code'] for x in c.execute('SELECT code FROM decant_import')} if c.execute("SELECT 1 FROM sqlite_master WHERE name='decant_import'").fetchone() else set()
  oldprofiles=profiles(c);by_bifit={v.get('bifit_id'):pid for pid,v in oldprofiles.items() if v.get('bifit_id')}
  report={'goods':len(goods),'groups':groups,'added':0,'updated':0,'collisions':[],'items':[],'preserved_names':[],'missing_volume':[]}
  for r,kind,cap in goods:
   cap=volumes.get(r['EXTERNAL_CODE'],cap)
   ext=r['EXTERNAL_CODE'];existing=db.get(ext);pid=by_bifit.get(r['ID'])
   if not pid and kind=='decant' and ext in trusted_codes and existing and existing['kind']==kind and (cap is None or existing['capacity']==cap):pid=existing['id']
   if not pid and existing and existing['kind']==kind and norm(existing['name'])==norm(r['NAME']) and (cap is None or existing['capacity']==cap):pid=existing['id']
   if pid:
    p=dict(c.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone());code=p['code']
    if p['kind']!=kind:raise ValueError('Категория изменилась для ID '+r['ID'])
    # Blank CSV price is unknown: never erase an existing nonempty retail price.
    if cap is None:cap=p['capacity']
    sale=cents(r['PRICE'])
    display_name=r['NAME']
    if display_name!=r['NAME']:report['preserved_names'].append({'code':ext,'csv_name':r['NAME'],'kept':display_name})
    c.execute('UPDATE products SET name=?,capacity=?,sale=?,note=? WHERE id=?',(display_name,cap,sale,'Импорт БИФИТ 28.10.2026',pid));report['updated']+=1
   else:
    pid='bifit:'+r['ID'];code=ext
    if existing:
     code='BF-'+ext;report['collisions'].append({'external_code':ext,'existing':existing['name'],'imported':r['NAME'],'assigned_code':code})
    if code in db:raise ValueError('Код уже занят: '+code)
    c.execute('INSERT INTO products(id,code,name,kind,capacity,sale,note) VALUES(?,?,?,?,?,?,?)',(pid,code,r['NAME'],kind,cap,cents(r['PRICE']),'Импорт БИФИТ 28.10.2026'))
    db[code]={'id':pid};report['added']+=1
   data={**oldprofiles.get(pid,{}),'bifit_id':r['ID'],'external_code':ext,'category':r['GROUP'],'good_type':r['GOOD_TYPE'],'barcode':r['BARCODE'].strip(),'vendor_code':r['VENDOR_CODE'].strip(),'vat':r['NDS'].strip(),'payment_subject':r['PAYMENT_SUBJECT'].strip(),'unit_code':r['UNIT_CODE'].strip(),'purchase_price':cents(r['PURCHASE_PRICE']),'weighted':r['WEIGHTED']=='1','mark_type':r['MARK_TYPE'].strip(),'gtin':r['GTIN'].strip(),'raw_bifit':r}
   data.pop('revision',None)
   old=c.execute('SELECT * FROM product_profiles WHERE product_id=?',(pid,)).fetchone();rev=old['revision']+1 if old else 1
   if old:c.execute('INSERT INTO product_profile_history(product_id,revision,created,data) VALUES(?,?,?,?)',(pid,old['revision'],now,old['data']))
   c.execute('INSERT INTO product_profiles VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,data=excluded.data',(pid,rev,json.dumps(data,ensure_ascii=False)))
   if cap is None:report['missing_volume'].append({'code':code,'name':r['NAME']})
   report['items'].append({'id':pid,'code':code,'name':r['NAME'],'kind':kind})
  report['replacement']=replace
  if replace:
   keep={x['id'] for x in report['items']}
   removed=[dict(p) for p in c.execute('SELECT * FROM products') if p['id'] not in keep]
   for p in removed:
    if c.execute('SELECT 1 FROM lots WHERE product_id=?',(p['id'],)).fetchone():raise ValueError('У старого товара есть партии: требуется отдельная сверка '+p['name'])
   c.execute('DELETE FROM catalog_members')
   for p in removed:
    c.execute('INSERT OR REPLACE INTO archived_products VALUES(?,?,?)',(p['id'],now,json.dumps(p,ensure_ascii=False)))
    c.execute('DELETE FROM product_profiles WHERE product_id=?',(p['id'],))
    c.execute('DELETE FROM products WHERE id=?',(p['id'],))
   for item in report['items']:
    profile=json.loads(c.execute('SELECT data FROM product_profiles WHERE product_id=?',(item['id'],)).fetchone()[0])
    external=profile['external_code']
    if item['code'].startswith('BF-') and not c.execute('SELECT 1 FROM products WHERE code=?',(external,)).fetchone():
     c.execute('UPDATE products SET code=? WHERE id=?',(external,item['id']));item['code']=external
    c.execute('INSERT INTO catalog_members VALUES(?)',(item['id'],))
    # Sales journal keeps its saved document snapshots; only the selectable catalog is refreshed.
    prior=c.execute('SELECT id FROM sales_catalog WHERE source_id=?',(item['id'],)).fetchone() if c.execute("SELECT 1 FROM sqlite_master WHERE name='sales_catalog'").fetchone() else None
    if c.execute("SELECT 1 FROM sqlite_master WHERE name='sales_catalog'").fetchone():
     c.execute('INSERT INTO sales_catalog VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cost=excluded.cost,price=excluded.price,updated=excluded.updated,group_name=excluded.group_name,cost_source=excluded.cost_source',(prior['id'] if prior else item['id'],item['id'],item['name'],profile['purchase_price'],c.execute('SELECT sale FROM products WHERE id=?',(item['id'],)).fetchone()[0],now,item['kind'],'csv'))
   c.execute('UPDATE products SET source_id=NULL WHERE source_id NOT IN (SELECT id FROM products)')
   report['removed_from_catalog']=len(removed)
  c.execute('INSERT INTO catalog_imports VALUES(?,?,?)',(digest,now,json.dumps(report,ensure_ascii=False)))
 return report

