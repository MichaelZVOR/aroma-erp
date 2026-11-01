
'use client';
import React from 'react';
import {Alert,Checkbox,Collapse,Descriptions,Divider,Form,Image,Input,InputNumber,Select,Tag} from 'antd';
const profile=(key,label,props={})=><Form.Item key={key} name={['profile',key]} label={label}><Input maxLength={300} {...props}/></Form.Item>;
const choose=(key,label,options)=><Form.Item name={['profile',key]} label={label}><Select allowClear options={options.map(([value,label])=>({value,label}))}/></Form.Item>;
export default function ProductCardFields({product,kinds,numberField,noteField}){
 const raw=product?.profile?.raw_bifit||{};
 return <>
 <Form.Item name="kind" label="Вид учёта" rules={[{required:true}]}><Select disabled={!!product} options={Object.entries(kinds).filter(([k])=>k!=='liquid'||product).map(([value,label])=>({value,label}))}/></Form.Item>
 {profile('category','Категория товаров',{placeholder:'Например: Распив, Объёмы, Свечи, Мыло'})}
 <div className="span-all" style={{display:'grid',gridTemplateColumns:'minmax(120px,220px) 1fr',gap:20}}>
 <div>{product?.image?<Image src={product.image} alt={product.name} width="100%" style={{maxHeight:250,objectFit:'contain'}}/>:<div style={{padding:24,background:'#f5f5f5'}}>Фото пока не сопоставлено</div>}</div>
 <div>
 {profile('barcode','Штрихкод')}
 <Form.Item name="name" label="Наименование" rules={[{required:true,message:'Укажите название'}]}><Input maxLength={300}/></Form.Item>
 {profile('short_name','Краткое наименование')}
 <Form.Item name={['profile','description']} label="Описание"><Input.TextArea rows={2} maxLength={5000}/></Form.Item>
 </div></div>
 <Form.Item name="code" label="Код товара в Ароме" rules={[{required:true,message:'Укажите код'}]}><Input maxLength={60}/></Form.Item>
 {profile('vendor_code','Артикул')}
 <Form.Item name={['profile','purchase_price']} label="Закупочная цена по карточке, ₽"><InputNumber min={0} precision={2} controls={false}/></Form.Item>
 {numberField('sale','Цена продажи, ₽',false,{precision:2})}
 {numberField('capacity','Объём одной штуки, мл',false,{min:0.001,precision:3})}
 {profile('good_type','Тип товара (код БИФИТ)',{placeholder:'Не указан'})}
 <div className="span-all"><Divider titlePlacement="left">Дополнительная информация</Divider></div>
 {choose('payment_subject','Предмет расчёта',[['1','Товар'],['4','Услуга']])}
 {profile('vat','НДС (код из БИФИТ)',{placeholder:'Не указан'})}
 {choose('unit_code','Единица измерения',[['796','Штука'],['111','Миллилитр'],['163','Грамм'],['112','Литр'],['166','Килограмм']])}
 <div className="span-all" style={{display:'flex',gap:24,flexWrap:'wrap'}}>
 {['adult','weighted','focus'].map((key,i)=><Form.Item key={key} name={['profile',key]} valuePropName="checked"><Checkbox>{['Товар 18+','Дробное количество','Фокусный товар'][i]}</Checkbox></Form.Item>)}
 </div>
 {profile('shelf_life','Срок годности',{placeholder:'Не указан'})}
 {choose('shelf_unit','Единица срока',[['hour','Час'],['day','День'],['month','Месяц'],['year','Год']])}
 {profile('pack_qty','Количество в упаковке',{placeholder:'Не указано'})}
 {choose('pack_unit','Единица упаковки',[['796','Штука'],['111','Миллилитр'],['163','Грамм']])}
 {choose('mark_type','Маркировка (из БИФИТ)',[['0','Без маркировки'],['5','Парфюмерия']])}
 <Form.Item name={['profile','gtin']} label="GTIN" rules={[{pattern:/^\d{14}$/,message:'GTIN: 14 цифр'}]}><Input maxLength={14} placeholder="Не указан"/></Form.Item>
 {profile('agent_type','Признак агента',{placeholder:'Не указан'})}
 {noteField}
 <div className="span-all">
 <p style={{color:'#6b7a90'}}>Закупочная цена карточки — значение справочника. Она не изменяет стоимость ранее поступивших партий и сохранённых продаж. Пустые реквизиты из CSV остаются незаполненными.</p>
 {product?.profile?.bifit_id&&<Descriptions size="small" column={2} items={[{key:'id',label:'ID БИФИТ',children:product.profile.bifit_id},{key:'code',label:'Исходный код БИФИТ',children:product.profile.external_code}]}/>}
 <Collapse items={[{key:'source',label:'Исходные реквизиты БИФИТ',children:<Descriptions column={1} size="small" items={Object.entries(raw).map(([key,v])=>({key,label:key,children:v||'—'}))}/>}]} style={{marginTop:12}}/>
 </div>
 </>;
}

