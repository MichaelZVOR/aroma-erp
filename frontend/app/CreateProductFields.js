'use client';

import { useRef, useState } from 'react';
import categoryDefinitions from './product-categories.json';
import { App, AutoComplete, Button, Checkbox, Empty, Form, Input, InputNumber, Select, Table } from 'antd';
import { CameraFilled, BarcodeOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const options = entries => entries.map(([value, label]) => ({ value, label }));
const units = [['796','Штука'],['111','Миллилитр'],['163','Грамм'],['112','Литр'],['166','Килограмм']];
const profile = (key, label, props) => (
  <Form.Item name={['profile', key]} label={label}><Input maxLength={300} {...props} /></Form.Item>
);
const choice = (key, label, entries, placeholder) => (
  <Form.Item name={['profile', key]} label={label}>
    <Select options={options(entries)} placeholder={placeholder} allowClear />
  </Form.Item>
);
const money = <InputNumber min={0} precision={2} controls={false} placeholder="0,00" suffix="₽" />;

const categories = categoryDefinitions.filter(category=>category.kind);
const keyFor = value => String(value ?? '').trim().toLocaleLowerCase('ru').replaceAll('ё','е');
export function productCategories(products) {
  const entries = new Map(categories.map(({title,kind}) => [keyFor(title),{label:title,kind}]));
  for (const { profile, kind } of products) {
    const label = profile?.category?.trim();
    if (label && !entries.has(keyFor(label))) entries.set(keyFor(label),{label,kind:kind==='liquid'?'other':kind});
  }
  return [...entries.values()];
}
export function categoryKind(category,products) {
  return productCategories(products).find(row=>keyFor(row.label)===keyFor(category))?.kind ?? 'other';
}
export function defaultCategory(key) {
  return categories.find(category=>category.key===key)?.title ?? '';
}
export function catalogCategory(product) {
  const label = keyFor(product.profile?.category);
  const defined = categories.find(category=>keyFor(category.title)===label);
  if (defined) return defined.key;
  if (['готовые распивы','готовый распив'].includes(label)) return 'decant';
  return product.kind;
}

async function preparePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>10_000_000)
    throw new Error('Выберите JPG, PNG или WebP до 10 МБ');
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1,1000/Math.max(image.width,image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.width*scale));
    canvas.height = Math.max(1,Math.round(image.height*scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.86);
  } finally { image.close(); }
}


export default function CreateProductFields({ products, form, api, onPhotoBusy, onChange, disabled, product }) {
  const [description, setDescription] = useState(false);
  const [stock, setStock] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [showRelated, setShowRelated] = useState(Boolean(product?.profile?.related_products?.length));
  const [generating, setGenerating] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileInput = useRef(null);
  const { message } = App.useApp();
  const details = ['profile','creation_details'];
  const photo = Form.useWatch([...details,'photo'],form);
  const displayedPhoto = photo || product?.image;
  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoLoading(true);onPhotoBusy(true);
    try { form.setFieldValue([...details,'photo'],await preparePhoto(file)); onChange(); }
    catch(error) { message.error(error.message || 'Не удалось открыть фото'); }
    finally { setPhotoLoading(false);onPhotoBusy(false); }
  }
  async function generateBarcode() {
    setGenerating(true);
    try {
      const { barcode } = await api('/api/product/barcode',{});
      const field = ['profile','barcode'];
      if (!form.getFieldValue(field)) form.setFieldValue(field,barcode);
      else {
        const extra = [...details,'barcodes'];
        const current = form.getFieldValue(extra) || [];
        if (current.length>=19) throw new Error('Можно добавить до 20 штрихкодов');
        form.setFieldValue(extra,[...current,barcode]);
      }
      onChange();
    } catch(error) { message.error(error.message); }
    finally { setGenerating(false); }
  }
  async function loadStock() {
    setShowRelated(true);
    if (stock || stockLoading) return;
    setStockLoading(true);
    try { setStock((await api('/api/product/card-options',{})).stock); }
    catch(error) { message.error(error.message); }
    finally { setStockLoading(false); }
  }

  return <div className="create-product-fields">
    <div className="create-product-top">
      <Form.Item name={['profile','good_type']} label="Тип товара" rules={[{required:true}]}>
        <Select options={options([['product','Товар'],['bundle','Комплект']])} />
      </Form.Item>
      <Form.Item name={['profile','category']} label="Категория"
        rules={[{required:true,whitespace:true,message:'Укажите категорию'}]}>
        <AutoComplete allowClear placeholder="Выберите или введите категорию"
          options={productCategories(products).map(({label})=>({ value:label }))}
          filterOption={(input,option)=>keyFor(option?.value).includes(keyFor(input))} />
      </Form.Item>
    </div>

    <div className="create-product-main">
      <div>
        <button type="button" className="create-product-photo" disabled={disabled||photoLoading}
          aria-label={displayedPhoto?"Изменить фото":"Загрузить фото"} title={displayedPhoto?"Изменить фото":"Загрузить фото"} onClick={()=>fileInput.current?.click()}>
          {displayedPhoto ? <img src={displayedPhoto} alt="Фото товара" /> :
            <><span className="create-photo-icon"><CameraFilled /></span><span>Загрузить фото</span></>}
        </button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp"
          style={{display:'none'}} onChange={selectPhoto} />
        <Form.Item name={[...details,'photo']} hidden><Input /></Form.Item>
        {photo&&<Button type="text" onClick={()=>{form.setFieldValue([...details,'photo'],undefined);onChange();}}>Убрать фото</Button>}
      </div>
      <div>
        <div className="create-product-barcode">
          {profile('barcode', 'Штрихкод', { placeholder: 'Введите штрихкод', maxLength:14, inputMode:'numeric' })}
          <Button icon={<BarcodeOutlined/>} onClick={generateBarcode} loading={generating}>Сгенерировать</Button>
        </div>
        <Form.List name={[...details,'barcodes']}>
          {(fields,{add,remove})=><>
            {fields.map(({key,name,...field})=><div className="create-product-barcode" key={key}>
              <Form.Item {...field} name={name} label="Дополнительный штрихкод" rules={[{required:true}]}>
                <Input maxLength={14} inputMode="numeric" />
              </Form.Item>
              <Button icon={<DeleteOutlined/>} aria-label="Удалить штрихкод" onClick={()=>remove(name)} />
            </div>)}
            <Button className="create-barcode-add" type="link" icon={<PlusOutlined/>}
              disabled={fields.length>=19} onClick={()=>add('')}>Добавить штрихкод</Button>
          </>}
        </Form.List>
        <Form.Item name="name" label="Наименование"
          rules={[{ required: true, whitespace: true, message: 'Поле не должно быть пустым' }]}>
          <Input placeholder="Введите наименование" maxLength={300} />
        </Form.Item>
        <div className="create-product-description">
          {profile('short_name', 'Краткое наименование', { placeholder: 'Введите наименование' })}
          <Button htmlType="button" color="primary" variant="outlined"
            aria-expanded={description} onClick={() => setDescription(!description)}>
            {description ? 'Свернуть описание' : 'Добавить описание'}
          </Button>
        </div>
        <div hidden={!description}>
          <Form.Item name={['profile','description']} label="Описание">
            <Input.TextArea rows={2} maxLength={5000} />
          </Form.Item>
        </div>
        <div className="create-product-three">
          {profile('vendor_code', 'Артикул', { placeholder: 'Введите артикул' })}
          <Form.Item name={['profile','purchase_price']} label="Цена закупки">{money}</Form.Item>
          <Form.Item name="sale" label="Цена продажи">{money}</Form.Item>
        </div>
      </div>
    </div>

    <section>
      <h3>Дополнительная информация</h3>
      <div className="create-product-three create-product-narrow">
        {choice('payment_subject','Предмет расчёта',[['1','Товар'],['4','Услуга']])}
        {profile('vat','НДС',{ placeholder: 'НДС не облагается' })}
        {choice('unit_code','Единица измерения',units)}
      </div>
      <div className="create-product-checks">
        {Object.entries({adult:'Товар 18+',weighted:'Дробное количество',focus:'Фокусный товар'})
          .map(([key,label]) => <Form.Item key={key} name={['profile',key]} valuePropName="checked"><Checkbox>{label}</Checkbox></Form.Item>)}
      </div>
      <div className="create-product-details">
        <div className="create-product-two">
          {profile('shelf_life','Срок годности',{ placeholder: 'Нет' })}
          {choice('shelf_unit','Единица срока',[['hour','Час'],['day','День'],['month','Месяц'],['year','Год']],'Час')}
        </div>
        <Form.Item><Checkbox disabled>Автоматически списывать по FIFO</Checkbox></Form.Item>
        <div className="create-product-two">
          {profile('pack_qty','Количество в упаковке',{ placeholder: 'Нет' })}
          {choice('pack_unit','Единица упаковки',units,'Не выбрано')}
        </div>
        {choice('mark_type','Маркировка',[['0','Нет'],['5','Парфюмерия']],'Нет')}
        <Form.Item name={['profile','gtin']} label="GTIN" rules={[{ pattern: /^\d{14}$/, message: 'GTIN: 14 цифр' }]}>
          <Input maxLength={14} placeholder="Введите GTIN" />
        </Form.Item>
        {profile('agent_type','Признак агента',{ placeholder: 'Не выбран' })}
        <Form.Item label="Поставщик"><Input disabled placeholder="Не выбран" /></Form.Item>
        <Form.Item label="Код страны"><Input disabled placeholder="Введите код страны" /></Form.Item>
        <Form.Item label="Номер ГТД"><Input disabled placeholder="Введите ГТД" /></Form.Item>
        <Form.Item label="Код PLU"><Input disabled placeholder="Введите код PLU" /></Form.Item>
        <div className="create-product-two">
          <Form.Item name="code" label="Внутренний код">
            <Input maxLength={60} placeholder="Присваивается автоматически" />
          </Form.Item>
          <Form.Item name="capacity" label="Объём, мл">
            <InputNumber min={0.001} precision={3} controls={false} />
          </Form.Item>
        </div>
        <Form.Item name="note" label="Заметка"><Input.TextArea rows={2} maxLength={1500} /></Form.Item>
      </div>
    </section>

    <section>
      <h3>Сотрудники</h3>
      <div className="create-product-details">
        <Form.Item name={[...details,"kpi"]} label="Баллы KPI"><InputNumber min={0} max={1000000} precision={2} placeholder="Введите баллы KPI" /></Form.Item>
      </div>
    </section>
    <section>
      <h3>Варианты <Button disabled>Добавить вариант</Button></h3>
      <Empty className="create-product-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Характеристики пока не подключены" />
    </section>
    <section>
      <h3>Сопутствующие товары <Button onClick={loadStock} loading={stockLoading}>Добавить товар</Button></h3>
            {showRelated ? <Form.Item name={[...details,'related']} label="Товары в наличии">
        <Select mode="multiple" maxCount={30} showSearch optionFilterProp="label"
          placeholder="Найдите товар по названию или коду"
          loading={stockLoading} notFoundContent="Нет подходящих товаров в остатках"
          options={[...(stock||[]),...products.filter(p=>product?.profile?.related_products?.includes(p.id)&&!stock?.some(row=>row.id===p.id))].map(({id,name,code})=>({value:id,label:code+' · '+name}))} />
      </Form.Item> : <Empty className="create-product-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Добавьте сопутствующие товары" />}
    </section>
    <section>
      <h3>Торговые объекты</h3>
      <Table size="small" bordered pagination={false} rowKey="name"
        dataSource={['Склад','ПАРИ БОТЭ','ПАРФЮМЕРИ'].map(name=>({name}))}
        columns={[{title:'Торговый объект',dataIndex:'name'}]} />
    </section>
  </div>;
}
