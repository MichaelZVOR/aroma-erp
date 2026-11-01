'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Alert,App,Button,Card,Checkbox,Collapse,Descriptions,Empty,Form,Input,Modal,Select,Space,Spin,Table,Tag,Typography} from 'antd';

const fmt=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(v));
const money=v=>v==null?'—':fmt(v/100)+' ₽';
const kinds={decant:'Распив / атомайзер',sample:'Пробник',branded_sample:'Фирменный пробник',bottle:'Полный флакон',tester:'Тестер',discounted:'Уценка',unknown:'Тип не подтверждён'};
const statusLabels={ok:'Цены получены',not_found:'Совпадение не найдено',needs_match:'Нужно уточнить карточку',blocked:'Сайт ограничил доступ',network_error:'Ошибка соединения',error:'Не удалось разобрать страницу',rate_limited:'Подождите перед повторной проверкой',not_checked:'Карточка выбрана, цены не проверены',concentration_mismatch:'Различается концентрация',out_of_stock:'Товара нет в наличии',manual_source:'Автопроверка пока не подключена',browser_timeout:'Браузер не успел загрузить страницу',browser_error:'Ошибка браузерной загрузки'};
const needsMatching=r=>r&&['not_found','needs_match'].includes(r.status);
const keyOf=v=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ru').match(/[a-z0-9а-я]+/g)?.join(' ')||'';
const date=v=>v?new Date(v).toLocaleString('ru-RU'):'Не проверено';
export default function Competitors({s}){
 const {message}=App.useApp();const [data,setData]=useState(null),[name,setName]=useState('AMOUAGE — Existence (edp)'),[results,setResults]=useState({}),[enabled,setEnabled]=useState(['allure','odekolon','randewoo','duhi']);
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState({}),[error,setError]=useState(''),[linksOpen,setLinksOpen]=useState(false),[linksBusy,setLinksBusy]=useState(false),[form]=Form.useForm();
 const [matching,setMatching]=useState(null),[searchBusy,setSearchBusy]=useState(false),[confirmBusy,setConfirmBusy]=useState(false);
 const [manualVolumes,setManualVolumes]=useState([]);
 const [includeSamples,setIncludeSamples]=useState(false),[ownSelection,setOwnSelection]=useState({});const running=useRef(false),currentName=useRef(name);
 const api=useCallback(async(path,body)=>{
  const r=await fetch('/api/competitors/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Aroma-Token':s.token},body:JSON.stringify(body)});
  const v=await r.json();if(!r.ok)throw Error(v.error||'Не удалось выполнить проверку');return v;
 },[s.token]);
 const load=useCallback(async()=>{const next=await api('state');setData(next);setResults(Object.fromEntries(next.results.map(x=>[x.fragrance+'|'+x.site,x])));return next;},[api]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 const key=keyOf(name),selected=data?.fragrances.find(f=>f.key===key);
 const setFragrance=value=>{currentName.current=value;setName(value);setMatching(null);setOwnSelection({});setManualVolumes([]);setError('');};
 const check=async only=>{
  const checkingSites=typeof only==='string'?[only]:enabled;
  if(running.current)return;running.current=true;setBusy(true);setError('');const checkingName=name,checkingKey=key;
  setProgress(Object.fromEntries(checkingSites.map(x=>[x,'checking'])));
  await Promise.allSettled(checkingSites.map(async site=>{
   try{const result=await api('check',{name:checkingName,site});setResults(prev=>({...prev,[checkingKey+'|'+site]:result}));setProgress(p=>({...p,[site]:result.status}));}
   catch(e){setResults(prev=>({...prev,[checkingKey+'|'+site]:{fragrance:checkingKey,name:checkingName,site,status:'error',offers:[],error:e.message,checked_at:new Date().toISOString()}}));setProgress(p=>({...p,[site]:'error'}));}
  }));
  running.current=false;setBusy(false);
 };
 const result=site=>results[key+'|'+site];
 const links=data?.links.filter(x=>x.fragrance===key)||[];
 const openLinks=()=>{form.resetFields();form.setFieldsValue(Object.fromEntries(data.sites.map(x=>[x.id,links.find(l=>l.site===x.id)?.url||''])));setLinksOpen(true);};
 const saveLinks=async values=>{setLinksBusy(true);try{for(const site of data.sites){const url=(values[site.id]||'').trim();if(url)await api('link',{name,site:site.id,url});}await load();setLinksOpen(false);message.success('Ссылки сохранены для этого аромата');}catch(e){message.error(e.message);}finally{setLinksBusy(false);}};
 const searchCards=async(site,useSaved=true)=>{
  if(busy||searchBusy||confirmBusy)return;
  const stored=result(site)?.candidates;
  if(useSaved&&stored?.length){setMatching({site,name,candidates:stored,status:'ok'});return;}
  setMatching({site,name,candidates:[],status:'searching'});setSearchBusy(true);
  try{const found=await api('search',{name,site});setMatching({...found,site,name});}catch(e){setMatching({site,name,candidates:[],status:'error',error:e.message});}finally{setSearchBusy(false);}
 };
 const confirmCard=async candidate=>{
  if(confirmBusy||!matching)return;
  const chosen={name:matching.name,site:matching.site,url:candidate.url},chosenKey=keyOf(matching.name);
  setConfirmBusy(true);
  try{
   await api('select',chosen);
   setResults(prev=>({...prev,[chosenKey+'|'+chosen.site]:{...chosen,status:'not_checked',offers:[],checked_at:null}}));
   setMatching(null);
   await load();
   setResults(prev=>({...prev,[chosenKey+'|'+chosen.site]:{...chosen,status:'not_checked',offers:[],checked_at:null}}));
   try{const checked=await api('check',chosen);setResults(prev=>({...prev,[chosenKey+'|'+chosen.site]:checked}));message.success(checked.status==='ok'?'Карточка запомнена, цены обновлены':'Карточка запомнена. '+(checked.error||'Проверьте цены повторно'));}
   catch(e){message.info('Карточка запомнена. '+e.message);}
  }catch(e){message.error(e.message);}finally{setConfirmBusy(false);}
 };
 const ownChoices=ml=>(selected?.own||[]).filter(x=>x.ml===ml);
 const own=ml=>{const choices=ownChoices(ml);return choices.find(x=>x.id===ownSelection[ml])||(choices.length===1?choices[0]:null);};
 const eligible=(r,ml)=>{
  const choices=ownChoices(ml),isBottle=choices.some(p=>p.kind==='bottle'),isDecant=!choices.length||choices.some(p=>p.kind==='decant');
  return r.available===true&&r.price!=null&&r.currency==='RUB'&&(isBottle&&r.kind==='bottle'||isDecant&&(r.kind==='decant'||includeSamples&&r.kind==='sample'));
 };
 const ownVolumes=[...new Set((selected?.own||[]).map(p=>p.ml).filter(v=>Number.isFinite(v)&&v>0))].sort((a,b)=>a-b);
 const volumes=ownVolumes.length?ownVolumes:manualVolumes;
 const rows=volumes.map(ml=>{
  const offers=enabled.flatMap(site=>result(site)?.status==='ok'?(result(site).offers||[]).filter(r=>r.ml===ml).map(r=>({...r,site})):[]);
  const matches=offers.filter(r=>eligible(r,ml)),prices=matches.map(x=>x.price),mine=own(ml);
  return {ml,offers,mine,minimum:prices.length?Math.min(...prices):null,maximum:prices.length?Math.max(...prices):null};
 });
 const offerCell=(r,site)=>{
  const check=result(site);
  if(progress[site]==='checking'&&busy)return <Spin size="small"/>;
  if(!check)return <span className="help-text">Не проверено</span>;
  if(check.status!=='ok')return <Typography.Text type={needsMatching(check)?'warning':'danger'}>{statusLabels[check.status]||'Ошибка проверки'}</Typography.Text>;
  const items=r.offers.filter(x=>x.site===site);
  if(!items.length)return <span className="help-text">Нет такого объёма</span>;
  return <Space orientation="vertical" size={4}>{items.map((v,i)=><div key={v.sku+'-'+i}><strong>{money(v.price)}</strong>{v.conditional_price!=null&&<div className="help-text">{money(v.conditional_price)} при авторизации</div>}<div><Tag color={v.kind==='decant'?'blue':'default'}>{kinds[v.kind]}</Tag></div><div className="help-text">{v.available===true?'В наличии':v.available===false?'Нет в наличии':'Наличие не подтверждено'}{v.old_price&&v.old_price!==v.price?<><br/><del>{money(v.old_price)}</del></>:null}</div></div>)}</Space>;
 };
 const columns=[{title:'Объём',dataIndex:'ml',width:90,fixed:'left',render:v=>v+' мл'},
  {title:'Моя цена',width:175,render:(_,r)=>ownChoices(r.ml).length>1?<Select aria-label={'Моя карточка '+r.ml+' мл'} placeholder="Выберите карточку" value={ownSelection[r.ml]} style={{width:160}} onChange={v=>setOwnSelection(p=>({...p,[r.ml]:v}))} options={ownChoices(r.ml).map(p=>({value:p.id,label:p.name+' · '+money(p.price)}))}/>:money(r.mine?.price)},
  ...(data?.sites||[]).filter(x=>enabled.includes(x.id)).map(site=>({title:<a href={result(site.id)?.url||links.find(x=>x.site===site.id)?.url||'https://'+site.host} target="_blank" rel="noopener noreferrer">{site.name}</a>,key:site.id,width:185,render:(_,r)=>offerCell(r,site.id)})),
  {title:'Минимум для сравнения',width:160,render:(_,r)=>money(r.minimum)},
  {title:'Моя цена − минимум',width:155,render:(_,r)=>r.mine?.price!=null&&r.minimum!=null?<Typography.Text type={r.mine.price>r.minimum?'warning':'success'}>{r.mine.price-r.minimum>0?'+':''}{money(r.mine.price-r.minimum)}</Typography.Text>:'—'},
 ];
 const details=enabled.flatMap(site=>result(site)?.status==='ok'?(result(site).offers||[]).map((r,i)=>({...r,id:site+'-'+i,site,checked_at:result(site).checked_at,url:r.url||result(site).url})):[]);
 const matchedDetails=details.filter(r=>volumes.includes(r.ml));
 const otherDetails=details.filter(r=>!volumes.includes(r.ml));
 const detailColumns=[
   {title:'Магазин',dataIndex:'site',render:v=>data?.sites.find(s=>s.id===v)?.name},{title:'Объём',dataIndex:'ml',render:v=>fmt(v)+' мл'},
   {title:'Вид',dataIndex:'kind',render:v=>kinds[v]},{title:'Концентрация',dataIndex:'concentration',render:v=>v?.length?v.join(', '):'Не указана'},{title:'Цена',dataIndex:'price',render:money},{title:'Цена за мл',render:(_,r)=>r.price==null?'—':money(r.price/r.ml)},
   {title:'Наличие',dataIndex:'available',render:v=>v===true?'В наличии':v===false?'Нет':'Не подтверждено'},
   {title:'Описание на сайте',dataIndex:'description',width:280,ellipsis:true},{title:'Проверено',dataIndex:'checked_at',render:date},
   {title:'Источник',render:(_,r)=><a href={r.url} target="_blank" rel="noopener noreferrer">Открыть</a>},
 ];
 const detailTable=(items,empty)=><Table rowKey="id" dataSource={items} columns={detailColumns} pagination={{defaultPageSize:25,pageSizeOptions:[10,25,50,100],showSizeChanger:true}} scroll={{x:1300}} locale={{emptyText:<Empty description={empty}/>}}/>;
 if(!data)return <Card title="Цены конкурентов">{error?<Alert type="error" title={error} action={<Button onClick={()=>load().catch(e=>setError(e.message))}>Повторить</Button>}/>:<Spin/>}</Card>;
 return <Space orientation="vertical" size={20} style={{width:'100%'}}>
  <div className="page-heading"><div><h1>Цены конкурентов</h1><p>Выберите аромат один раз — получите подборку предложений по объёмам ваших товаров.</p></div><Button disabled={busy} onClick={openLinks}>Ссылки на товары</Button></div>
  {error&&<Alert type="error" showIcon title={error}/>}
  <Card title="Аромат и источники"><Space orientation="vertical" style={{width:'100%'}} size={16}>
   <Select showSearch optionFilterProp="label" aria-label="Аромат для сравнения" placeholder="Выберите аромат из базы товаров" style={{width:'100%',maxWidth:650}} value={selected?.key} disabled={busy||searchBusy||confirmBusy||!!matching} onChange={v=>setFragrance(data.fragrances.find(f=>f.key===v).name)} options={data.fragrances.map(f=>({value:f.key,label:f.name}))}/>
   <Input aria-label="Название аромата для конкурентов" placeholder="Или введите бренд, аромат и концентрацию, например AMOUAGE Existence (edp)" value={name} disabled={busy||searchBusy||confirmBusy||!!matching} maxLength={200} onChange={e=>setFragrance(e.target.value)} style={{maxWidth:650}}/>
   <Checkbox.Group value={enabled} disabled={busy} onChange={setEnabled} options={data.sites.map(site=>({value:site.id,label:site.name}))}/>
   <Space wrap><Button type="primary" loading={busy} onClick={check} disabled={name.trim().length<3||!enabled.length||searchBusy||confirmBusy}>Проверить цены</Button><span className="help-text">Повторная проверка в течение минуты использует сохранённый результат.</span></Space>
   <p className="help-text">Программа ищет по бренду и названию, проверяет найденные карточки и автоматически отсеивает другие ароматы и концентрации. Ссылки запоминаются. Если точную версию подтвердить нельзя, причина указана у магазина.</p>
  </Space></Card>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}>{data.sites.filter(site=>enabled.includes(site.id)).map(site=>{const r=result(site.id);return <Card size="small" key={site.id} title={site.name}><Space orientation="vertical" size={6}>
   <Tag color={busy&&progress[site.id]==='checking'?'processing':r?.status==='ok'?'green':needsMatching(r)?'gold':r?'red':'default'}>{busy&&progress[site.id]==='checking'?(site.mode==='browser'?'Загрузка в браузере…':'Проверяется'):r?.status==='ok'?'Получено предложений: '+r.offers.length:r?(statusLabels[r.status]||'Не удалось обновить'):'Ещё не проверено'}</Tag>
   <span className="help-text">{date(r?.checked_at)}{r?.cached?' · из кэша':''}</span>
   {site.note&&<span className="help-text">{site.note}</span>}
   {r?.error&&<Typography.Text type={needsMatching(r)?'warning':'danger'}>{r.error}</Typography.Text>}
   <Button disabled={busy||searchBusy||confirmBusy||name.trim().length<3} onClick={()=>site.mode==='restricted'?check(site.id):searchCards(site.id)}>{site.mode==='restricted'?'Проверить доступ':needsMatching(r)?'Выбрать карточку':'Найти / сменить карточку'}</Button>
   {(r?.url||site.mode==='restricted')&&<a href={r?.url||'https://'+site.host+'/'} target="_blank" rel="noopener noreferrer">Открыть источник</a>}
  </Space></Card>;})}</div>
  <Card title="Сравнение по моим объёмам">
   {ownVolumes.length?<p><strong>Объёмы из моей базы:</strong> {ownVolumes.map(v=>fmt(v)+' мл').join(', ')}. Показаны предложения только этих объёмов.</p>:<Alert style={{marginBottom:16}} type="info" showIcon title="У этого названия нет объёмов в вашей базе" description={<Space orientation="vertical"><span>Выберите аромат из списка товаров или укажите объёмы для сравнения.</span><Select aria-label="Объёмы для сравнения" mode="multiple" placeholder="Выберите объёмы" style={{minWidth:280}} value={manualVolumes} onChange={v=>setManualVolumes(v.sort((a,b)=>a-b))} options={[1,2,3,5,10,15,20,30,35,50,75,80,90,100,125,150,200].map(v=>({value:v,label:v+' мл'}))}/></Space>}/>}

   <Checkbox checked={includeSamples} onChange={e=>setIncludeSamples(e.target.checked)}>Включать предложения с обозначением «Пробник» в расчёт минимума</Checkbox>
   <p className="help-text">Для распива минимум считается по явно обозначенным распивам/атомайзерам в наличии; пробники можно включить флажком. Для полноразмерных товаров — по обычным полным флаконам того же объёма. Фирменные пробники, тестеры, уценка и неизвестные типы в минимум не входят. Доставка не учтена.</p>
   <Table rowKey="ml" dataSource={rows} columns={columns} pagination={false} scroll={{x:1300}}/>
   <Alert style={{marginTop:16}} type="info" showIcon title="Собственные цены не изменяются" description="Цены берутся из базы продаж; если ваша цена для объёма не заполнена, показывается прочерк. Проверка конкурентов не меняет калькулятор, продажи и остатки."/>
  </Card>
  <Card title={'Предложения моих объёмов · '+matchedDetails.length}>
   <p className="help-text">Подборка по объёмам ваших товаров. Вид предложения указан отдельно: пробники, наборы, тестеры и флаконы не становятся распивами при совпадении объёма. Отсутствующие объёмы не пересчитываются.</p>
   {detailTable(matchedDetails,volumes.length?'Предложений этих объёмов пока нет. Проверьте цены и статусы магазинов.':'Выберите товар из базы или укажите объёмы для сравнения')}
  </Card>
  <Collapse items={[{key:'other-volumes',label:'Остальные найденные предложения · '+otherDetails.length,children:<><p className="help-text">Другие объёмы сохранены здесь и не участвуют в подборке по вашим объёмам.</p>{detailTable(otherDetails,'Других предложений нет')}</>}]}/>
  <Modal title={'Выбор карточки · '+(data.sites.find(s=>s.id===matching?.site)?.name||'')} open={!!matching} onCancel={()=>!searchBusy&&!confirmBusy&&setMatching(null)} footer={<Space><Button disabled={searchBusy||confirmBusy} onClick={()=>{setMatching(null);openLinks();}}>Указать ссылку вручную</Button><Button disabled={searchBusy||confirmBusy} onClick={()=>searchCards(matching.site,false)}>Повторить поиск</Button></Space>} width={800} closable={!searchBusy&&!confirmBusy} maskClosable={!searchBusy&&!confirmBusy}>
   <p><strong>{matching?.name}</strong></p>
   {searchBusy?<Spin tip="Ищем карточки магазина"/>:<>
    {matching?.error&&<Alert type={['blocked','network_error'].includes(matching.status)?'error':'warning'} showIcon title={statusLabels[matching.status]||'Не удалось выполнить поиск'} description={matching.error}/>}
    {!!matching?.queries?.length&&<p className="help-text">Запросы: {matching.queries.join(' → ')}</p>}
    {!matching?.error&&!matching?.candidates?.length&&<Empty description="Совпадений не найдено. Можно указать точную ссылку вручную."/>}
    <Space orientation="vertical" style={{width:'100%'}}>{matching?.candidates?.map(candidate=><Card key={candidate.url} size="small">
     <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
      {candidate.image?<img src={candidate.image} alt="" referrerPolicy="no-referrer" style={{width:76,height:96,objectFit:'contain'}}/>:<div style={{width:76,fontSize:12,color:'#7c899b'}}>Без фото в поиске</div>}
      <div style={{flex:1}}><strong>{candidate.title}</strong>{candidate.variant_warning&&<div><Tag color="orange">Другая версия: {candidate.variant_warning}</Tag></div>}<p className="help-text">Концентрация в поиске: {candidate.concentrations?.length?candidate.concentrations.join(', '):'не указана — проверяется в предложениях'}{candidate.brand_found?' · Бренд найден':' · Сверьте бренд на странице'}</p>
       <p><a href={candidate.url} target="_blank" rel="noopener noreferrer">Открыть карточку магазина</a></p>
       <Button type="primary" loading={confirmBusy} disabled={searchBusy} onClick={()=>confirmCard(candidate)}>Это нужный аромат</Button>
      </div>
     </div>
    </Card>)}</Space>
    <p className="help-text">Подтверждение связывает выбранную страницу с вашим ароматом. Цены попадут в сравнение только после проверки концентрации, объёма и типа предложения.</p>
   </>}
  </Modal>
  <Modal title={'Ссылки для '+name} open={linksOpen} onCancel={()=>!linksBusy&&setLinksOpen(false)} onOk={()=>form.submit()} okText="Сохранить ссылки" cancelText="Отмена" confirmLoading={linksBusy} width={750}>
   <p>Укажите страницу именно этого аромата. Объёмы программа получит из вариантов товара. Разрешены только магазины из списка. Для источников с ограниченным доступом автоматическое получение цен пока не подключено.</p>
   <Form form={form} layout="vertical" onFinish={saveLinks} disabled={linksBusy}>{data.sites.map(site=><Form.Item key={site.id} label={site.name} name={site.id}><Input disabled={site.mode==='restricted'} placeholder={site.mode==='restricted'?'Автоматическое получение цен пока не подключено':'https://'+site.host+'/...'} maxLength={1500}/></Form.Item>)}</Form>
  </Modal>
 </Space>;
}
