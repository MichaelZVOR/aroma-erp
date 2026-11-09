'use client';

import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {useLegacyDiscard,useLegacyNavigationLock} from './NavigationLock';
import {Alert,App,Button,Card,Empty,Form,Input,Modal,Select,Space,Spin,Statistic,Table,Tabs,Tag,Typography} from 'antd';

const categories={bottle:'Полноразмерные флаконы',liquid:'Жидкость для распива',decant:'Готовые распивы',atom:'Атомайзеры',label:'Наклейки',other:'Прочие материалы'};
const statuses={linked:['Связь подтверждена по ID','green'],review:['Проверить','orange'],unlinked:['Без связи','orange'],missing:['Карточка не найдена','red'],stock_only:['Только склад','default']};
function downloadCSV(rows,name){
 const csv='\ufeff'+rows.map(row=>row.map(value=>{let v=String(value??'');if(/^[=+@\-\t\r\n]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';}).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function WarehouseSetup({s}){
 const {message}=App.useApp();const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[edit,setEdit]=useState(null),[form]=Form.useForm();
 const [editDirty,setEditDirty]=useState(false);
 const confirmDiscard=useLegacyDiscard();
 const releaseLocation=useLegacyNavigationLock('locations', !!edit&&editDirty);
 const closeLocation=()=>{releaseLocation();setEdit(null);};
 const [tab,setTab]=useState('locations'),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25);
 const [location,setLocation]=useState(null),[date,setDate]=useState(''),[kind,setKind]=useState('all');
 const load=useCallback(async()=>{const r=await fetch('/api/warehouse/state',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось открыть подготовку склада');setData(d);setError('');return d;},[]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 const rows=useMemo(()=>{const q=search.trim().toLocaleLowerCase('ru');return (data?.reconciliation||[]).filter(r=>(status==='all'||(status==='issues'?['review','unlinked','missing'].includes(r.status):r.status===status))&&[r.sales_name,r.product_name,r.code,r.source_id,...r.issues].join(' ').toLocaleLowerCase('ru').includes(q));},[data,status,search]);
 function openLocation(row){setEditDirty(false);const next={...(row||{role:data.locations.some(x=>x.role==='central')?'store':'central'}),request_key:crypto.randomUUID()};form.resetFields();form.setFieldsValue(next);setEdit(next);}
 async function saveLocation(values){
  if(busy)return;setBusy(true);
  try{const r=await fetch('/api/warehouse/location',{method:'POST',headers:{'Content-Type':'application/json','X-Aroma-Token':s.token},body:JSON.stringify({...values,id:edit.id,revision:edit.revision,request_key:edit.request_key})});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось сохранить место');closeLocation();message.success('Место хранения сохранено');try{await load();}catch(e){setError('Место сохранено, но список не обновился. Нажмите «Обновить подготовку».');}}catch(e){message.error(e.message);}finally{setBusy(false);}
 }
 function exportLinks(){downloadCSV([['Статус','Позиция продаж','ID продаж','Складская карточка','ID товара','Код','Категория','Замечания','Возможные совпадения'],...rows.map(r=>[statuses[r.status][0],r.sales_name,r.sales_id,r.product_name,r.product_id,r.code,categories[r.kind],r.issues.join('; '),r.candidates.map(x=>x.name+' ['+x.id+']').join('; ')])],'Проверка-связей-товаров.csv');}
 function template(){
  const place=data.locations.find(x=>x.id===location);if(!place||!/^\d{4}-\d{2}-\d{2}$/.test(date)){message.warning('Выберите место хранения и дату пересчёта');return;}
  const products=s.products.filter(p=>kind==='all'||p.kind===kind);
  downloadCSV([['ID места','Место хранения','Дата остатков','ID товара','Код товара','Наименование','Категория','Единица','Объём одной штуки, мл','Фактическое количество','Себестоимость единицы, ₽','Оценка стоимости','Примечание'],...products.map(p=>[place.id,place.name,date,p.id,p.code,p.name,categories[p.kind],p.kind==='liquid'?'мл':'шт.',p.capacity==null?'':String(p.capacity/1000).replace('.',','),'','','',''])],'Начальные-остатки-'+date+'.csv');
 }
 const header=<div className="page-heading"><div><h1>Подготовка склада</h1><p>Места хранения, связь товаров и подготовка начальных остатков.</p></div><Button onClick={()=>load().catch(e=>setError(e.message))}>Обновить подготовку</Button></div>;
 if(!data)return <>{header}{error?<Alert type="error" title={error}/>:<Spin/>}</>;
 const issues=data.counts.review+data.counts.unlinked+data.counts.missing;
 const places=<Space orientation="vertical" size={20} style={{width:'100%'}}>
  <Alert type="info" showIcon title="Сначала задайте реальные места хранения" description="Добавьте центральный склад и ваши магазины. Создание места не переносит товары и не создаёт остатки. На этом этапе существующие поступления ещё не распределяются по местам."/>
  <Card title="Склад и магазины" extra={<Button type="primary" onClick={()=>openLocation()}>Добавить место</Button>}>
   <Table rowKey="id" dataSource={data.locations} pagination={false} scroll={{x:650}} locale={{emptyText:<Empty description="Места хранения ещё не добавлены"/>}} columns={[{title:'Название',dataIndex:'name'},{title:'Тип',dataIndex:'role',render:v=><Tag color={v==='central'?'blue':'default'}>{v==='central'?'Центральный склад':'Магазин'}</Tag>},{title:'Примечание',dataIndex:'note',render:v=>v||'—'},{title:'',key:'action',render:(_,r)=><Button onClick={()=>openLocation(r)}>Изменить</Button>}]}/>
  </Card>
  <Card title="Готовность к следующему этапу"><Space wrap size={32}><Statistic title="Центральных складов" value={data.locations.filter(x=>x.role==='central').length}/><Statistic title="Магазинов" value={data.locations.filter(x=>x.role==='store').length}/><Statistic title="Складских карточек" value={data.products}/><Statistic title="Связей для проверки" value={issues}/></Space><p className="help-text">Нужно подготовить один центральный склад и два магазина. Количество карточек — это ассортимент, а не физическое наличие. Ввод остатков, перемещения и списание из продаж будут отдельными этапами.</p></Card>
 </Space>;
 const links=<Card title="Связь базы продаж и складского каталога" extra={<Button onClick={exportLinks}>Скачать проверку CSV</Button>}>
  <Alert type={issues?'warning':'success'} showIcon title={issues?'Найдены записи для проверки: '+issues:'Связи по идентификаторам проверены'} description="Проверка использует сохранённые ID товаров. Различия названий и категорий показаны отдельно. Совпадение названий — только подсказка: карточки, цены и продажи автоматически не изменяются." style={{marginBottom:20}}/>
  <Space wrap style={{marginBottom:16}}><Input.Search aria-label="Поиск связей товаров" placeholder="Название или код товара" value={search} allowClear onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{width:320,maxWidth:'100%'}}/><Select aria-label="Статус связи товаров" value={status} onChange={v=>{setStatus(v);setPage(1);}} style={{width:260}} options={[{value:'all',label:'Все записи'},{value:'issues',label:'Требуют проверки'},...Object.entries(statuses).map(([value,[label]])=>({value,label}))]}/><Typography.Text type="secondary">Найдено: {rows.length}</Typography.Text></Space>
  <Table rowKey="id" dataSource={rows} scroll={{x:1050}} pagination={{current:Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize))),pageSize,pageSizeOptions:[10,25,50,100],showSizeChanger:true,showTotal:n=>'Всего '+n,onChange:(p,size)=>{setPage(size!==pageSize?1:p);setPageSize(size);}}} columns={[{title:'Статус',dataIndex:'status',width:210,render:v=><Tag color={statuses[v][1]}>{statuses[v][0]}</Tag>},{title:'Товар в продажах',dataIndex:'sales_name',width:300,render:(v,r)=><>{v||'—'}{r.sales_id&&<span className="secondary-text">{r.sales_id}</span>}</>},{title:'Складская карточка',dataIndex:'product_name',width:300,render:(v,r)=><>{v||'—'}{r.product_id&&<span className="secondary-text">{r.code} · {categories[r.kind]}</span>}</>},{title:'Замечания',key:'issues',width:340,render:(_,r)=><>{r.issues.join('. ')||'—'}{r.candidates.length>0&&<div className="help-text">Возможные совпадения: {r.candidates.map(x=>x.name+' ['+x.code+']').join('; ')}</div>}</>}]}/>
 </Card>;
 const balances=<Space orientation="vertical" size={20} style={{width:'100%'}}>
  <Alert type="info" showIcon title="Подготовка пересчёта, без загрузки в учёт" description="Скачайте список товаров отдельно для каждого места и заполните фактическое количество и себестоимость. Загрузка и проведение начальных остатков будут следующим этапом. Пустые значения не означают ноль."/>
  {data.legacy_lots>0&&<Alert type="warning" title={'В прежнем учёте есть активные партии: '+data.legacy_lots} description="Перед вводом начальных остатков их нужно сверить. Повторно добавлять то же наличие нельзя."/>}
  <Card title="Шаблон начальных остатков">
   <Space wrap align="end" size={16}><label>Место хранения<Select aria-label="Место для шаблона остатков" style={{display:'flex',width:280,marginTop:6}} placeholder="Выберите сохранённое место" value={location} onChange={setLocation} options={data.locations.map(x=>({value:x.id,label:x.name}))}/></label><label>Дата пересчёта<Input aria-label="Дата начальных остатков" type="date" style={{display:'block',width:190,marginTop:6}} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Категория<Select aria-label="Категория шаблона остатков" style={{display:'flex',width:250,marginTop:6}} value={kind} onChange={setKind} options={[{value:'all',label:'Все товары'},...Object.entries(categories).map(([value,label])=>({value,label}))]}/></label><Button type="primary" disabled={!location||!date||!s.products.some(p=>kind==='all'||p.kind===kind)} onClick={template}>Скачать шаблон CSV</Button></Space>
   {!data.locations.length&&<p className="help-text">Сначала добавьте реальные места хранения в первой вкладке.</p>}
   <p>В шаблоне уже будут названия и ID карточек. Количество и себестоимость оставлены пустыми: их нужно установить по фактическому пересчёту и закупкам.</p>
   <Typography.Paragraph>Флаконы, готовые распивы и упаковка — в штуках, открытый парфюм — в миллилитрах. Поле «Себестоимость единицы» означает стоимость одной штуки или одного мл с уже учтёнными закупочными расходами. Оценка стоимости: «подтверждена» или «предварительная». Неизвестную стоимость оставьте пустой.</Typography.Paragraph>
   <Alert type="warning" title="Старые закупки не перезаписываем" description="Одинаковый товар из разных закупочных партий можно указать несколькими строками с отдельным количеством и стоимостью. Не меняйте ID карточек и места. Сохранённые цены CSV и калькулятора не принимаются за подтверждённую стоимость остатков."/>
  </Card>
 </Space>;
 return <>{header}{error&&<Alert type="error" title={error} style={{marginBottom:16}}/>}<Tabs activeKey={tab} onChange={setTab} items={[{key:'locations',label:'Места хранения',children:places},{key:'links',label:'Проверка товаров',children:links},{key:'balances',label:'Начальные остатки',children:balances}]}/>
  <Modal title={edit?.id?'Изменить место хранения':'Новое место хранения'} open={!!edit} onCancel={()=>!busy&&confirmDiscard(editDirty,closeLocation,true)} onOk={()=>form.submit()} okText="Сохранить" cancelButtonProps={{style:{display:"none"}}} confirmLoading={busy} maskClosable={false} keyboard={false} closable={!busy} destroyOnHidden>
   <Form form={form} layout="vertical" onFinish={saveLocation} onValuesChange={()=>setEditDirty(true)} disabled={busy}><Form.Item label="Название" name="name" rules={[{required:true,whitespace:true,message:'Введите название места'}]}><Input aria-label="Название места хранения" maxLength={120} placeholder="Название вашего склада или магазина"/></Form.Item><Form.Item label="Тип места" name="role" rules={[{required:true}]}><Select aria-label="Тип места хранения" options={[{value:'central',label:'Центральный склад'},{value:'store',label:'Магазин'}]}/></Form.Item><Form.Item label="Примечание" name="note"><Input.TextArea aria-label="Примечание места хранения" maxLength={1000} rows={3}/></Form.Item><p className="help-text">Сохраняется только место хранения. Товары, наличие и документы продаж не изменятся.</p></Form>
  </Modal>
 </>;
}
