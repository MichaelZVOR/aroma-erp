'use client';

import {useEffect,useRef,useState} from 'react';
import {Alert,AutoComplete,Button,Card,Checkbox,Collapse,Descriptions,Divider,InputNumber,Select,Space,Spin,Statistic,Table,Tag,Typography} from 'antd';
import {SaveOutlined,PlusOutlined} from '@ant-design/icons';

const ML=[2,3,5,10];
const rub=v=>v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(v));
const num=v=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(Number(v));
const inputFormat={formatter:(value,info)=>info.userTyping?info.input:(value==null||value===''?'':String(Number(value)).replace('.',',')),parser:value=>value?.replace(/\s/g,'').replace(',','.')};
const active=row=>row.enabled??(row.atom_price!=null&&row.coefficient!=null);
const upgrade=d=>{
 if(d.pricing_model==='base_ml_v2')return d;
 const next=structuredClone(d);
 const base=Number(d.one_ml_coefficient||d.rows?.['1']?.coefficient)||Math.max(1,...ML.map(ml=>Number(d.rows?.[ml]?.coefficient)||0));
 next.pricing_model='base_ml_v2';next.loss_percent=d.loss_percent??2;next.one_ml_coefficient=base;
 return next;
};
const empty=()=>upgrade({name:'',perfume:{price:null,volume:100,delivery:{mode:'unit',amount:0,count:null}},atom_delivery:{mode:'unit',amount:0,count:null},label:5,work:8,round_cost:true,round_step:10,fees:[{name:'Комиссия продавцу',rate:10},{name:'Эквайринг',rate:3},{name:'Реклама',rate:5},{name:'Упаковка с продажи',rate:2}],rows:{'1':{atom_price:null,coefficient:null,sale:null},'2':{atom_price:26,coefficient:3,sale:null},'3':{atom_price:28,coefficient:2.9,sale:null},'5':{atom_price:28,coefficient:2.8,sale:null},'10':{atom_price:30,coefficient:2.5,sale:null}}});
const validDraft=d=>d&&typeof d.name==='string'&&d.perfume?.delivery&&d.atom_delivery&&Array.isArray(d.fees)&&d.fees.length===4&&ML.every(n=>d.rows?.[n]);
const cleanName=s=>s.replace(/\s*[—–-]\s*ОБЪ[ЁЕ]М\s*$/i,'');

function MoneyInput({label,value,onChange,precision=2,min=0,...props}) {
 return <label className="cost-field"><span>{label}</span><InputNumber aria-label={label} value={value} onChange={onChange} min={min} precision={precision} controls={false} decimalSeparator="," {...inputFormat} {...props}/></label>;
}

function Delivery({title,value,onChange,noun}) {
 const box=value.mode==='box';
 const perUnit=value.amount!=null&&(!box||value.count>0)?Number(value.amount)/(box?value.count:1):null;
 return <div className="delivery-block"><Typography.Text strong>{title}</Typography.Text>
  <Select aria-label={`Способ расчёта — ${title}`} value={value.mode} onChange={mode=>onChange({mode,amount:null,count:null})} options={[{value:'unit',label:`На один ${noun}, ₽`},{value:'box',label:'За коробку / посылку, ₽'}]}/>
  <div className={box?'cost-fields two':'cost-fields one'}>
   <MoneyInput label={box?`${title} за коробку, ₽`:`${title} на штуку, ₽`} value={value.amount} onChange={amount=>onChange({...value,amount})}/>
   {box&&<MoneyInput label={`Количество ${noun==='флакон'?'флаконов духов':'атомайзеров'} в коробке, шт.`} value={value.count} onChange={count=>onChange({...value,count})} precision={0} min={1}/>}
  </div>
  <div className="cost-help">На одну штуку: <strong>{rub(perUnit)}</strong>{box&&value.amount!=null&&value.count>0?` = ${rub(value.amount)} ÷ ${num(value.count)} шт.`:''}</div>
  {box&&<div className="cost-help">Укажите общее количество {noun==='флакон'?'всех флаконов духов':'всех атомайзеров, включая разные объёмы'} в этой посылке. Стоимость доставки распределяется поровну на штуку.</div>}
 </div>;
}

export default function CostCalculator({api,message,s}) {
 const [data,setData]=useState(null),[sets,setSets]=useState({presets:[],saved:[]}),[savedId,setSavedId]=useState(null),[chosen,setChosen]=useState(null),[result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[saveBusy,setSaveBusy]=useState(false),[dirty,setDirty]=useState(false),[detail,setDetail]=useState(false);
 const version=useRef(0),latest=useRef(api);latest.current=api;
 useEffect(()=>{
  let live=true;
  fetch('/api/cost/state',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Не удалось загрузить сохранённые расчёты');return r.json()}).then(next=>{
   if(!live)return;next.saved=next.saved.filter(x=>x.payload?.pricing_model!=='perfume_markup_v3');setSets(next);
   let cached=null;try{cached=JSON.parse(localStorage.getItem('aroma.cost.draft.v1'))}catch{}
   if(validDraft(cached?.payload)){
    const stored=next.saved.find(x=>x.id===cached.id);
    setData(upgrade(cached.payload));setSavedId(stored?.id||null);
    setDirty(!stored||JSON.stringify(stored.payload)!==JSON.stringify(cached.payload));
    if(stored)setChosen('saved:'+stored.id);
   }
   else if(next.presets.length){setData(upgrade(next.presets[0].payload));setChosen('preset:'+next.presets[0].id)}
   else setData(empty());
  }).catch(e=>{if(live){setError(e.message);setData(empty())}});
  return()=>{live=false};
 },[]);
 useEffect(()=>{
  if(!data)return;
  const request=++version.current;setLoading(true);setResult(null);setError('');
  try{localStorage.setItem('aroma.cost.draft.v1',JSON.stringify({payload:data,id:savedId}))}catch{}
  const timer=setTimeout(async()=>{
   try{const answer=await latest.current('/api/cost/calculate',data);if(request===version.current)setResult(answer)}
   catch(e){if(request===version.current)setError(e.message)}
   finally{if(request===version.current)setLoading(false)}
  },180);
  return()=>{clearTimeout(timer);version.current++};
 },[data]);
 const change=update=>{setData(d=>typeof update==='function'?update(d):{...d,...update});setDirty(true)};
 const rowChange=(ml,key,value)=>change(d=>({...d,rows:{...d.rows,[ml]:{...d.rows[ml],[key]:value}}}));
 const selectCalc=value=>{
  const preset=value.startsWith('preset:');const id=value.slice(value.indexOf(':')+1);
  const entry=(preset?sets.presets:sets.saved).find(x=>x.id===id);if(!entry)return;
  setData(upgrade(entry.payload));setSavedId(preset?null:id);setChosen(value);setDirty(false);
 };
 const save=async copy=>{
  setSaveBusy(true);
  try{
   const answer=await latest.current('/api/cost/save',{payload:data,id:copy?null:savedId});
   const next={id:answer.id,name:data.name,payload:structuredClone(data),updated:answer.updated};
   setSets(old=>({...old,saved:[next,...old.saved.filter(x=>x.id!==next.id)]}));setSavedId(next.id);setChosen('saved:'+next.id);setDirty(false);
   try{localStorage.setItem('aroma.cost.draft.v1',JSON.stringify({payload:data,id:next.id}))}catch{}
   message.success('Расчёт сохранён в базе на этом компьютере');
  }catch(e){message.error(e.message)}finally{setSaveBusy(false)}
 };
 if(!data)return <div style={{padding:70,textAlign:'center'}}><Spin size="large"/></div>;
 const options=[{label:'Мои сохранённые расчёты',options:sets.saved.map(x=>({value:'saved:'+x.id,label:x.name}))},{label:'Начальные примеры расчётов',options:sets.presets.map(x=>({value:'preset:'+x.id,label:x.payload.name}))}].filter(x=>x.options.length);
 const perfumeOptions=Array.from(new Set(s.products.filter(p=>p.kind==='bottle').map(p=>cleanName(p.name)))).map(value=>({value}));
 const numeric=(label,value,onChange,props={})=><MoneyInput label={label} value={value} onChange={onChange} {...props}/>;
 const cfgRows=ML.map(ml=>({ml,...data.rows[ml],enabled:active(data.rows[ml])}));
 const resultRows=ML.map(ml=>active(data.rows[ml])?(result?.rows.find(r=>r.ml===ml)||{ml,missing:[],cost:null}):{ml,inactive:true,missing:[],cost:null});
 const displayRows=[result?.one_ml||{ml:1,cost:null,missing:[]},...resultRows];
 const referenceOptions=cfgRows.filter(r=>r.enabled).map(r=>({value:r.ml,label:`На основе распива ${r.ml} мл`}));
 const oneMl=result?.one_ml;
 const discountOptions=[{value:1,label:'1 мл — без флакона'},...referenceOptions.map(o=>({...o,label:`${o.value} мл`}))];
 const discountMl=discountOptions.some(o=>o.value===data.discount_ml)?data.discount_ml:referenceOptions.at(-1)?.value??1;
 const discountRow=displayRows.find(r=>r.ml===discountMl);
 const analysis=discountRow?.discount_analysis;
 const discountStatus=analysis?.status;
 const columns=[
  {title:'Объём',dataIndex:'ml',width:90,fixed:'left',render:n=><strong>{n} мл{n===1?'*':''}</strong>},
  {title:'Себестоимость',dataIndex:'cost',width:160,render:(v,r)=>r.inactive?'—':v==null?<span className="cost-help">{loading?'Расчёт…':r.missing?.length?'Заполните: '+r.missing.join(', '):'—'}</span>:<strong>{rub(v)}</strong>},
  {title:'Расчётная цена',dataIndex:'recommended',width:155,render:(v,r)=>r.inactive?'—':v==null?<span className="cost-help">Нужен коэффициент</span>:rub(v)},
  {title:'Ваша цена, ₽',key:'saleInput',width:155,render:(_,r)=>r.inactive?'—':<InputNumber aria-label={`Цена продажи ${r.ml} мл`} value={data.rows[r.ml]?.sale??null} onChange={v=>rowChange(r.ml,'sale',v)} min={0} precision={2} decimalSeparator="," {...inputFormat} controls={false} style={{width:130}} placeholder="Расчётная"/>},
  {title:'Себестоимость 1 мл',key:'costPerMl',width:160,render:(_,r)=>rub(r.cost==null?null:Number(r.cost)/r.ml)},
  {title:'Цена продажи 1 мл',key:'salePerMl',width:170,render:(_,r)=>rub(r.discount_analysis?.base_price==null?null:Number(r.discount_analysis.base_price)/r.ml)},
 ];
 const profitColumns=[columns[0],{title:'Цена для расчёта',key:'effectivePrice',width:155,render:(_,r)=><>{rub(r.discount_analysis?.base_price)}{r.discount_analysis?.base_source==='recommended'&&<div className="cost-help">Расчётная</div>}</>},
  {title:'Валовая прибыль',key:'gross',width:155,render:(_,r)=>rub(r.discount_analysis?.base_gross)},
  {title:'Наценка',key:'markup',width:125,render:(_,r)=>r.discount_analysis?.base_markup==null?'—':num(r.discount_analysis.base_markup)+'%'},
  {title:'Валовая маржа',key:'margin',width:135,render:(_,r)=>r.discount_analysis?.base_margin==null?'—':num(r.discount_analysis.base_margin)+'%'},
  {title:'Расходы с продажи',key:'expenses',width:155,render:(_,r)=>rub(r.discount_analysis?.base_expenses)},
  {title:'Остаток после расходов',key:'net',width:180,render:(_,r)=><strong className={Number(r.discount_analysis?.base_remaining)<0?'negative':'positive'}>{rub(r.discount_analysis?.base_remaining)}</strong>},
 ];
 if(detail)profitColumns.push(
  {title:'Цена покрытия затрат',dataIndex:'minimum',width:160,render:rub},
  {title:'Скидка до нулевого остатка',dataIndex:'max_discount',width:180,render:(v,r)=>v!=null?num(v)+'%':r.below_minimum?'Недоступна':'—'},
 );
 const priceScale=displayRows.filter(r=>r.discount_analysis?.base_price!=null&&Number(r.discount_analysis.base_price)>0).map(r=>({...r,sale:r.discount_analysis.base_price}));
 const scaleWarning=priceScale.some((r,i)=>i>0&&Number(r.sale)/r.ml>Number(priceScale[i-1].sale)/priceScale[i-1].ml);
 return <>
  <div className="page-heading"><div><h1>Калькулятор себестоимости</h1><p>Доставка, упаковка, себестоимость и цены для каждого объёма.</p></div><Space wrap><Button icon={<PlusOutlined/>} onClick={()=>{setData(empty());setSavedId(null);setChosen(null);setDirty(true)}}>Новый расчёт</Button><Button type="primary" icon={<SaveOutlined/>} loading={saveBusy} disabled={!data.name.trim()||loading||!!error} onClick={()=>save(false)}>Сохранить расчёт</Button></Space></div>
  <div className="cost-presets"><Select aria-label="Открыть расчёт" placeholder="Открыть сохранённый расчёт или пример" showSearch optionFilterProp="label" value={chosen} onChange={selectCalc} options={options} style={{width:'100%',maxWidth:560}}/>{savedId?<Tag color={dirty?'orange':'green'}>{dirty?'Есть изменения':'Расчёт сохранён'}</Tag>:<Tag>Предварительный расчёт</Tag>}{savedId&&<Button disabled={loading||!!error||saveBusy} onClick={()=>save(true)}>Сохранить копию</Button>}</div>
  <Alert type="info" showIcon title="Как распределяется доставка" description="Если доставка коробки стоит 1 000 ₽ и в ней 20 флаконов, к каждому добавится 50 ₽. Доставка духов и атомайзеров рассчитывается отдельно." style={{marginBottom:22}}/>
  <h2 className="cost-step">Закупка и доставка</h2>
  <div className="cost-grid">
   <Card title="Флакон духов">
    <label className="cost-field"><span>Название аромата</span><AutoComplete aria-label="Название аромата" value={data.name} options={perfumeOptions} filterOption={(input,option)=>option.value.toLowerCase().includes(input.toLowerCase())} onChange={name=>change({name})} placeholder="Выберите из каталога или введите своё"/></label>
    <div className="cost-fields two">
     {numeric('Закупочная цена флакона, ₽',data.perfume.price,price=>change(d=>({...d,perfume:{...d.perfume,price}})))}
     {numeric('Объём флакона, мл',data.perfume.volume,volume=>change(d=>({...d,perfume:{...d.perfume,volume}})),{precision:3,min:0.001})}
    </div>
    <Delivery title="Доставка духов" noun="флакон" value={data.perfume.delivery} onChange={delivery=>change(d=>({...d,perfume:{...d.perfume,delivery}}))}/>
   </Card>
   <Card title="Доставка атомайзеров">
    
    <Delivery title="Доставка атомайзеров" noun="атомайзер" value={data.atom_delivery} onChange={atom_delivery=>change({atom_delivery})}/>
   </Card>
  </div>
  <div className="cost-summary">
   <Card><Statistic title="Доставка на флакон духов" value={result?.bottle_delivery==null?'—':Number(result.bottle_delivery)} formatter={rub} /><div className="cost-help">Флакон с доставкой: {rub(result?.bottle_landed)}</div></Card>
   <Card><Statistic title="Доставка на атомайзер" value={result?.atom_delivery==null?'—':Number(result.atom_delivery)} formatter={rub} /><div className="cost-help">Прибавляется к цене каждой пустой тары</div></Card>
   <Card><Statistic title="Себестоимость 1 мл только с доставкой" value={result?.per_ml_delivery_only??'—'} formatter={rub} /><div className="cost-help">(Закупка + доставка духов) ÷ объём. Без работы, упаковки и потерь.</div></Card>
  </div>
  <Card title="Потери при распиве" style={{marginBottom:22}}>
   <div className="cost-fields two">
    {numeric('Потери при распиве, %',data.loss_percent??2,loss_percent=>change({loss_percent}),{max:99.99})}
    <Statistic title="Доступный объём после потерь, мл" value={result?.usable_volume??'—'} formatter={num}/>
   </div>
   <div className="cost-help">Стоимость парфюма распределяется на оставшийся объём: при потерях 2% из 100 мл для продажи остаётся 98 мл. Себестоимость жидкости за мл с потерями: {rub(result?.per_ml_exact)} до округления.</div>
  </Card>
  <h2 className="cost-step">Флаконы и расходы</h2>
  <Collapse style={{marginBottom:22}} defaultActiveKey={['packaging']} items={[
   {key:'packaging',label:'Флаконы, упаковка и коэффициенты',children:<><div className="cost-fields two">{numeric('Этикетка на распив, ₽',data.label,label=>change({label}))}{numeric('Работа за 1 мл, ₽',data.work,work=>change({work}))}</div><p className="cost-help">Включите используемые объёмы. Расчётная цена = себестоимость готового распива × его коэффициент. Для больших объёмов можно задать меньший коэффициент.</p><Table rowKey="ml" pagination={false} dataSource={cfgRows} columns={[{title:'Использовать',key:'enabled',render:(_,r)=><Checkbox aria-label={`Использовать ${r.ml} мл`} checked={r.enabled} onChange={e=>rowChange(r.ml,'enabled',e.target.checked)}/>},{title:'Объём наполнения',dataIndex:'ml',render:n=>n+' мл'},{title:'Пустой атомайзер, ₽',key:'atom',render:(_,r)=>!r.enabled?'—':<InputNumber aria-label={`Цена атомайзера ${r.ml} мл`} value={r.atom_price} onChange={v=>rowChange(r.ml,'atom_price',v)} min={0} precision={2} decimalSeparator="," {...inputFormat} controls={false} placeholder="Не задана"/>},{title:'Коэффициент цены',key:'coefficient',render:(_,r)=>!r.enabled?'—':<InputNumber aria-label={`Коэффициент ${r.ml} мл`} value={r.coefficient} onChange={v=>rowChange(r.ml,'coefficient',v)} min={0.01} max={100} precision={3} decimalSeparator="," {...inputFormat} controls={false} placeholder="Не задан"/>}]} scroll={{x:580}}/></>},
   {key:'expenses',label:`Расходы с продажи — ${num(result?.fees_percent??data.fees.reduce((a,f)=>a+Number(f.rate||0),0))}%`,children:<><div className="cost-fields four">{data.fees.map((fee,i)=><MoneyInput key={i} label={fee.name+', %'} value={fee.rate} onChange={rate=>change(d=>({...d,fees:d.fees.map((f,j)=>i===j?{...f,rate}:f)}))} precision={2} max={99.99}/>)}</div><p className="cost-help">Проценты вычитаются из цены продажи при расчёте результата после расходов. Этикетка уже учтена в себестоимости; «упаковка с продажи» — дополнительная статья расходов. При необходимости установите 0%.</p></>},
   {key:'rounding',label:'Округление',children:<Space direction="vertical"><Checkbox checked={data.round_cost} onChange={e=>change({round_cost:e.target.checked})}>Округлять вверх стоимость 1 мл, упаковки и распива до целого рубля</Checkbox><p className="cost-help">Если выключить, стоимость 1 мл используется без промежуточного округления, себестоимость распива округляется до копеек.</p>{numeric('Округлять расчётную цену вверх до кратного, ₽',data.round_step,round_step=>change({round_step}),{min:0.01})}<p className="cost-help">Меняет только столбец «Расчётная цена». Например, 759 ₽: шаг 10 → 760 ₽, шаг 50 → 800 ₽. Себестоимость и «Ваша цена» сохраняются.</p></Space>},
  ]}/>
  {error&&<Alert type="error" showIcon title={error} style={{marginBottom:18}}/>}
  <h2 className="cost-step">Себестоимость и цена</h2>
  <Card style={{marginBottom:22,borderColor:'#b7c9ff',background:'#f5f8ff'}}>
   <div className="cost-fields two">
    <Statistic title="Рекомендуемая цена 1 мл без флакона" value={oneMl?.price??'—'} formatter={rub}/>
    {numeric('Коэффициент наценки 1 мл',data.one_ml_coefficient??data.rows['1']?.coefficient??null,one_ml_coefficient=>change({one_ml_coefficient}),{precision:3,min:0.01,max:100,placeholder:'Укажите коэффициент для 1 мл'})}
   </div>
   <div className="cost-help">Себестоимость 1 мл с работой: <strong>{rub(oneMl?.cost)}</strong> = парфюм с доставкой и потерями {rub(oneMl?.parts?.liquid)} + работа распивщика {rub(oneMl?.parts?.work)}. Рекомендуемая цена учитывает наценку и не ниже покрытия указанных расходов с продажи. Пустой флакон, его доставка и этикетка прибавляются только к готовому распиву.</div>
   {oneMl?.coefficient==null&&<div className="cost-help" style={{marginTop:8}}>Укажите наценку для базовой цены 1 мл. Для объёмов 2–10 мл используется собственный коэффициент цены.</div>}
   {oneMl?.price!=null&&resultRows.some(r=>r.recommended!=null&&Number(r.recommended)/r.ml>=Number(oneMl.price))&&<Alert style={{marginTop:12}} type="warning" showIcon title="С учётом упаковки у некоторых распивов цена за мл не ниже базовой. Проверьте коэффициенты цены."/>}
  </Card>
  {scaleWarning&&<Alert type="warning" showIcon title="Проверьте цены: больший объём получился дороже в пересчёте на 1 мл." style={{marginBottom:18}}/>}
  <Card title="Цены распивов" style={{marginBottom:22}}>
   <Table rowKey="ml" loading={loading} dataSource={displayRows} columns={columns} pagination={false} scroll={{x:900}} expandable={{rowExpandable:r=>r.ml!==1&&r.cost!=null,expandedRowRender:r=><Descriptions size="small" column={{xs:1,sm:2,md:3}} items={[
    {key:'liquid',label:'Парфюм',children:rub(r.parts.liquid)},{key:'atom',label:'Атомайзер без доставки',children:rub(r.parts.atom)},{key:'delivery',label:'Доставка атомайзера',children:rub(r.parts.atom_delivery)},{key:'label',label:'Этикетка',children:rub(r.parts.label)},{key:'pack',label:'Упаковка с этикеткой, после округления',children:rub(r.packaging)},{key:'work',label:'Работа',children:rub(r.parts.work)}]}/>}}/>
   <div className="cost-help" style={{marginTop:16}}>Расчётная цена = себестоимость готового распива × коэффициент, затем округление вверх. Флакон, доставка, этикетка и работа уже включены в себестоимость. Для её состава нажмите «+».</div>
   <p className="cost-help">* 1 мл — отдельный ориентир без пустого флакона, его доставки и этикетки. Это не складская карточка. Если «Ваша цена» не заполнена, прогноз считается по расчётной цене.</p>
  </Card>
  <h2 className="cost-step">Прибыль и скидки</h2>
  <Card title="Прибыль по объёмам" style={{marginBottom:22}} extra={<Checkbox checked={detail} onChange={e=>setDetail(e.target.checked)}>Подробные показатели</Checkbox>}>
   <Table rowKey="ml" loading={loading} dataSource={displayRows} columns={profitColumns} pagination={false} scroll={{x:detail?1460:1120}}/>
   <p className="cost-help" style={{marginTop:16}}>Предварительные показатели без скидки. Используется «Ваша цена», а если она не заполнена — расчётная. Валовая прибыль = цена − себестоимость. Наценка = валовая прибыль ÷ себестоимость × 100%. Валовая маржа = валовая прибыль ÷ цена × 100%. Остаток после расходов = цена × (1 − доля расходов) − себестоимость. Это не чистая прибыль бизнеса.</p>
  </Card>
  <Card title="Скидка и остаток с продажи" style={{marginBottom:22}}>
   <div className="cost-fields two">
    <label className="cost-field"><span>Распив для проверки</span><Select aria-label="Распив для проверки скидки" value={discountMl} options={discountOptions} onChange={discount_ml=>change({discount_ml})}/></label>
    {discountMl&&numeric(`Минимальный остаток с продажи ${discountMl} мл, ₽`,data.rows[discountMl]?.target_remaining??null,target_remaining=>rowChange(discountMl,'target_remaining',target_remaining),{placeholder:'Укажите сумму, можно 0'})}
   </div>
   <p className="cost-help">{analysis?.base_price!=null?`Базовая цена: ${rub(analysis.base_price)} — ${analysis.base_source==='manual'?'из поля «Ваша цена»':'расчётная цена, поскольку «Ваша цена» не заполнена'}. `:''}Минимальный остаток задаётся отдельно для каждого объёма и сохраняется с расчётом. Это деньги на постоянные расходы и прибыль бизнеса, а не чистая прибыль.</p>
   <div className="cost-summary">
    <Card size="small"><Statistic title="Остаётся при базовой цене" value={analysis?.base_remaining??'—'} formatter={rub}/></Card>
    <Card size="small"><Statistic title="Допустимая скидка" value={analysis?.max_discount??'—'} formatter={v=>v==='—'?'—':num(v)+'%'}/><div className="cost-help">С сохранением заданного остатка</div></Card>
    <Card size="small"><Statistic title="Цена при допустимой скидке" value={analysis?.price_at_max??'—'} formatter={rub}/><div className="cost-help">Останется: {rub(analysis?.remaining_at_max)}</div></Card>
   </div>
   {analysis?.target==null?<Alert type="info" showIcon title="Укажите минимальный остаток, чтобы узнать допустимую скидку."/>:analysis?.minimum_price!=null&&analysis.base_price!=null&&Number(analysis.base_price)<Number(analysis.minimum_price)?<Alert type="warning" showIcon title={`Уже при базовой цене заданный остаток не достигается. Нужна цена не ниже ${rub(analysis.minimum_price)}.`}/>:null}
   {discountMl&&<div style={{marginTop:18,maxWidth:350}}>{numeric(`Проверить скидку для ${discountMl} мл, %`,data.rows[discountMl]?.check_discount??0,check_discount=>rowChange(discountMl,'check_discount',check_discount),{max:100})}</div>}
   <Table size="small" rowKey="key" loading={loading} pagination={false} scroll={{x:780}} dataSource={analysis?[{key:'base',name:'Без скидки',price:analysis.base_price,gross:analysis.base_price!=null&&discountRow.cost!=null?Number(analysis.base_price)-Number(discountRow.cost):null,margin:analysis.base_price!=null&&Number(analysis.base_price)>0&&discountRow.cost!=null?(Number(analysis.base_price)-Number(discountRow.cost))/Number(analysis.base_price)*100:null,remaining:analysis.base_remaining},{key:'discount',name:`Со скидкой ${num(analysis.check_discount)}%`,price:analysis.check_price,gross:analysis.check_gross,margin:analysis.check_margin,remaining:analysis.check_remaining}]:[]} columns={[
    {title:'Вариант',dataIndex:'name',width:160},
    {title:'Покупатель платит',dataIndex:'price',render:rub,width:160},
    {title:'Валовая прибыль',dataIndex:'gross',render:rub,width:150},
    {title:'Валовая маржа',dataIndex:'margin',render:v=>v==null?'—':num(v)+'%',width:145},
    {title:'Остаток после расходов',dataIndex:'remaining',render:v=><strong className={v!=null&&Number(v)<0?'negative':''}>{rub(v)}</strong>,width:180},
   ]}/>
   {discountStatus==='below_target'&&<Alert style={{marginTop:16}} type="warning" showIcon title="При этой скидке остаток ниже заданного минимума."/>}
   {discountStatus==='meets_target'&&<Alert style={{marginTop:16}} type="success" showIcon title="При этой скидке заданный минимальный остаток сохраняется."/>}
   <p className="cost-help" style={{marginTop:16}}>Проценты расходов начисляются на цену после скидки. Минимальная цена = (себестоимость + заданный остаток) ÷ (1 − доля расходов). Допустимая скидка округляется вниз до 0,01%, цена покупателя — до копеек. Аренда и другие постоянные расходы отдельно не вычитаются.</p>
  </Card>
  <p className="cost-help">Это предварительная калькуляция: сохранение расчёта не создаёт закупку, производство или движение товара. Расчёты сохраняются отдельно от складского учёта.</p>
 </>;
}
