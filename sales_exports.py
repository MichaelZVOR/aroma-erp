"""Portable OOXML exports: no cloud account or office installation required."""
import io,zipfile,re
from decimal import Decimal
from xml.sax.saxutils import escape

GROUPS={'bottle':'Полноразмерные флаконы','decant':'Распив','atom':'Атомайзеры','other':'Прочие товары'}
PAYMENTS={'cash':'Наличные','card':'Карта','mixed':'Наличные и карта'}
def clean(v):return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(v if v is not None else ''))
def x(v):return escape(clean(v))
def num(v):
 if v is None:return '—'
 return format(Decimal(str(v)),'.2f').rstrip('0').rstrip('.').replace('.',',')
def rub(v):return num(Decimal(v)/100)+' ₽'
def pct(v):return '—' if v is None else num(v)+'%'
def archive(parts):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  for name,value in parts.items():z.writestr(name,value.encode('utf-8'))
 return b.getvalue()
def col(index):
 out=''
 while index:index,n=divmod(index-1,26);out=chr(65+n)+out
 return out
def xlsx(doc,versions):
 totals=doc['payload']['totals'];rows=doc['payload']['rows']
 summary=[['Документ продаж',str(doc['id'])],['Дата',doc['date']],['Версия',doc['revision']],['Статус','Сохранён' if doc['status']=='posted' else 'Аннулирован'],['Примечание',doc['note']],['Выручка',totals['revenue']/100],['Наличные',totals['cash']/100],['Карта',totals['card']/100],['Скидки',totals['discount']/100],['Себестоимость',totals['cost']/100],['Валовая прибыль',totals['gross']/100],['Эквайринг',totals['fee']/100],['После эквайринга',totals['remaining']/100],['Валовая маржа, %',None if totals['margin'] is None else float(totals['margin'])],['Наценка, %',None if totals['markup'] is None else float(totals['markup'])],['Учёт','Остаток после эквайринга не является чистой прибылью. Склад не списывается.']]
 headers=['№','Товар','Группа','Кол-во','Оплата','Тариф, %','Цена до скидки, ₽','Цена покупателю, ₽','Скидка, ₽','Выручка, ₽','Себестоимость, ₽','Валовая прибыль, ₽','Наценка, %','Валовая маржа, %','Эквайринг, ₽','После эквайринга, ₽','Источник себестоимости']
 lines=[headers]
 for i,r in enumerate(rows,1):lines.append([i,r['name'],GROUPS.get(r['group_name'],r['group_name']),r['qty'],PAYMENTS[r['payment']],float(r['rate']),r['list_price']/100,r['price']/100,r['discount']/100,r['revenue']/100,r['cost']/100,r['gross']/100,None if r['markup'] is None else float(r['markup']),None if r['margin'] is None else float(r['margin']),r['fee']/100,r['remaining']/100,'Из CSV, предварительная' if r['cost_source']=='csv' else 'Введена вручную'])
 lines.append(['ИТОГО','','',sum(r['qty'] for r in rows),'','',None,None,totals['discount']/100,totals['revenue']/100,totals['cost']/100,totals['gross']/100,None if totals['markup'] is None else float(totals['markup']),None if totals['margin'] is None else float(totals['margin']),totals['fee']/100,totals['remaining']/100,''])
 changes=[['Версия','Изменено','Причина','Статус']]+[[v['revision'],v['changed_at'],v['reason'],'Сохранён' if v['document']['status']=='posted' else 'Аннулирован'] for v in reversed(versions)]
 def sheet(data,widths,filtering=False):
  body=[]
  for i,row in enumerate(data,1):
   cells=[]
   for j,value in enumerate(row,1):
    ref=col(j)+str(i);style=2 if i==1 else 1 if isinstance(value,(int,float,Decimal)) and ((filtering and j not in (1,4)) or (len(data[0])==2 and i>=6)) else 0
    if value is None:cells.append('<c r="'+ref+'"/>')
    elif isinstance(value,(int,float,Decimal)):cells.append(f'<c r="{ref}" s="{style}"><v>{value}</v></c>')
    else:cells.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{x(value)}</t></is></c>')
   body.append('<row r="'+str(i)+'">'+''.join(cells)+'</row>')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+''.join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i,w in enumerate(widths,1))+'</cols><sheetData>'+''.join(body)+'</sheetData>'+('<autoFilter ref="A1:'+col(len(data[0]))+str(len(data)-1)+'"/>' if filtering else '')+'<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>'
 ns='http://schemas.openxmlformats.org/package/2006/relationships'
 parts={'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,4))+'</Types>',
 '_rels/.rels':f'<Relationships xmlns="{ns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Итоги" sheetId="1" r:id="rId1"/><sheet name="Продажи" sheetId="2" r:id="rId2"/><sheet name="История" sheetId="3" r:id="rId3"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="1">\'Продажи\'!$1:$1</definedName></definedNames></workbook>',
 'xl/_rels/workbook.xml.rels':f'<Relationships xmlns="{ns}">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,4))+'<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF284568"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
 'xl/worksheets/sheet1.xml':sheet(summary,[35,90]),'xl/worksheets/sheet2.xml':sheet(lines,[6,48,23,9,14,12,18,18,17,18,18,18,14,16,17,22,26],True),'xl/worksheets/sheet3.xml':sheet(changes,[10,30,70,20])}
 return archive(parts)

def docx(doc,versions):
 def p(text,bold=False,size=20):return '<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r><w:rPr>'+('<w:b/>' if bold else '')+f'<w:sz w:val="{size}"/></w:rPr><w:t xml:space="preserve">'+x(text)+'</w:t></w:r></w:p>'
 def table(headers,rows,widths):
  head='<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>'+''.join(f'<w:{k} w:val="single" w:sz="4" w:color="D9E2EC"/>' for k in ('top','left','bottom','right','insideH','insideV'))+'</w:tblBorders></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)+'</w:tblGrid>'
  body=[]
  for i,row in enumerate([headers]+rows):
   cells=[]
   for j,value in enumerate(row):cells.append(f'<w:tc><w:tcPr><w:tcW w:w="{widths[j]}" w:type="dxa"/>'+('<w:shd w:fill="E8EEF5"/>' if i==0 else '')+'</w:tcPr>'+p(value,i==0,18)+'</w:tc>')
   body.append('<w:tr>'+('<w:trPr><w:tblHeader/></w:trPr>' if i==0 else '')+''.join(cells)+'</w:tr>')
  return '<w:tbl>'+head+''.join(body)+'</w:tbl>'+p('')
 rows=doc['payload']['rows'];t=doc['payload']['totals']
 body=p('Документ продаж № '+str(doc['id']),True,32)+p('Дата: '+doc['date']+'   •   Версия: '+str(doc['revision'])+'   •   '+('Сохранён' if doc['status']=='posted' else 'АННУЛИРОВАН'),True)
 if doc['note']:body+=p('Примечание: '+doc['note'])
 body+=table(['Показатель','Сумма'],[[a,rub(t[b])] for a,b in [('Выручка','revenue'),('Наличные','cash'),('Карта','card'),('Скидки','discount'),('Себестоимость','cost'),('Валовая прибыль','gross'),('Эквайринг','fee'),('После эквайринга','remaining')]]+[['Валовая маржа',pct(t['margin'])],['Наценка',pct(t['markup'])]],[5000,3000])
 body+=p('Проданные позиции',True,24)
 body+=table(['№','Товар','Кол-во','Оплата','Цена / шт.','Скидка','К оплате'],[[i,r['name'],r['qty'],PAYMENTS[r['payment']],rub(r['price']),rub(r['discount']),rub(r['revenue'])] for i,r in enumerate(rows,1)],[450,5000,650,1200,1600,1600,1600])
 body+=p('Финансовые показатели по строкам',True,24)
 body+=table(['№','Себестоимость','Валовая прибыль','Наценка','Валовая маржа','Тариф карты','Эквайринг','После эквайринга'],[[i,rub(r['cost']),rub(r['gross']),pct(r['markup']),pct(r['margin']),pct(r['rate']),rub(r['fee']),rub(r['remaining'])] for i,r in enumerate(rows,1)],[450,1700,1800,1300,1500,1400,1700,2250])
 if any(r['cost_source']=='csv' for r in rows):body+=p('Внимание: есть предварительная себестоимость из CSV. Прибыль и маржа по таким строкам также предварительные.',True)
 body+=p('Остаток после эквайринга не является чистой прибылью. Комиссия продавцу и реклама не вычитаются. Документ не списывает складские остатки.')
 body+=p('История документа',True,24)+table(['Версия','Изменено','Причина'],[[v['revision'],v['changed_at'],v['reason']] for v in reversed(versions)],[1000,3500,7600])
 document='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="650" w:right="650" w:bottom="650" w:left="650" w:header="300" w:footer="300"/></w:sectPr></w:body></w:document>'
 return archive({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':document})
def export(doc,kind,versions):
 if kind=='xlsx':return xlsx(doc,versions),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','sales-'+str(doc['id'])+'-v'+str(doc['revision'])+'.xlsx'
 if kind=='docx':return docx(doc,versions),'application/vnd.openxmlformats-officedocument.wordprocessingml.document','sales-'+str(doc['id'])+'-v'+str(doc['revision'])+'.docx'
 raise ValueError('Выберите формат Excel или DOCX')
