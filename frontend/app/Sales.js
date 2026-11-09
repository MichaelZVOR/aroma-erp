'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {useLegacyDiscard,useLegacyNavigationLock} from './NavigationLock';
import {Alert,App,Button,Card,Descriptions,Empty,Form,Image,Input,InputNumber,Modal,Select,Space,Spin,Table,Tabs,Tag,Typography} from 'antd';

const groups={bottle:'Полноразмерные флаконы',decant:'Распив',atom:'Атомайзеры',other:'Прочие товары'};
const n=v=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(v));
const money=v=>v==null?'—':n(v/100)+' ₽';
const percent=v=>v==null?'—':n(v)+'%';
const today=()=>new Date().toLocaleDateString('sv-SE');
const fresh=()=>({date:today(),payment:'cash',rate:null,note:'',items:[],request_key:crypto.randomUUID()});
const paymentName=v=>({cash:'Наличные',card:'Карта',mixed:'Наличные и карта'}[v]||'—');
const payload=d=>({...(d.document_id?{document_id:d.document_id,revision:d.revision}:{}),items:d.items.map(x=>({id:x.id,line_id:x.line_id,qty:x.qty,price:x.price,payment:x.payment,rate:x.rate,...(Object.hasOwn(x,'cost_override')?{cost_override:x.cost_override}:{}),...(Object.hasOwn(x,'list_price_override')?{list_price_override:x.list_price_override}:{})}))});
const sumRows=rows=>{const total=Object.fromEntries(['base','revenue','discount','cost','gross','fee','remaining'].map(k=>[k,rows.reduce((a,r)=>a+r[k],0)]));return {...total,cash:rows.filter(r=>r.payment==='cash').reduce((a,r)=>a+r.revenue,0),card:rows.filter(r=>r.payment==='card').reduce((a,r)=>a+r.revenue,0),margin:total.revenue?total.gross/total.revenue*100:null,markup:total.cost?total.gross/total.cost*100:null};};
const financialColumns=[
 {title:'Выручка',dataIndex:'revenue',render:money},{title:'Скидка',dataIndex:'discount',render:money},
 {title:'Себестоимость',dataIndex:'cost',render:money},{title:'Валовая прибыль',dataIndex:'gross',render:money},
 {title:'Наценка',dataIndex:'markup',render:percent},{title:'Валовая маржа',dataIndex:'margin',render:percent},
 {title:'Эквайринг',dataIndex:'fee',render:money},{title:'После эквайринга',dataIndex:'remaining',render:money},
];
function Summary({value}){
 return <Descriptions bordered size="small" column={{xs:1,sm:2,lg:4}} items={[...financialColumns.map(c=>({key:c.dataIndex,label:c.title,children:c.render(value?.[c.dataIndex])})),{key:'cash',label:'Наличными',children:money(value?.cash)},{key:'card',label:'Картой',children:money(value?.card)}]}/>;
}
function exportCSV(docs){
 const headers=['Документ','Дата','Статус','Товар','Группа','Количество','Цена до скидки, ₽','Фактическая цена, ₽','Скидка, ₽','Выручка, ₽','Себестоимость, ₽','Валовая прибыль, ₽','Наценка, %','Валовая маржа, %','Эквайринг, ₽','После эквайринга, ₽','Оплата','Тариф, %','Источник себестоимости','Примечание'];
 const rows=docs.flatMap(d=>d.payload.rows.map(r=>[d.id,d.date,d.status==='posted'?'Сохранён':'Аннулирован',r.name,groups[r.group_name],r.qty,...['list_price','price','discount','revenue','cost','gross'].map(k=>r[k]/100),r.markup,r.margin,r.fee/100,r.remaining/100,paymentName(r.payment),r.rate,r.cost_source==='csv'?'Из CSV, предварительная':'Введена вручную',d.note]));
 const escape=v=>{let s=String(v??'');if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const blob=new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(escape).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Продажи-Арома.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function Sales({s}){
 const {message}=App.useApp();
 const [data,setData]=useState(null),[tab,setTab]=useState('new'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState(null),[preview,setPreview]=useState(null),[calcError,setCalcError]=useState('');
 const [group,setGroup]=useState('decant'),[selected,setSelected]=useState(null),[search,setSearch]=useState('');
 const [edit,setEdit]=useState(null),[form]=Form.useForm(),[view,setView]=useState(null),[voidDoc,setVoidDoc]=useState(null),[reason,setReason]=useState('');
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[filterPayment,setFilterPayment]=useState('all'),[status,setStatus]=useState('posted');
 const [historyItems,setHistoryItems]=useState([]),[historyDoc,setHistoryDoc]=useState(null),[historyBusy,setHistoryBusy]=useState(false);
 const inFlight=useRef(false),seq=useRef(0),pendingSave=useRef(null);
 const api=useCallback(async(path,body)=>{
  const response=await fetch('/api/sales/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Aroma-Token':s.token},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Ошибка сохранения');return result;
 },[s.token]);
 const load=useCallback(async()=>{const next=await api('state');setData(next);return next;},[api]);
 useEffect(()=>{load().catch(e=>setError(e.message));
  let initial;try{initial=JSON.parse(localStorage.getItem('aroma.sales.draft')||'null');}catch{}
  setDraft(initial&&Array.isArray(initial.items)&&initial.request_key?{...initial,items:initial.items.map(x=>({...x,line_id:x.line_id||crypto.randomUUID(),payment:x.payment||initial.payment||'cash',rate:x.rate??initial.rate??null}))}:fresh());
 },[load]);
 const [editDirty,setEditDirty]=useState(false);
 const confirmDiscard=useLegacyDiscard();
 const draftDirty=!!(draft?.items.length||draft?.note||draft?.reason||draft?.document_id);
 const voidDirty=!!voidDoc&&!!reason.trim();
 useLegacyNavigationLock('legacy-sale', draftDirty);
 const releaseCard=useLegacyNavigationLock('legacy-sale-card', edit!==null&&editDirty);
 const releaseVoid=useLegacyNavigationLock('legacy-sale-void', voidDirty);
 const closeCard=()=>{releaseCard();setEdit(null);};
 const closeVoid=()=>{releaseVoid();setVoidDoc(null);};
 useEffect(()=>{if(draft)try{localStorage.setItem('aroma.sales.draft',JSON.stringify(draft));}catch{}},[draft]);
 const signature=JSON.stringify(draft&&payload(draft));
 useEffect(()=>{
  const id=++seq.current;setPreview(null);setCalcError('');
  if(!draft?.items.length)return;
  const timer=setTimeout(()=>api('quote',payload(draft)).then(v=>{if(id===seq.current)setPreview(v);}).catch(e=>{if(id===seq.current)setCalcError(e.message);}),200);
  return()=>clearTimeout(timer);
 },[signature,api,data]);
 const change=(key,value)=>{if(inFlight.current)return;setDraft(d=>({...d,[key]:value}));pendingSave.current=null;};
 const rowChange=(index,key,value)=>change('items',draft.items.map((r,i)=>i===index?{...r,[key]:value}:r));
 const rowUpdate=(index,updates)=>change('items',draft.items.map((r,i)=>i===index?{...r,...updates}:r));
 const catalog=data?.catalog||[];
 const product=id=>catalog.find(p=>p.id===id);
 const rowProduct=r=>r.snapshot?{...r.snapshot,cost:Object.hasOwn(r,'cost_override')?r.cost_override==null?null:Math.round(r.cost_override*100):r.snapshot.cost,price:Object.hasOwn(r,'list_price_override')?r.list_price_override==null?null:Math.round(r.list_price_override*100):r.snapshot.price}:product(r.id);
 const source=p=>s.products.find(x=>x.id===p?.source_id);
 const filtered=catalog.filter(p=>p.group_name===group&&[p.name,source(p)?.code].join(' ').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru').trim()));
 const editCard=p=>{setEditDirty(false);setEdit(p||{});form.setFieldsValue({id:p?.id,name:p?.name||'',group_name:p?.group_name||group,cost:p?.cost==null?null:p.cost/100,price:p?.price==null?null:p.price/100});};
 const saveCard=async values=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);try{await api('catalog',values);await load();closeCard();message.success('Карточка продаж сохранена');}catch(e){message.error(e.message);}finally{inFlight.current=false;setBusy(false);}};
 const save=async()=>{
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try{
   if(!draft.date)throw Error('Укажите дату продажи');
   let body=pendingSave.current;
   if(draft.document_id&&!draft.reason?.trim())throw Error('Укажите причину исправления');
   if(!body){const expected=await api('quote',payload(draft));setPreview(expected);body={...payload(draft),date:draft.date,note:draft.note,reason:draft.reason,request_key:draft.request_key,expected};pendingSave.current=body;}
   const saved=await api(draft.document_id?'update':'save',body);const next=await load();
   setView(next.documents.find(d=>d.id===saved.id));setTab('journal');setDraft({...fresh(),rate:next.card_rate==null?null:Number(next.card_rate)});pendingSave.current=null;message.success('Продажа № '+saved.id+' сохранена');
  }catch(e){setError(e.message);}finally{inFlight.current=false;setBusy(false);}
 };
 const beginCorrection=doc=>{
  if(inFlight.current)return;
  if(draft.items.length){if(draft.document_id===doc.id){setView(null);setTab('new');return;}message.warning('Сначала сохраните текущий документ или очистите его черновик.');return;}
  setDraft({...fresh(),document_id:doc.id,revision:doc.revision,date:doc.date,note:doc.note,payment:'cash',rate:data.card_rate==null?null:Number(data.card_rate),reason:'',items:doc.payload.rows.map(r=>({id:r.id,line_id:r.line_id,qty:r.qty,price:r.price/100,payment:r.payment,rate:Number(r.rate),snapshot:{id:r.id,name:r.name,cost:r.unit_cost,price:r.list_price,group_name:r.group_name,cost_source:r.cost_source}}))});pendingSave.current=null;setView(null);setTab('new');
 };
 const openHistory=async doc=>{setHistoryDoc(doc);setHistoryBusy(true);try{setHistoryItems((await api('history',{id:doc.id})).history);}catch(e){message.error(e.message);}finally{setHistoryBusy(false);}};
 const downloadDoc=async(doc,format)=>{try{const r=await fetch('/api/sales/export',{method:'POST',headers:{'Content-Type':'application/json','X-Aroma-Token':s.token},body:JSON.stringify({id:doc.id,revision:doc.revision,format})});if(!r.ok){const e=await r.json();throw Error(e.error||'Не удалось выгрузить документ');}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Продажи-'+doc.date+'-№'+doc.id+'-версия-'+doc.revision+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message.error(e.message);}};
 const docs=(data?.documents||[]).filter(d=>(!from||d.date>=from)&&(!to||d.date<=to)&&(status==='all'||d.status===status)).map(d=>{const rows=d.payload.rows.filter(r=>filterPayment==='all'||r.payment===filterPayment);return {...d,payload:{...d.payload,rows,totals:filterPayment==='all'?d.payload.totals:sumRows(rows)}};}).filter(d=>d.payload.rows.length);
 const active=docs.filter(d=>d.status==='posted');
 const totals=sumRows(active.flatMap(d=>d.payload.rows));
 const pagination={defaultPageSize:25,pageSizeOptions:[10,25,50,100],showSizeChanger:true,showTotal:t=>'Всего '+t};
 const rowColumns=[{title:'Товар',dataIndex:'name',width:280},{title:'Кол-во',dataIndex:'qty'},{title:'Оплата',dataIndex:'payment',render:paymentName},{title:'Тариф, %',dataIndex:'rate',render:percent},...financialColumns];
 const documentColumns=[{title:'Документ',dataIndex:'id',render:(id,d)=><Button type="link" onClick={()=>setView(data.documents.find(x=>x.id===id))}>Продажа № {id}</Button>},{title:'Дата',dataIndex:'date'},{title:'Версия',dataIndex:'revision'},{title:'Статус',dataIndex:'status',render:v=><Tag color={v==='posted'?'green':'default'}>{v==='posted'?'Сохранён':'Аннулирован'}</Tag>},{title:'Оплата',dataIndex:'payment',render:paymentName},...financialColumns.map(c=>({...c,render:(_,d)=>c.render(d.payload.totals[c.dataIndex])}))];
 const draftColumns=[
  {title:'Товар',width:250,fixed:'left',render:(_,r)=><><strong>{rowProduct(r)?.name||'Товар недоступен'}</strong><div><Tag>{groups[rowProduct(r)?.group_name]}</Tag>{rowProduct(r)?.cost_source==='csv'&&<Tag>Себестоимость из CSV</Tag>}</div></>},
  {title:'Кол-во',width:100,render:(_,r,i)=><InputNumber aria-label={'Количество '+(i+1)} min={1} max={100000} precision={0} value={r.qty} onChange={v=>rowChange(i,'qty',v)}/>},
  {title:'Оплата',width:145,render:(_,r,i)=><Select aria-label={'Оплата позиции '+(i+1)} style={{display:'flex',flexDirection:'row-reverse',gap:10,width:130}} value={r.payment} onChange={v=>rowUpdate(i,{payment:v,rate:v==='card'&&r.payment!=='card'?(draft.rate??(data.card_rate==null?null:Number(data.card_rate))):r.rate})} options={[{value:'cash',label:'Наличные'},{value:'card',label:'Карта'}]}/>},
  {title:'Эквайринг, %',width:125,render:(_,r,i)=>r.payment==='card'?<InputNumber aria-label={'Эквайринг позиции '+(i+1)} min={0} max={99.99} precision={2} value={r.rate} placeholder="Тариф" onChange={v=>rowChange(i,'rate',v)}/>:<span>—</span>},
  {title:'Себестоимость / шт.',width:150,render:(_,r,i)=>draft.document_id&&r.snapshot?<InputNumber aria-label={'Исправленная себестоимость '+(i+1)} min={0} precision={2} value={rowProduct(r)?.cost==null?null:rowProduct(r).cost/100} onChange={v=>rowChange(i,'cost_override',v)}/>:money(rowProduct(r)?.cost)},
  {title:'Цена до скидки / шт.',width:150,render:(_,r,i)=>draft.document_id&&r.snapshot?<InputNumber aria-label={'Исправленная цена до скидки '+(i+1)} min={0} precision={2} value={rowProduct(r)?.price==null?null:rowProduct(r).price/100} onChange={v=>rowChange(i,'list_price_override',v)}/>:money(rowProduct(r)?.price)},
  {title:'Скидка, %',width:120,render:(_,r,i)=>{const base=rowProduct(r)?.price;return <InputNumber aria-label={'Скидка '+(i+1)} min={0} max={100} precision={2} value={base>0&&r.price!=null?Number(((base-r.price*100)/base*100).toFixed(2)):0} onChange={v=>rowChange(i,'price',v==null?null:Math.round(base*(1-v/100))/100)}/>;}},
  {title:'Цена покупателю / шт., ₽',width:160,render:(_,r,i)=><InputNumber aria-label={'Фактическая цена '+(i+1)} min={0} precision={2} value={r.price} onChange={v=>rowChange(i,'price',v)}/>},
  {title:'К оплате',render:(_,r,i)=>money(preview?.rows[i]?.revenue)},
  {title:'',render:(_,r,i)=><Button danger aria-label={'Удалить позицию '+(i+1)} onClick={()=>change('items',draft.items.filter((_,j)=>i!==j))}>Убрать</Button>},
 ];
 if(!data||!draft)return <><Typography.Title level={2}>Продажи</Typography.Title>{error?<Alert type="error" title={error} action={<Button onClick={()=>load().catch(e=>setError(e.message))}>Повторить</Button>}/>:<Spin/>}</>;
 return <div>
  <div className="page-heading"><div><h1>Продажи</h1><p>Документы продаж и финансовый результат. Складские остатки не списываются.</p></div><Button disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Обновить продажи</Button></div>
  {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
  <Tabs activeKey={tab} onChange={value=>{if(!busy)setTab(value);}} items={[{key:'new',label:'Новая продажа'},{key:'journal',label:'Журнал и итоги'},{key:'catalog',label:'База товаров'}]}/>
  {tab==='new'&&<Space orientation="vertical" size={20} style={{width:'100%'}}>
   {draft.document_id&&<Alert type="info" showIcon title={'Исправление документа № '+draft.document_id+', версия '+draft.revision} description="Исходные значения сохранятся в истории. Себестоимость и цена до скидки взяты из документа; их можно исправить явно, не меняя базу товаров."/>}
   <Card title="Документ продаж за день"><Space wrap align="end">
    <label style={{display:'block',width:220}}>Дата продажи<Input size="large" style={{display:'block',width:220,height:40,marginTop:6}} aria-label="Дата продажи" type="date" value={draft.date} onChange={e=>change('date',e.target.value)}/></label>
    <label style={{display:'block',width:220}}>Оплата новых позиций<Select size="large" aria-label="Способ оплаты новых позиций" style={{display:'flex',flexDirection:'row-reverse',gap:10,width:220,height:40,marginTop:6}} value={draft.payment} onChange={v=>{if(inFlight.current)return;setDraft(d=>({...d,payment:v,rate:d.rate??(data.card_rate==null?null:Number(data.card_rate))}));pendingSave.current=null;}} options={[{value:'cash',label:'Наличные'},{value:'card',label:'Карта'}]}/></label>
    {draft.payment==='card'&&<label>Тариф новых позиций, %<InputNumber size="large" aria-label="Тариф эквайринга" style={{display:'block',height:40,marginTop:6}} min={0} max={99.99} precision={2} placeholder="Тариф банка" value={draft.rate} onChange={v=>change('rate',v)}/></label>}
   </Space><p className="help-text">Оплата сверху применяется только к новым позициям. В каждой строке свой способ оплаты; в одном документе можно записать весь день — и наличные, и карту.</p><Input.TextArea aria-label="Примечание к продаже" placeholder="Примечание (необязательно)" maxLength={1500} rows={2} value={draft.note} onChange={e=>change('note',e.target.value)} style={{marginTop:16}}/>{draft.document_id&&<Input.TextArea aria-label="Причина исправления" placeholder="Причина исправления (обязательно)" maxLength={500} rows={2} value={draft.reason} onChange={e=>change('reason',e.target.value)} style={{marginTop:12}}/>}</Card>
   <Card title="Проданные товары"><Space wrap style={{marginBottom:16,width:'100%'}}>
    <Select aria-label="База для выбора товара" value={group} style={{width:230}} onChange={v=>{setGroup(v);setSelected(null);}} options={Object.entries(groups).map(([value,label])=>({value,label}))}/>
    <Select showSearch optionFilterProp="label" aria-label="Выбрать проданный товар" placeholder="Найти товар по названию" style={{width:420,maxWidth:'100%'}} value={selected} onChange={setSelected} options={catalog.filter(p=>p.group_name===group).map(p=>({value:p.id,label:p.name+(p.cost==null||p.price==null?' — заполните цену и себестоимость':''),disabled:p.cost==null||p.price==null}))}/>
    <Button type="primary" disabled={!selected} onClick={()=>{const p=product(selected);change('items',[...draft.items,{id:p.id,line_id:crypto.randomUUID(),qty:1,price:p.price/100,payment:draft.payment,rate:draft.rate??(data.card_rate==null?null:Number(data.card_rate))}]);setSelected(null);}}>Добавить товар</Button>
   </Space><p className="help-text">Если товар недоступен для выбора, заполните его цену и себестоимость во вкладке «База товаров».</p>
   <Table rowKey="line_id" columns={draftColumns} dataSource={draft.items} pagination={false} scroll={{x:1750}} locale={{emptyText:'Выберите проданные позиции из базы'}}/>
   </Card>
   {calcError&&<Alert type="warning" showIcon title={calcError}/>}
   {preview&&<Card title="Результат продажи"><Summary value={preview.totals}/><Table style={{marginTop:20}} rowKey={(_,i)=>i} columns={rowColumns} dataSource={preview.rows} pagination={false} scroll={{x:1500}}/>
    {preview.rows.some(r=>r.cost_source==='csv')&&<Alert style={{marginTop:16}} type="warning" showIcon title="Предварительная себестоимость из CSV" description="Закупочные значения сохранены из вашего файла. Пока они условные, прибыль и маржа тоже предварительные. Уточните себестоимость в базе перед сохранением, если нужны точные результаты."/>}
    <p className="help-text">Вычитается только эквайринг по выбранной оплате. Комиссия продавцу, реклама и общие 20% не начисляются. Остаток после эквайринга не является чистой прибылью.</p>
   </Card>}
   <Space><Button size="large" type="primary" loading={busy} disabled={!preview||!!calcError} onClick={save}>{draft.document_id?'Сохранить исправление':'Сохранить документ'}</Button><Button disabled={busy||!draft.items.length} onClick={()=>confirmDiscard(draftDirty,()=>{setDraft({...fresh(),rate:draft.rate});pendingSave.current=null;})}>{draft.document_id?'Отменить исправление':'Очистить черновик'}</Button></Space>
  </Space>}
  {tab==='catalog'&&<Card title="Товары для ручного учёта продаж" extra={<Button onClick={()=>editCard(null)}>Добавить позицию</Button>}>
   <Alert type="info" showIcon title="Полноразмерные флаконы и распив хранятся отдельными списками" description="Цены для продаж редактируются здесь. Изменения не затрагивают калькулятор, складские документы и ранее сохранённые продажи." style={{marginBottom:16}}/>
   <Space wrap style={{marginBottom:16}}><Select aria-label="Группа базы товаров" value={group} onChange={setGroup} style={{width:240}} options={Object.entries(groups).map(([value,label])=>({value,label}))}/><Input.Search aria-label="Поиск в базе продаж" value={search} allowClear placeholder="Название или код" onChange={e=>setSearch(e.target.value)} style={{width:320}}/></Space>
   <Table rowKey="id" dataSource={filtered} pagination={pagination} scroll={{x:950}} columns={[
    {title:'Фото',width:75,render:(_,p)=>source(p)?.image?<Image width={42} height={54} style={{objectFit:'contain'}} src={source(p).image} alt={p.name}/>:<span>—</span>},
    {title:'Товар',dataIndex:'name'},{title:'Себестоимость / шт.',dataIndex:'cost',render:(v,p)=><>{money(v)}{p.cost_source==='csv'&&<div><Tag>Из CSV, предварительная</Tag></div>}</>},
    {title:'Цена продажи / шт.',dataIndex:'price',render:money},{title:'',render:(_,p)=><Button onClick={()=>editCard(p)}>Изменить</Button>},
   ]}/>
  </Card>}
  {tab==='journal'&&<Space orientation="vertical" size={20} style={{width:'100%'}}><Card title="Итоги сохранённых продаж за выбранный период">
   <Space wrap style={{marginBottom:20}}><label>С даты<Input aria-label="Продажи с даты" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>По дату<Input aria-label="Продажи по дату" type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label>
    <Select aria-label="Фильтр оплаты" value={filterPayment} onChange={setFilterPayment} options={[{value:'all',label:'Любая оплата'},{value:'cash',label:'Наличные'},{value:'card',label:'Карта'}]}/>
    <Select aria-label="Статус продаж" value={status} onChange={setStatus} style={{width:180}} options={[{value:'posted',label:'Сохранённые'},{value:'void',label:'Аннулированные'},{value:'all',label:'Все документы'}]}/>
    <Button onClick={()=>exportCSV(docs)} disabled={!docs.length}>Выгрузить CSV</Button>
   </Space><p>Документов: {active.length}. Итоги считаются по отобранным строкам; фильтр оплаты не включает другие строки смешанного документа. Аннулированные документы в финансовые итоги не входят.</p><Summary value={totals}/>
   {active.some(d=>d.payload.rows.some(r=>r.cost_source==='csv'))&&<Alert style={{marginTop:16}} type="warning" title="В итогах есть продажи с предварительной себестоимостью из CSV"/>}
  </Card><Card title="Журнал продаж"><Table rowKey="id" dataSource={docs} columns={documentColumns} pagination={pagination} scroll={{x:1800}} locale={{emptyText:<Empty description="Продажи ещё не внесены"/>}}/></Card></Space>}
  <Modal title={edit?.id?'Карточка для продаж':'Новая позиция для продаж'} open={edit!==null} maskClosable={false} keyboard={false} onCancel={()=>!busy&&confirmDiscard(editDirty,closeCard,true)} onOk={()=>form.submit()} okText="Сохранить" cancelButtonProps={{style:{display:"none"}}} confirmLoading={busy} destroyOnHidden>
   <Form form={form} layout="vertical" onFinish={saveCard} onValuesChange={()=>setEditDirty(true)} disabled={busy}><Form.Item name="id" hidden><Input/></Form.Item><Form.Item name="group_name" label="Группа" rules={[{required:true}]}><Select options={Object.entries(groups).map(([value,label])=>({value,label}))}/></Form.Item><Form.Item name="name" label="Название с объёмом" rules={[{required:true,max:300}]}><Input/></Form.Item><Form.Item name="cost" label="Полная себестоимость одной штуки, ₽"><InputNumber aria-label="Себестоимость товара для продаж" min={0} precision={2} style={{width:'100%'}} placeholder="Заполнить позже"/></Form.Item><Form.Item name="price" label="Установленная цена продажи одной штуки, ₽"><InputNumber aria-label="Цена товара для продаж" min={0} precision={2} style={{width:'100%'}} placeholder="Заполнить позже"/></Form.Item><p>Пустое поле означает, что значение пока неизвестно. Ноль — явно заданная нулевая стоимость.</p></Form>
  </Modal>
  <Modal title={'Документ № '+(view?.id||'')+' · версия '+(view?.revision||1)} open={!!view} onCancel={()=>setView(null)} width={1250} footer={view&&<Space wrap><Button onClick={()=>downloadDoc(view,'xlsx')}>Скачать Excel</Button><Button onClick={()=>downloadDoc(view,'docx')}>Скачать DOCX</Button><Button onClick={()=>openHistory(view)}>История изменений</Button>{view.status==='posted'&&!view.historical&&<><Button type="primary" onClick={()=>beginCorrection(view)}>Исправить документ</Button><Button danger onClick={()=>{setVoidDoc(view);setReason('');}}>Аннулировать</Button></>}<Button onClick={()=>setView(null)}>Закрыть</Button></Space>}>
   {view&&<><p>{view.date} · {paymentName(view.payment)} · {view.status==='posted'?'Сохранён':'Аннулирован'}{view.historical?' · Архивная версия':''}</p>{view.note&&<p>{view.note}</p>}{view.status==='void'&&<Alert type="warning" title={'Причина аннулирования: '+view.void_reason} description={view.void_at}/>}<Summary value={view.payload.totals}/><Table style={{marginTop:20}} rowKey="line_id" columns={rowColumns} dataSource={view.payload.rows} pagination={false} scroll={{x:1750}}/><p>Цены, себестоимость и оплата зафиксированы по строкам. Исправления сохраняют предыдущие версии. DOCX можно открыть в Word или загрузить в Google Документы.</p></>}
  </Modal>
  <Modal title={'История документа № '+(historyDoc?.id||'')} open={!!historyDoc} onCancel={()=>setHistoryDoc(null)} footer={<Button onClick={()=>setHistoryDoc(null)}>Закрыть</Button>} width={900}><Table rowKey="revision" loading={historyBusy} dataSource={historyItems} pagination={false} columns={[{title:'Версия',dataIndex:'revision'},{title:'Изменено',dataIndex:'changed_at',render:v=>new Date(v).toLocaleString('ru-RU')},{title:'Причина',dataIndex:'reason'},{title:'',render:(_,r)=><Button onClick={()=>{const current=data.documents.find(d=>d.id===historyDoc.id);setView({...r.document,historical:r.revision!==current?.revision});setHistoryDoc(null);}}>Открыть версию</Button>}]}/></Modal>
  <Modal open={!!voidDoc} maskClosable={false} keyboard={false} title="Аннулирование ошибочной записи" onCancel={()=>!busy&&confirmDiscard(voidDirty,closeVoid)} okText="Аннулировать" cancelText="Оставить" okButtonProps={{danger:true,disabled:!reason.trim()}} confirmLoading={busy} onOk={async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);try{await api('void',{id:voidDoc.id,revision:voidDoc.revision,reason});const next=await load();setView(next.documents.find(d=>d.id===voidDoc.id));closeVoid();message.success('Документ аннулирован, история сохранена');}catch(e){message.error(e.message);}finally{inFlight.current=false;setBusy(false);}}}>
   <p>Документ останется в журнале, но перестанет участвовать в итогах. Складские остатки не изменятся.</p><Input.TextArea aria-label="Причина аннулирования" rows={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Укажите причину"/>
  </Modal>
 </div>;
}
