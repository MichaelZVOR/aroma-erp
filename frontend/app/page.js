'use client';

import CostCalculator from './CostCalculator';
import Sales from './Sales';
import Competitors from './Competitors';
import WarehouseSetup from './WarehouseSetup';
import ProductCardFields from './ProductCardFields';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, ConfigProvider, Descriptions, Divider,
  Empty, Form, Image, Input, InputNumber, Layout, Menu, Modal, Select,
  Space, Spin, Statistic, Table, Tabs, Tag, Typography,
} from 'antd';
import ruRU from 'antd/locale/ru_RU';
import {
  AppstoreOutlined, DatabaseOutlined, ExperimentOutlined, FileTextOutlined,
  HomeOutlined, ImportOutlined, ReloadOutlined, SaveOutlined, SettingOutlined,
  ShoppingOutlined, CalculatorOutlined, PlusOutlined,
} from '@ant-design/icons';

const K = { bottle:'Полноразмерные флаконы', liquid:'Парфюм в мл', decant:'Готовые распивы', atom:'Атомайзеры', label:'Наклейки', other:'Прочие материалы' };
const DK = { receipt:'Поступление', open:'Открытие на распив', production:'Производство', writeoff:'Списание', reversal:'Отмена' };
const volumes = [1,2,3,5,10];
const rub = v => v == null ? '—' : new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(v));
const money = v => v == null ? '—' : rub(v/100);
const fmt = v => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(v);
const dt = v => new Date(v).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'});
const units = p => p?.kind === 'liquid' ? 'мл' : 'шт.';
const qty = (q,p) => fmt(p?.kind === 'liquid' ? q/1000 : q);
const cleanName = s => s.replace(/\s*[—–-]\s*ОБЪ[ЁЕ]М\s*$/i,'');
const searchMatch = (p,q) => [p.name,p.code,p.note].join(' ').toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru').trim());
const names = { goods:'Товары',warehouse:'Подготовка склада',competitors:'Цены конкурентов',sales:'Продажи',home:'Обзор',bottles:K.bottle,liquid:K.liquid,decants:K.decant,catalog:'Каталог товаров',receipts:'Закупки',stock:'Остатки',calc:'Калькулятор себестоимости',stockcalc:'Расчёт выпуска',production:'Производство',documents:'Документы',import:'Импорт CSV',settings:'Настройки' };
const navItem=(key,label)=>{const icons={home:HomeOutlined,sales:ShoppingOutlined,competitors:ShoppingOutlined,goods:DatabaseOutlined,bottles:ShoppingOutlined,liquid:ExperimentOutlined,decants:AppstoreOutlined,import:ImportOutlined,warehouse:SettingOutlined,receipts:ShoppingOutlined,stock:DatabaseOutlined,documents:FileTextOutlined,production:ExperimentOutlined,stockcalc:ExperimentOutlined,calc:CalculatorOutlined,settings:SettingOutlined};const Icon=icons[key];return {key,icon:<Icon/>,label:label||names[key]};};
const menuItems = [navItem('home'),navItem('sales'),
 navItem('goods'),
 {key:'warehouse-menu',icon:<DatabaseOutlined/>,label:'Склад',children:[navItem('warehouse'),navItem('stock'),navItem('receipts','Поступления'),navItem('documents')]},
 navItem('production'),navItem('stockcalc'),navItem('calc'),navItem('competitors'),navItem('settings'),
];

function download(data,name,type='text/csv;charset=utf-8') {
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csv(rows) {
  return '\ufeff'+rows.map(row=>row.map(value=>{
    let v=String(value??'');if(/^[=+@\-\t\r\n]/.test(v))v="'"+v;
    return '"'+v.replaceAll('"','""')+'"';
  }).join(';')).join('\r\n');
}
function Photo({p}) {
  return p.image?<span className="photo"><Image width={48} height={60} src={p.image} alt={cleanName(p.name)} loading="lazy"/></span>:<span className="photo-empty">Нет фото</span>;
}
function ProductName({p}) {
  return <div className="product-name">{cleanName(p.name)}<span className="secondary-text">{p.note||p.code}</span></div>;
}
function Heading({title,sub,children}) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{sub}</p></div>{children}</div>;
}

// Filtering happens before pagination. Search/category changes reset the page,
// while stock refreshes preserve it and clamp it to the remaining page count.
function PagedTable({rows,columns,resetKey='',rowKey='id',...props}) {
  const [current,setCurrent]=useState(1);
  const [pageSize,setPageSize]=useState(25);
  useEffect(()=>{try{const n=Number(localStorage.getItem('aroma.pageSize'));if([10,25,50,100].includes(n))setPageSize(n)}catch{}},[]);
  useEffect(()=>setCurrent(1),[resetKey]);
  const safeCurrent=Math.min(current,Math.max(1,Math.ceil(rows.length/pageSize)));
  const changeSize=size=>{setCurrent(1);setPageSize(size);try{localStorage.setItem('aroma.pageSize',String(size))}catch{}};
  return <><Space style={{marginBottom:8}}><Typography.Text type="secondary">Строк на странице</Typography.Text><Select aria-label="Строк на странице" value={pageSize} onChange={changeSize} options={[10,25,50,100].map(value=>({value,label:String(value)}))} style={{width:90}}/></Space><Table {...props} rowKey={rowKey} dataSource={rows} columns={columns} scroll={{x:'max-content'}}
    pagination={{
      current:safeCurrent,pageSize,total:rows.length,pageSizeOptions:[10,25,50,100],
      showSizeChanger:false,showQuickJumper:true,position:['topRight','bottomRight'],
      showTotal:(total,range)=>`${total?range[0]:0}–${range[1]} из ${total}`,
      onChange:(p,size)=>{setCurrent(size!==pageSize?1:p);setPageSize(size);try{localStorage.setItem('aroma.pageSize',String(size))}catch{}},
    }}/></>;
}

export default function Page() {
  return <ConfigProvider locale={ruRU} theme={{token:{colorPrimary:'#4664dc',borderRadius:8,fontFamily:'Arial, "Segoe UI", sans-serif',colorBgLayout:'#f4f6fa'},components:{Menu:{darkItemBg:'#1e2b40',darkItemSelectedBg:'#4664dc'},Table:{cellPaddingBlock:11}}}}>
    <App><ERP/></App>
  </ConfigProvider>;
}

function ERP() {
  const {message}=App.useApp();
  const [s,setS]=useState(null),[error,setError]=useState(''),[page,setPage]=useState('home'),[busy,setBusy]=useState(false);
  const [dialog,setDialog]=useState(null),[form]=Form.useForm();
  const pending=useRef(false);
  const products=s?.products||[],lots=s?.lots||[],docs=s?.documents||[];
  const product=id=>products.find(p=>p.id===id);
  const activeLots=kind=>lots.filter(l=>l.status==='active'&&l.remaining>0&&(!kind||product(l.product_id)?.kind===kind));
  const lotLabel=l=>`№ ${l.id} · ${cleanName(product(l.product_id)?.name||'')} · ${qty(l.remaining,product(l.product_id))} ${units(product(l.product_id))}`;
  const refresh=useCallback(async()=>{
    const response=await fetch('/api/state',{cache:'no-store'});
    if(!response.ok)throw Error('Не удалось открыть базу');
    const next=await response.json();if(!next.products||!next.settings)throw Error('Сервер вернул неподходящие данные');
    setS(next);setError('');return next;
  },[]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));const sync=()=>setPage(names[location.hash.slice(1)]?location.hash.slice(1):'home');sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync)},[refresh]);
  const go=p=>{location.hash=p;setPage(p)};
  const api=async(path,data)=>{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Aroma-Token':s.token},body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось сохранить');return result;
  };
  const show=(type,values={},extra={})=>{form.resetFields();form.setFieldsValue(values);setDialog({type,key:crypto.randomUUID(),...extra})};
  const editProduct=(p,kind='bottle')=>show('product',{kind:p?.kind||kind,code:p?.code||'',name:p?.name||'',capacity:p?.capacity?p.capacity/1000:null,sale:p?.sale==null?null:p.sale/100,note:p?.note||'',profile:{...(p?.profile||{}),purchase_price:p?.profile?.purchase_price==null?null:p.profile.purchase_price/100}},{product:p});
  const receive=(id)=>{const p=product(id);show('receipt',{product:id,qty:1,capacity:p?.capacity?p.capacity/1000:null,extra:0})};
  const openBottle=id=>{
    const available=activeLots('bottle');if(!available.length){message.info('Сначала внесите поступление полноразмерного флакона');return receive()}
    show('open',{lot:id||available[0].id,qty:1,loss:0});
  };
  const writeoff=id=>{
    const available=activeLots();if(!available.length)return message.info('Пока нет товара для списания');
    show('writeoff',{lot:id||available[0].id,qty:1,reason:'Пробник / тестер'});
  };
  const openDoc=id=>setDialog({type:'document',document:docs.find(d=>d.id===id)});
  const submit=async values=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);
    try{
      let payload={...values,key:dialog.key},path='/api/'+dialog.type;
      if(dialog.type==='product')payload={...values,id:dialog.product?.id||null,kind:dialog.product?.kind||values.kind,profile_revision:dialog.product?.profile?.revision||0};
      if(dialog.type==='reverse')payload.document=dialog.document.id;
      if(dialog.type==='produce')payload={...dialog.payload,...values,key:dialog.key,fingerprint:dialog.quote.fingerprint};
      const result=await api(path,payload);setDialog(null);
      message.success(dialog.type==='product'?'Карточка сохранена':`Документ № ${result.id} сохранён`);
      try{await refresh()}catch(e){setError('Операция сохранена, но экран не обновился. Нажмите «Обновить».')}
    }catch(e){message.error(e.message)}finally{setBusy(false);pending.current=false}
  };
  const backup=async()=>{
    try{const r=await fetch('/api/backup',{method:'POST',headers:{'X-Aroma-Token':s.token}});if(!r.ok)throw Error('Не удалось создать копию');
      download(await r.blob(),'Арома-база-'+new Date().toLocaleDateString('sv-SE')+'.sqlite3');message.success('Копия базы сохранена');
    }catch(e){message.error(e.message)}
  };
  const summaries=products.map(p=>{const ll=lots.filter(l=>l.status==='active'&&l.product_id===p.id&&l.remaining>0);return {...p,quantity:ll.reduce((a,l)=>a+l.remaining,0),cost:ll.reduce((a,l)=>a+l.remaining_cost,0),parties:ll.length}});
  const common={s,product,activeLots,lotLabel,api,refresh,message,go,receive,openBottle,writeoff,openDoc,editProduct,show};
  const docColumns=[
    {title:'Документ',key:'id',render:(_,d)=><><span className="code">№ {d.id}</span> <Tag>{DK[d.kind]}</Tag></>},
    {title:'Операция',dataIndex:'description',width:400},
    {title:'Дата',dataIndex:'date',render:dt},
    {title:'Статус',dataIndex:'status',render:v=><Tag color={v==='posted'?'green':'orange'}>{v==='posted'?'Проведён':'Отменён'}</Tag>},
    {title:'',key:'action',render:(_,d)=><Button onClick={()=>openDoc(d.id)}>Открыть</Button>},
  ];
  let content=null;
  if(s){
    if(['goods','bottles','liquid','decants','catalog','import'].includes(page))content=<Catalog key={page} {...common} page={page}/>;
    if(page==='warehouse')content=<WarehouseSetup s={s}/>;
    if(page==='stock')content=<Stock {...common} summaries={summaries}/>;
    if(page==='home')content=<>
      <Heading title="Рабочее место" sub="От закупки полного флакона до готового распива."><Button type="primary" icon={<PlusOutlined/>} onClick={()=>receive()}>Добавить закупку</Button></Heading>
      <div className="stat-grid">
        <Card><Statistic title="Стоимость запасов" value={summaries.reduce((a,p)=>a+p.cost,0)/100} precision={2} suffix="₽"/></Card>
        <Card><Statistic title="Парфюм для распива" value={summaries.filter(p=>p.kind==='liquid').reduce((a,p)=>a+p.quantity,0)/1000} suffix="мл"/></Card>
        <Card><Statistic title="Готовые распивы" value={summaries.filter(p=>p.kind==='decant').reduce((a,p)=>a+p.quantity,0)} suffix="шт."/></Card>
        <Card><Statistic title="Полноразмерные флаконы" value={products.filter(p=>p.kind==='bottle').length}/><Button type="link" onClick={()=>go('bottles')}>Открыть каталог</Button></Card>
      </div>
      <div className="home-grid"><Card title="Порядок работы">
        <div className="home-step"><h3>1. Внесите закупку</h3><p>Фактическое количество, объём, цена и доставка.</p><Button onClick={()=>receive()}>Добавить поступление</Button></div>
        <div className="home-step"><h3>2. Откройте флакон</h3><p>Штуки перейдут в миллилитры с сохранением стоимости.</p><Button onClick={()=>openBottle()}>Открыть на распив</Button></div>
        <div className="home-step"><h3>3. Подготовьте упаковку</h3><p>Внесите атомайзеры и наклейки в каталог и оформите их поступление.</p><Button onClick={()=>go('catalog')}>Каталог товаров</Button></div>
        <div className="home-step"><h3>4. Изготовьте распивы</h3><p>Выберите объём, посчитайте себестоимость и проведите выпуск.</p><Button onClick={()=>go('stockcalc')}>Открыть калькулятор</Button></div>
      </Card><Card title="Ваш каталог"><p>Полноразмерные флаконы, парфюм в миллилитрах и готовые распивы доступны в отдельных разделах.</p><Alert type="info" showIcon title="Остатки появляются после поступления" description="Карточка хранит название и код. Для учёта наличия внесите фактическую закупку."/><Divider/><Space wrap>{['bottles','liquid','decants'].map(p=><Button key={p} onClick={()=>go(p)}>{names[p]}</Button>)}</Space></Card></div>
      <Card title="Последние операции"><Table rowKey="id" dataSource={docs.slice(0,5)} columns={docColumns} pagination={false} scroll={{x:'max-content'}}/></Card>
    </>;
    if(page==='receipts')content=<><Heading title="Закупки и поступления" sub="Каждое поступление создаёт отдельную партию."><Button type="primary" onClick={()=>receive()}>Добавить поступление</Button></Heading><Card><PagedTable rows={docs.filter(d=>d.kind==='receipt')} columns={docColumns}/></Card></>;
    if(page==='documents')content=<Documents docs={docs} columns={docColumns}/>;
    if(page==='production')content=<><Heading title="Производство" sub="Состав и себестоимость сохраняются на дату выпуска."><Button type="primary" onClick={()=>go('stockcalc')}>Новый выпуск</Button></Heading><Card><PagedTable rows={docs.filter(d=>d.kind==='production')} columns={docColumns}/></Card></>;
    if(page==='competitors')content=<Competitors s={s}/>;
    if(page==='sales')content=<Sales s={s}/>;
    if(page==='calc')content=<CostCalculator {...common}/>;
    if(page==='stockcalc')content=<Calculator {...common}/>;
    if(page==='settings')content=<Settings key={JSON.stringify(s.settings)} {...common}/>;
  }
  const selectedProduct=product(Form.useWatch('product',form));
  const watchedLot=Form.useWatch('lot',form);
  const selectedLot=lots.find(l=>l.id===watchedLot);
  const openCount=Form.useWatch('qty',form)||0,loss=Form.useWatch('loss',form)||0;
  const selectedKind=Form.useWatch('kind',form);
  const selectOptions=items=>items.map(l=>({value:l.id,label:lotLabel(l)}));
  const noteField=<Form.Item label="Заметка" name="note" className="span-all"><Input.TextArea rows={2} maxLength={1500}/></Form.Item>;
  const numberField=(name,label,required=false,props={})=><Form.Item key={name} label={label} name={name} rules={required?[{required:true,message:'Заполните поле'}]:[]}><InputNumber min={0} controls={false} {...props}/></Form.Item>;
  let fields=null;
  if(dialog?.type==='product')fields=<ProductCardFields product={dialog.product} kinds={K} numberField={numberField} noteField={noteField}/>;
  if(dialog?.type==='receipt')fields=<>
    <Form.Item label="Товар" name="product" className="span-all" rules={[{required:true,message:'Выберите товар'}]}><Select showSearch optionFilterProp="label" onChange={id=>{const p=product(id);form.setFieldValue('capacity',p?.capacity?p.capacity/1000:null)}} options={products.filter(p=>p.kind!=='decant').map(p=>({value:p.id,label:`${p.code} · ${cleanName(p.name)}`}))}/></Form.Item>
    {numberField('qty',`Количество, ${units(selectedProduct)}`,true,{min:selectedProduct?.kind==='liquid'?0.001:1,precision:selectedProduct?.kind==='liquid'?3:0})}
    {numberField('capacity','Объём одной штуки, мл',['bottle','atom'].includes(selectedProduct?.kind),{disabled:!['bottle','atom'].includes(selectedProduct?.kind),min:0.001,precision:3})}
    {numberField('price',`Закупочная цена за 1 ${units(selectedProduct)}, ₽`,true,{min:0.01,precision:2})}
    {numberField('delivery','Доставка всей строки, ₽',false,{precision:2,placeholder:'Пусто — ещё не учтена'})}
    {numberField('extra','Другие затраты всей строки, ₽',true,{precision:2})}{noteField}
  </>;
  if(dialog?.type==='open')fields=<>
    <Form.Item label="Партия полноразмерных флаконов" name="lot" className="span-all" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={selectOptions(activeLots('bottle'))}/></Form.Item>
    {numberField('qty','Сколько флаконов открыть, шт.',true,{min:1,precision:0})}{numberField('loss','Общие потери при открытии, мл',true,{precision:3})}
    {noteField}<Alert className="span-all" type="info" title={`Будет получено ${fmt(Math.max(0,(selectedLot?.capacity||0)*openCount/1000-loss))} мл. Стоимость флаконов перейдёт в стоимость жидкости.`}/>
  </>;
  if(dialog?.type==='writeoff')fields=<>
    <Form.Item label="Партия" name="lot" className="span-all" rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={selectOptions(activeLots())}/></Form.Item>
    {numberField('qty',`Количество, ${units(product(selectedLot?.product_id))}`,true,{min:0.001,precision:product(selectedLot?.product_id)?.kind==='liquid'?3:0})}
    <Form.Item label="Причина" name="reason" rules={[{required:true}]}><Select options={['Пробник / тестер','Пролив / потери','Брак упаковки','Недостача при пересчёте','Другое'].map(value=>({value,label:value}))}/></Form.Item>{noteField}
  </>;
  if(dialog?.type==='reverse')fields=<Form.Item label="Причина отмены" name="reason" className="span-all" rules={[{required:true,message:'Укажите причину'}]}><Input maxLength={300}/></Form.Item>;
  if(dialog?.type==='produce')fields=<>
    <Alert className="span-all" type="info" title={`Себестоимость штуки: ${rub(dialog.quote.cost)}. Цена продажи: ${rub(dialog.quote.sale)}.`}/>
    {numberField('qty','Количество готовых штук',true,{min:1,precision:0})}{noteField}
    <p className="help-text span-all">Будет списано {fmt(openCount*dialog.payload.ml)} мл парфюма, {fmt(openCount)} атомайзеров{dialog.payload.label?` и ${fmt(openCount)} наклеек`:''}.</p>
  </>;
  const titles={product:'Карточка товара',receipt:'Поступление товара',open:'Открыть флакон на распив',writeoff:'Списание',reverse:'Отмена документа',produce:'Выпуск распива'};
  return <Layout className="erp-layout">
    <Layout.Sider width={240} className="erp-sider" style={{background:'#1e2b40'}}><div className="erp-brand">арома.<small>УЧЁТ И ПРОИЗВОДСТВО</small></div><Menu theme="dark" mode="inline" items={menuItems} defaultOpenKeys={[]} selectedKeys={[['goods','catalog','bottles','liquid','decants','import'].includes(page)?'goods':page]} onClick={({key})=>go(key)}/><div className="erp-sider-note">Только на этом компьютере<br/>Арома 1.1</div></Layout.Sider>
    <Layout><Layout.Header className="erp-header"><div><Typography.Text strong>МОЯ МАСТЕРСКАЯ</Typography.Text><span className="secondary-text">{s?'● База подключена':'Подключение к базе…'}</span></div><Space><Button icon={<ReloadOutlined/>} onClick={()=>refresh().catch(e=>setError(e.message))}>Обновить</Button><Button icon={<SaveOutlined/>} disabled={!s} onClick={backup}>Резервная копия</Button></Space></Layout.Header>
      <Layout.Content className="erp-content"><Select className="mobile-nav" aria-label="Раздел программы" value={['catalog','bottles','liquid','decants','import'].includes(page)?'goods':page} onChange={go} options={Object.entries(names).filter(([key])=>!['catalog','bottles','liquid','decants','import'].includes(key)).map(([value,label])=>({value,label}))}/>{error&&<Alert type="error" showIcon title={error} style={{marginBottom:20}}/>}{s?content:<div style={{padding:80,textAlign:'center'}}><Spin size="large"/></div>}</Layout.Content>
      <Layout.Footer className="erp-footer"><span>Данные хранятся на вашем ПК</span><span>{s?.data_folder}</span></Layout.Footer>
    </Layout>
    <Modal open={!!dialog&&dialog.type!=='document'} title={titles[dialog?.type]} onCancel={()=>{if(!busy)setDialog(null)}} onOk={()=>form.submit()} confirmLoading={busy} okText={dialog?.type==='product'?'Сохранить карточку':'Провести'} cancelText="Отмена" destroyOnHidden width={dialog?.type==='product'?1000:720} maskClosable={!busy} keyboard={!busy} closable={!busy}>
      <Form form={form} layout="vertical" onFinish={submit} disabled={busy}><div className="form-grid">{fields}</div></Form>
    </Modal>
    {dialog?.type==='document'&&<DocumentModal {...common} d={dialog.document} onClose={()=>setDialog(null)} onReverse={()=>show('reverse',{}, {document:dialog.document})}/>}
  </Layout>;
}

function Catalog(props) {
  const {s,page,editProduct,receive}=props;
  const fixed={bottles:'bottle',liquid:'liquid',decants:'decant',import:'import'}[page];
  const [kind,setKind]=useState(fixed||'all'),[search,setSearch]=useState(''),[questionOnly,setQuestionOnly]=useState(false);
  const questionCount=s.products.filter(p=>p.name.includes('?')).length;
  const rows=s.products.filter(p=>(kind==='all'||p.kind===kind)&&(!questionOnly||p.name.includes('?'))&&searchMatch(p,search));
  const columns=[
    {title:'Фото',key:'photo',width:78,render:(_,p)=><Photo p={p}/>},
    {title:'Код',dataIndex:'code',width:115,render:v=><span className="code">{v}</span>},
    {title:'Наименование',dataIndex:'name',render:(_,p)=><ProductName p={p}/>},
    {title:'Объём',dataIndex:'capacity',render:v=>v?`${fmt(v/1000)} мл`:'—'},
    {title:'Цена продажи',dataIndex:'sale',render:money},
    {title:'Действия',key:'actions',render:(_,p)=><Space><Button onClick={()=>editProduct(p)}>Изменить</Button>{p.kind!=='decant'&&<Button onClick={()=>receive(p.id)}>Поступление</Button>}</Space>},
  ];
  return <><Heading title="Товары" sub="Карточки товаров. Фактическое наличие смотрите в остатках.">{!['liquid','decant','import'].includes(kind)&&<Button type="primary" icon={<PlusOutlined/>} onClick={()=>editProduct(null,kind==='all'?'bottle':kind)}>Создать карточку</Button>}</Heading>
    <Tabs activeKey={kind} onChange={v=>{setKind(v);setSearch('')}} items={[{key:'all',label:'Все товары'},...Object.entries(K).map(([key,label])=>({key,label})),{key:'import',label:'Импорт CSV'}]}/>
    {kind==='import'?<ImportCSV {...props} embedded/>:<Card><div className="toolbar"><Input.Search className="search-field" aria-label="Поиск по названию или коду" placeholder="Поиск по названию или коду" allowClear value={search} onChange={e=>setSearch(e.target.value)}/><Checkbox checked={questionOnly} onChange={e=>setQuestionOnly(e.target.checked)}>Названия с ? ({questionCount})</Checkbox><span className="photo-count">Найдено {rows.length} · с фото {rows.filter(p=>p.image).length}</span></div>
      <PagedTable rows={rows} columns={columns.map(col=>({...col,onCell:p=>({style:p.name.includes('?')?{background:'#fff7d6'}:{}})}))} resetKey={kind+'|'+search+'|'+questionOnly}/>
    </Card>}</>;
}

function Stock({s,product,lotLabel,openBottle,writeoff,openDoc,summaries}) {
  const [kind,setKind]=useState('all'),[mode,setMode]=useState('summary'),[zero,setZero]=useState(false),[search,setSearch]=useState('');
  const summaryRows=summaries.filter(p=>(kind==='all'||p.kind===kind)&&(zero||p.quantity>0)&&searchMatch(p,search));
  const partyRows=s.lots.filter(l=>l.status==='active'&&(zero||l.remaining>0)&&(kind==='all'||product(l.product_id)?.kind===kind)&&((product(l.product_id)?.name||'')+' '+l.id).toLowerCase().includes(search.toLowerCase()));
  const columns=mode==='summary'?[
    {title:'Фото',key:'photo',render:(_,p)=><Photo p={p}/>},
    {title:'Товар',key:'name',render:(_,p)=><ProductName p={p}/>},
    {title:'Категория',dataIndex:'kind',render:v=><Tag>{K[v]}</Tag>},
    {title:'Остаток',key:'qty',render:(_,p)=>`${qty(p.quantity,p)} ${units(p)}`},
    {title:'Стоимость',dataIndex:'cost',render:money},{title:'Партий',dataIndex:'parties'},
  ]:[
    {title:'Партия / товар',key:'name',render:(_,l)=><><span className="code">№ {l.id}</span><ProductName p={product(l.product_id)}/><span className="secondary-text">{dt(l.date)}{l.capacity?` · ${fmt(l.capacity/1000)} мл в штуке`:''}</span></>},
    {title:'Остаток / получено',key:'qty',render:(_,l)=>`${qty(l.remaining,product(l.product_id))} / ${qty(l.qty,product(l.product_id))} ${units(product(l.product_id))}`},
    {title:'Стоимость остатка',dataIndex:'remaining_cost',render:money},
    {title:'Действия',key:'actions',render:(_,l)=><Space wrap>{product(l.product_id)?.kind==='bottle'&&l.remaining>0&&<Button onClick={()=>openBottle(l.id)}>На распив</Button>}<Button onClick={()=>openDoc(l.document_id)}>Документ</Button>{l.remaining>0&&<Button onClick={()=>writeoff(l.id)}>Списать</Button>}</Space>},
  ];
  const exportStock=()=>download(csv([['Код','Наименование','Категория','Остаток','Единица','Стоимость остатка, руб.'],...summaries.map(p=>[p.code,p.name,K[p.kind],qty(p.quantity,p),units(p),(p.cost/100).toFixed(2).replace('.',',')])]),'Остатки-Арома.csv');
  return <><Heading title="Остатки" sub="Количество и стоимость товаров на текущий момент."><Space wrap><Button onClick={exportStock}>Выгрузить CSV</Button><Button onClick={()=>writeoff()}>Списание</Button><Button type="primary" onClick={()=>openBottle()}>Открыть на распив</Button></Space></Heading>
    <Tabs activeKey={kind} onChange={setKind} items={[{key:'all',label:'Все товары'},...Object.entries(K).map(([key,label])=>({key,label}))]}/>
    <Card><div className="toolbar"><Input.Search className="search-field" aria-label="Поиск остатков" placeholder="Поиск товара или партии" allowClear value={search} onChange={e=>setSearch(e.target.value)}/><Space wrap><Select value={mode} onChange={setMode} options={[{value:'summary',label:'По товарам'},{value:'lots',label:'По партиям'}]}/><Checkbox checked={zero} onChange={e=>setZero(e.target.checked)}>Показывать нулевые</Checkbox></Space></div><PagedTable rows={mode==='summary'?summaryRows:partyRows} columns={columns} resetKey={[kind,mode,zero,search].join('|')}/></Card></>;
}

function Documents({docs,columns}) {
  const [kind,setKind]=useState('all');
  return <><Heading title="Документы" sub="История движения товаров и отмены операций."/><Tabs activeKey={kind} onChange={setKind} items={[{key:'all',label:'Все операции'},...Object.entries(DK).map(([key,label])=>({key,label}))]}/><Card><PagedTable rows={docs.filter(d=>kind==='all'||d.kind===kind)} columns={columns} resetKey={kind}/></Card></>;
}

function DocumentModal({s,product,d,onClose,onReverse}) {
  const detail=JSON.parse(d.details),out=s.lots.find(l=>l.id===detail.output);
  const rows=(detail.inputs||[]).map(x=>({...x,p:product(s.lots.find(l=>l.id===x.lot_id)?.product_id)}));
  return <Modal open title={`${DK[d.kind]} · № ${d.id}`} onCancel={onClose} width={760} footer={<Space>{d.status==='posted'&&d.kind!=='reversal'&&<Button danger onClick={onReverse}>Отменить документ</Button>}<Button onClick={onClose}>Закрыть</Button></Space>}>
    <p>{d.description}</p><p>{dt(d.date)} <Tag color={d.status==='posted'?'green':'orange'}>{d.status==='posted'?'Проведён':'Отменён'}</Tag></p>
    {rows.length>0&&<><Divider>Списано</Divider><Table size="small" pagination={false} rowKey="lot_id" dataSource={rows} columns={[{title:'Компонент',dataIndex:'name'},{title:'Количество',render:(_,x)=>`${qty(x.qty,x.p)} ${units(x.p)}`},{title:'Стоимость',dataIndex:'cost',render:money}]}/></>}
    {out&&<><Divider>Получено</Divider><p>{product(out.product_id)?.name}</p><div className="document-totals"><div>Получено<strong>{qty(out.qty,product(out.product_id))} {units(product(out.product_id))}</strong></div><div>Стоимость партии<strong>{money(out.total_cost)}</strong></div><div>Остаток<strong>{qty(out.remaining,product(out.product_id))} {units(product(out.product_id))}</strong></div></div></>}
    {d.kind==='receipt'&&<p>Товар: {money(detail.goods)} · доставка: {detail.delivery==null?'не учтена':money(detail.delivery)} · другие затраты: {money(detail.extra)}</p>}
    {detail.manufacture!=null&&<p>Затраты на изготовление: {money(detail.manufacture)}</p>}
    {!!detail.loss&&<p>Потери при открытии: {fmt(detail.loss/1000)} мл</p>}
    {detail.reason&&<p>Причина: {detail.reason}</p>}{detail.note&&<p>Заметка: {detail.note}</p>}
  </Modal>;
}

function Calculator({s,activeLots,lotLabel,api,show,go}) {
  const liquids=activeLots('liquid'),atoms=activeLots('atom'),labels=activeLots('label');
  const [liquid,setLiquid]=useState(liquids[0]?.id),[label,setLabel]=useState(null),[extra,setExtra]=useState(0),[chosen,setChosen]=useState({}),[sales,setSales]=useState({}),[quotes,setQuotes]=useState({}),[errors,setErrors]=useState({}),[loading,setLoading]=useState(false);
  const generation=useRef(0);
  const getAtom=n=>chosen[n]||atoms.find(l=>l.capacity>=n*1000)?.id;
  const payload=n=>({liquid,atom:getAtom(n),label:label||null,extra:extra??0,ml:n,sale:sales[n]??''});
  useEffect(()=>{
    const sequence=++generation.current;setLoading(true);setQuotes({});
    const timer=setTimeout(async()=>{
      const found={},err={};
      await Promise.all(volumes.map(async n=>{
        if(!liquid||!getAtom(n)){err[n]='Выберите парфюм и подходящий атомайзер';return}
        try{found[n]=await api('/api/quote',payload(n))}catch(e){err[n]=e.message}
      }));
      if(generation.current===sequence){setQuotes(found);setErrors(err);setLoading(false)}
    },200);
    return()=>{clearTimeout(timer);generation.current++};
  },[liquid,label,extra,chosen,sales,s.lots,s.settings]);
  const columns=[
    {title:'Объём',dataIndex:'ml',render:n=><strong>{n} мл</strong>},
    {title:'Атомайзер',render:(_,r)=><Select aria-label={`Атомайзер ${r.ml} мл`} style={{width:210}} value={getAtom(r.ml)} placeholder="Нет подходящей упаковки" onChange={v=>setChosen(x=>({...x,[r.ml]:v}))} options={atoms.filter(l=>l.capacity>=r.ml*1000).map(l=>({value:l.id,label:lotLabel(l)}))}/>},
    {title:'Себестоимость',render:(_,r)=>{const q=quotes[r.ml];return q?<><strong>{rub(q.cost)}</strong><div className="cost-breakdown">Парфюм {rub(q.liquid)}<br/>Тара {rub(q.atom)} · наклейка {rub(q.label)}<br/>Работа {rub(q.work)} · прочее {rub(q.extra)}</div></>:<span className="help-text">{loading?'Расчёт…':errors[r.ml]}</span>}},
    {title:'Рекомендованная цена',render:(_,r)=>rub(quotes[r.ml]?.recommended)},
    {title:'Ваша цена',render:(_,r)=><InputNumber aria-label={`Цена продажи ${r.ml} мл`} style={{width:120}} min={0} precision={2} value={sales[r.ml]} onChange={v=>setSales(x=>({...x,[r.ml]:v}))}/>},
    {title:'После расходов',render:(_,r)=>{const q=quotes[r.ml];return q?.net==null?'—':<><span className={Number(q.net)<0?'negative':'positive'}>{rub(q.net)}</span><div className="help-text">Маржа {q.margin==null?'—':fmt(q.margin)+'%'}</div></>}},
    {title:'Минимальная цена',render:(_,r)=>rub(quotes[r.ml]?.minimum)},
    {title:'',render:(_,r)=><Button type="primary" disabled={loading||!quotes[r.ml]} onClick={()=>show('produce',{qty:1},{payload:payload(r.ml),quote:quotes[r.ml]})}>Изготовить</Button>},
  ];
  const scale=volumes.filter(n=>sales[n]!=null).map(n=>({n,unit:Number(sales[n])/n}));
  const badScale=scale.some((v,i)=>i>0&&v.unit>scale[i-1].unit);
  return <><Heading title="Калькулятор распива" sub="Себестоимость и отдельная цена для каждого объёма."><Button onClick={()=>go('settings')}>Настроить расходы</Button></Heading>
    {!liquids.length&&<Alert style={{marginBottom:20}} showIcon type="info" title="Сначала откройте флакон на распив" description="После поступления и открытия появится партия парфюма в миллилитрах."/>}
    <Card><div className="calc-settings"><label>Парфюм, партия<Select aria-label="Партия парфюма" style={{width:'100%',marginTop:8}} showSearch optionFilterProp="label" value={liquid} onChange={v=>{setLiquid(v);setSales({})}} options={liquids.map(l=>({value:l.id,label:lotLabel(l)}))}/></label><label>Наклейка<Select aria-label="Наклейка" style={{width:'100%',marginTop:8}} allowClear value={label} onChange={setLabel} placeholder="Без наклейки" options={labels.map(l=>({value:l.id,label:lotLabel(l)}))}/></label><label>Прочие расходы на штуку, ₽<InputNumber aria-label="Прочие расходы на штуку" style={{width:'100%',marginTop:8}} min={0} precision={2} value={extra} onChange={setExtra}/></label></div>
      <Button style={{marginBottom:18}} disabled={loading||!Object.keys(quotes).length} onClick={()=>setSales(Object.fromEntries(volumes.filter(n=>quotes[n]?.recommended!=null).map(n=>[n,Number(quotes[n].recommended)])))}>Применить рекомендованные цены</Button>
      {badScale&&<Alert type="warning" title="Проверьте шкалу: у большего объёма цена одного миллилитра выше." style={{marginBottom:18}}/>}
      <Table rowKey="ml" dataSource={volumes.map(ml=>({ml}))} columns={columns} pagination={false} scroll={{x:'max-content'}}/>
    </Card></>;
}

function Settings({s,api,refresh,message}) {
  const [form]=Form.useForm(),[busy,setBusy]=useState(false);
  const initial={work:s.settings.work,work_mode:s.settings.work_mode,round_step:s.settings.round_step};
  s.settings.fees.forEach((f,i)=>initial['fee_'+i]=f.rate);
  volumes.forEach(n=>initial['mult_'+n]=s.settings.multipliers[n]);
  const save=async values=>{
    setBusy(true);
    try{const settings=structuredClone(s.settings);settings.work=values.work;settings.work_mode=values.work_mode;settings.round_step=values.round_step;settings.fees.forEach((f,i)=>f.rate=values['fee_'+i]);volumes.forEach(n=>settings.multipliers[n]=values['mult_'+n]??null);await api('/api/settings',{settings});await refresh();message.success('Настройки сохранены')}catch(e){message.error(e.message)}finally{setBusy(false)}
  };
  return <><Heading title="Расходы и цены" sub="Новые настройки применяются к следующим расчётам. Себестоимость проведённых выпусков сохранится."/><Card><Form form={form} initialValues={initial} layout="vertical" onFinish={save}>
    <Typography.Title level={4}>Изготовление</Typography.Title><div className="settings-grid"><Form.Item name="work" label="Стоимость работы, ₽" rules={[{required:true}]}><InputNumber min={0}/></Form.Item><Form.Item name="work_mode" label="Расчёт работы"><Select options={[{value:'ml',label:'За 1 мл'},{value:'unit',label:'За штуку'}]}/></Form.Item><Form.Item name="round_step" label="Шаг округления цены, ₽" rules={[{required:true}]}><InputNumber min={0.01} precision={2}/></Form.Item></div>
    <Divider/><Typography.Title level={4}>Расходы с продажи</Typography.Title><div className="settings-grid">{s.settings.fees.map((f,i)=><Form.Item key={i} name={'fee_'+i} label={f.name+', %'} rules={[{required:true}]}><InputNumber min={0} max={99.99}/></Form.Item>)}</div>
    <Divider/><Typography.Title level={4}>Коэффициенты для объёмов</Typography.Title><div className="settings-grid five">{volumes.map(n=><Form.Item key={n} name={'mult_'+n} label={`${n} мл`}><InputNumber min={0.01} max={100} placeholder="Не задан"/></Form.Item>)}</div><Button type="primary" htmlType="submit" loading={busy}>Сохранить настройки</Button>
  </Form></Card></>;
}

function ImportCSV({api,refresh,message,embedded=false}) {
  const [kind,setKind]=useState('bottle'),[update,setUpdate]=useState(false),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false);
  const draft=useRef(null),generation=useRef(0);
  const reset=()=>{generation.current++;draft.current=null;setPreview(null)};
  const check=async()=>{
    if(!file)return message.info('Выберите CSV-файл');if(file.size>5_000_000)return message.error('Файл должен быть меньше 5 МБ');
    const seq=++generation.current;setBusy(true);
    try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const payload={content:btoa(binary),kind,update_existing:update};const result=await api('/api/import/preview',payload);
      if(seq===generation.current){draft.current=payload;setPreview(result)}
    }catch(e){message.error(e.message)}finally{setBusy(false)}
  };
  const apply=async()=>{if(!draft.current)return;setBusy(true);try{await api('/api/import/apply',draft.current);reset();await refresh();message.success('Карточки импортированы')}catch(e){message.error(e.message)}finally{setBusy(false)}};
  return <>{!embedded&&<Heading title="Импорт CSV" sub="Загрузка карточек товаров с предварительной проверкой."/>}<Card>
    <Alert showIcon type="info" title="Импорт создаёт карточки" description="Остатки и себестоимость вносятся поступлениями. Нужны колонки NAME / EXTERNAL_CODE или Название / Код; дополнительно PRICE и VOLUME." style={{marginBottom:22}}/>
    <Space wrap style={{marginBottom:20}}><Select aria-label="Категория импорта" disabled={busy} value={kind} onChange={v=>{setKind(v);reset()}} options={Object.entries(K).filter(([k])=>k!=='liquid').map(([value,label])=>({value,label}))}/><Checkbox disabled={busy} checked={update} onChange={e=>{setUpdate(e.target.checked);reset()}}>Обновлять существующие карточки</Checkbox><input aria-label="CSV-файл" disabled={busy} type="file" accept=".csv" onChange={e=>{setFile(e.target.files[0]);reset()}}/></Space>
    <Space><Button loading={busy} onClick={check}>Проверить файл</Button><Button type="primary" disabled={!preview||busy} onClick={apply}>Применить импорт</Button></Space>
    {preview&&<><Divider/><p>Всего {preview.count} · новых {preview.new} · совпадений {preview.existing}. Предпросмотр первых 50 строк.</p><Table rowKey="code" dataSource={preview.rows} pagination={{pageSize:10}} columns={[{title:'Код',dataIndex:'code'},{title:'Название',dataIndex:'name'},{title:'Объём',dataIndex:'capacity',render:v=>v?fmt(v/1000)+' мл':'—'},{title:'Цена продажи',dataIndex:'sale',render:money}]} scroll={{x:'max-content'}}/></>}
  </Card></>;
}
