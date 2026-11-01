"""Preliminary calculator; pricing follows the explicitly supplied subtraction example."""
from decimal import Decimal as D, InvalidOperation, ROUND_HALF_UP, ROUND_CEILING, ROUND_FLOOR
MODEL='perfume_markup_v3'
CENT=D('.01')
def n(x,label,maximum=D('100000000'),precision=None):
 if x is None or x=='':return None
 try:v=D(str(x).replace(',','.'))
 except InvalidOperation:raise ValueError('Проверьте: '+label)
 if not v.is_finite() or v<0 or v>maximum:raise ValueError('Недопустимое значение: '+label)
 if precision is not None and v!=v.quantize(precision):raise ValueError('Слишком много знаков: '+label)
 return v
def money(v):return v.quantize(CENT,rounding=ROUND_HALF_UP)
def up(v,step=CENT):return (v/step).to_integral_value(rounding=ROUND_CEILING)*step
def t(v):return None if v is None else str(v)
def delivery(d,label):
 if not isinstance(d,dict) or d.get('mode') not in ('unit','box','free'):raise ValueError('Выберите доставку: '+label)
 if d['mode']=='free':return D(0)
 value=n(d.get('amount'),label,precision=CENT)
 if d['mode']=='unit':return value
 count=n(d.get('count'),'Количество в коробке',precision=D(1))
 if count==0:raise ValueError('Количество в коробке должно быть больше нуля')
 return value/count if value is not None and count is not None else None
def fees(price,seller,bank):
 a=money(price*seller/100);b=money(price*bank/100)
 return a,b,a+b
def floor_price(cost,seller,bank):
 p=up(cost/(1-(seller+bank)/100))
 while p-cost-fees(p,seller,bank)[2]<0:p+=CENT
 return p
def quote(d):
 if not isinstance(d,dict) or d.get('pricing_model')!=MODEL:raise ValueError('Неверная версия калькулятора')
 p=d.get('perfume')
 if not isinstance(p,dict):raise ValueError('Укажите параметры флакона')
 purchase=n(p.get('price'),'Закупка',precision=CENT);volume=n(p.get('volume'),'Объём',precision=D('.001'))
 if volume==0:raise ValueError('Объём должен быть больше нуля')
 shipping=delivery(p.get('delivery'),'Доставка духов');atom_shipping=delivery(d.get('atom_delivery'),'Доставка атомайзеров')
 loss=n(d.get('loss_percent',2),'Потери',D('99.99'),CENT);work=n(d.get('work'),'Работа',precision=CENT);label=n(d.get('label'),'Наклейка',precision=CENT)
 seller=n(d.get('seller_rate',10),'Продавцу',D(100),CENT);bank=n(d.get('acquiring_rate',3),'Эквайринг',D(100),CENT);discount=n(d.get('discount_percent',0),'Скидка',D(100),CENT)
 if None in (seller,bank,discount,loss):raise ValueError('Заполните потери, скидку и проценты расходов')
 if seller+bank>=100:raise ValueError('Сумма расходов с продажи должна быть меньше 100%')
 step=n(d.get('round_step',10),'Шаг округления',precision=CENT)
 if step is None or step<=0:raise ValueError('Шаг округления должен быть больше нуля')
 if type(d.get('round_cost')) is not bool or type(d.get('round_price')) is not bool:raise ValueError('Проверьте округление')
 data=d.get('rows')
 if not isinstance(data,dict):raise ValueError('Укажите параметры объёмов')
 landed=purchase+shipping if purchase is not None and shipping is not None else None
 delivery_only=landed/volume if landed is not None and volume is not None else None
 usable=volume*(1-loss/100) if volume is not None else None
 liquid=landed/usable if landed is not None and usable is not None else None
 used_ml=up(liquid,D(1)) if liquid is not None and d['round_cost'] else liquid
 results=[]
 for ml in (1,2,3,5,10):
  row=data.get(str(ml),{})
  if not isinstance(row,dict):raise ValueError('Проверьте объём '+str(ml))
  enabled=True if ml==1 else row.get('enabled',True)
  if type(enabled) is not bool:raise ValueError('Укажите используемые объёмы')
  if not enabled:results.append({'ml':ml,'inactive':True});continue
  k=n(row.get('coefficient'),'Коэффициент '+str(ml),D(100),D('.001'))
  if k==0:raise ValueError('Коэффициент должен быть больше нуля')
  sale=n(row.get('sale'),'Ваша цена '+str(ml),precision=CENT)
  atom=D(0);mode=row.get('atom_price_mode','purchase');missing=[]
  if used_ml is None:missing.append('закупка, объём и доставка духов')
  if work is None:missing.append('работа за мл')
  if ml!=1:
   if mode not in ('purchase','landed'):raise ValueError('Выберите, включена ли доставка в цену атомайзера')
   raw=n(row.get('atom_landed_price') if mode=='landed' else row.get('atom_price'),'Атомайзер '+str(ml),precision=CENT)
   atom=raw if mode=='landed' else money(raw+atom_shipping) if raw is not None and atom_shipping is not None else None
   if atom is None:missing.append('атомайзер и его доставка')
   if label is None:missing.append('наклейка')
  r={'ml':ml,'inactive':False,'missing':missing,'coefficient':t(k),'atom_delivered':t(atom)}
  r['parts']={'liquid':t(used_ml*ml) if used_ml is not None else None,'work':t(work*ml) if work is not None else None,'label':t(label if ml!=1 else D(0)),'atom':t(atom),'rounding':None}
  cost=basis=recommended=None
  if not missing:
   exact=ml*(used_ml+work)+(label if ml!=1 else 0)+atom
   cost=up(exact,D(1)) if d['round_cost'] else money(exact);basis=cost-atom
   calculated=basis*k-atom if k is not None else None
   if calculated is not None and calculated<0:
    r['pricing_warning']='По заданной формуле цена отрицательная: проверьте базу и атомайзер или введите свою цену';calculated=None
   recommended=(up(calculated,step) if d['round_price'] else money(calculated)) if calculated is not None else None
   r['parts']={'liquid':t(ml*used_ml),'work':t(ml*work),'label':t(label if ml!=1 else D(0)),'atom':t(atom),'rounding':t(cost-exact)}
  base=sale if sale is not None else recommended;final=money(base*(1-discount/100)) if base is not None else None
  r.update(cost=t(cost),markup_base=t(basis),recommended=t(recommended),recommended_per_ml=t(recommended/ml) if recommended is not None else None,base_price=t(base),base_source='manual' if sale is not None else 'recommended',discount_percent=t(discount),price=t(final),price_per_ml=t(final/ml) if final is not None else None)
  if final is not None:
   sf,bf,total=fees(final,seller,bank);r.update(seller_expense=t(sf),acquiring_expense=t(bf),expenses=t(total),discount_amount=t(base-final))
  if cost is not None:
   minimum=floor_price(cost,seller,bank);limit=None
   if base is not None and base>0 and base>=minimum:limit=((1-minimum/base)*100).quantize(CENT,rounding=ROUND_FLOOR)
   r.update(minimum=t(minimum),max_discount=t(limit))
   if final is not None:
    gross=final-cost;contribution=money(gross-total)
    r.update(gross=t(gross),gross_margin=t(gross/final*100) if final>0 else None,markup=t(gross/cost*100) if cost>0 else None,contribution=t(contribution),contribution_margin=t(contribution/final*100) if final>0 else None,status='loss' if contribution<0 else 'zero' if contribution==0 else 'positive')
  results.append(r)
 scale=[r for r in results if r['ml']!=1 and r.get('price') is not None and not r.get('inactive')]
 warning=any(D(b['price'])/b['ml']>D(a['price'])/a['ml'] for a,b in zip(scale,scale[1:]))
 return {'pricing_model':MODEL,'bottle_delivery':t(shipping),'atom_delivery':t(atom_shipping),'per_ml_delivery_only':t(delivery_only),'usable_volume':t(usable),'liquid_per_ml_exact':t(liquid),'fees_percent':t(seller+bank),'scale_warning':warning,'rows':results}


