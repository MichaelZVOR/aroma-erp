// Browser transport used by Aroma itself; isolated profile, normal Chrome, no login or stealth.
const fs=require('node:fs');
(async()=>{
 let context;
 try{
  const request=JSON.parse(fs.readFileSync(0,'utf8'));
  const {chromium}=require(request.playwright);
  const valid=url=>{try{const p=new URL(url);return p.protocol==='https:'&&!p.username&&!p.password&&(!p.port||p.port==='443')&&(p.hostname===request.host||p.hostname==='www.'+request.host);}catch{return false;}};
  if(!valid(request.url))throw Error('Адрес страницы не разрешён.');
  context=await chromium.launchPersistentContext(request.profile,{channel:'chrome',headless:false,chromiumSandbox:true,acceptDownloads:false,ignoreHTTPSErrors:false,proxy:{server:request.proxy},args:['--start-minimized','--proxy-bypass-list=<-loopback>'],timeout:20000});
  context.setDefaultTimeout(65000);
  await context.route('**/*',async route=>{
   const req=route.request();
   if(req.isNavigationRequest()&&req.frame()===req.frame().page().mainFrame()&&!valid(req.url()))return route.abort();
   if(['image','media','font'].includes(req.resourceType()))return route.abort();
   return route.continue();
  });
  const page=context.pages()[0]||await context.newPage();
  page.on('dialog',d=>d.dismiss());
  await page.goto(request.url,{waitUntil:'domcontentloaded',timeout:40000}).catch(e=>{if(!/Timeout/.test(e.name))throw e;});
  await page.waitForFunction(()=>{
   const title=document.title.toLowerCase(),body=document.body?.innerText||'';
   if(/captcha|подтвердите, что вы не робот|access denied|доступ ограничен/i.test(title+' '+body.slice(0,600)))return true;
   if(/checking device|checking.*browser/i.test(title))return false;
   return !!document.querySelector('tr[itemprop="offers"],[data-test-id="price-info-block"],a[href*="/product/"],a[href^="/19"],a[href^="/26"]')||/не найден|ничего не наш|результаты поиска/i.test(body);
  },null,{timeout:65000}).catch(()=>{});
  const title=await page.title();
  if(/checking device|checking.*browser|captcha|access denied/i.test(title))throw Object.assign(Error('Сайт требует проверки в браузере. Проверка не завершилась автоматически.'),{status:'blocked'});
  if(!valid(page.url()))throw Error('Магазин перенаправил на неразрешённый адрес.');
  let html=await page.content();
  if(request.site==='goldapple'&&await page.locator('h1').count()&&await page.locator('[data-test-id="price-info-block"]').count()){
   const snapshots=[];
   const collect=()=>page.evaluate(()=>{
    const block=document.querySelector('[data-test-id="price-info-block"]');
    const price=block?.querySelector('[data-test-id="price"]');
    const values=[...price?.querySelectorAll('[class*="_ga-price_"]')||[]].map(x=>x.textContent.trim());
    return {ml:document.querySelector('input[name="units"]:checked')?.value,title:document.title,values,conditional:!!block?.querySelector('[data-test-id="auth-link-in-price-block"]'),available:block?.querySelector('[itemprop="availability"]')?.getAttribute('href'),url:location.href};
   });
   snapshots.push(await collect());
   const values=await page.locator('input[name="units"]').evaluateAll(xs=>xs.map(x=>x.value));
   for(const value of values.slice(0,8)){
    if(value===snapshots[0].ml)continue;
    await page.locator('input[name="units"]').filter({visible:true}).count();
    await page.locator('input[name="units"][value="'+value.replace(/[^0-9.]/g,'')+'"]').check({force:true,timeout:6000});
    await page.waitForFunction(v=>document.title.includes(v+' мл')&&document.querySelector('input[name="units"]:checked')?.value===v,value,{timeout:12000});
    snapshots.push(await collect());
   }
   const encoded=JSON.stringify(snapshots).replace(/</g,'\\u003c');
   html+='\n<script type="application/json" id="aroma-browser-offers">'+encoded+'</script>';
  }
  process.stdout.write(JSON.stringify({html,url:page.url()}));
 }catch(e){process.stdout.write(JSON.stringify({status:e.status||(/Timeout/i.test(e.name)?'browser_timeout':'browser_error'),error:String(e.message||e).slice(0,450)}));}
 finally{if(context)await context.close().catch(()=>{});}
})();
