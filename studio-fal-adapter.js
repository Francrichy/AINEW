import { randomUUID } from 'node:crypto';

const TASKS = {
  image: ['FAL_IMAGE_MODEL','FAL_IMAGE_INPUT_TEMPLATE','fal_image_tzs','Image','per_image',['prompt']],
  video: ['FAL_VIDEO_MODEL','FAL_VIDEO_INPUT_TEMPLATE','fal_video_5s_tzs','Video','per_5_seconds',['prompt']],
  music: ['FAL_MUSIC_MODEL','FAL_MUSIC_INPUT_TEMPLATE','fal_music_minute_tzs','Music','per_minute',['prompt']],
  voice: ['FAL_VOICE_MODEL','FAL_VOICE_INPUT_TEMPLATE','fal_voice_minute_tzs','Voice','per_minute',['prompt']],
  speech: ['FAL_SPEECH_MODEL','FAL_SPEECH_INPUT_TEMPLATE','fal_speech_minute_tzs','Speech recognition','per_minute',['audioUrl']],
  animation: ['FAL_ANIMATION_MODEL','FAL_ANIMATION_INPUT_TEMPLATE','fal_animation_tzs','Animation','per_job',['prompt']],
  motion: ['FAL_MOTION_MODEL','FAL_MOTION_INPUT_TEMPLATE','fal_motion_second_tzs','Full-motion avatar','per_second',['prompt','imageUrl']],
  avatar_video: ['FAL_AVATAR_VIDEO_MODEL','FAL_AVATAR_VIDEO_INPUT_TEMPLATE','fal_avatar_video_second_tzs','Talking avatar · lip-sync','per_second',['imageUrl','audioUrl']]
};
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const json = async r => { const d=await r.json().catch(()=>({})); if(!r.ok) throw fail(String(d.detail||d.message||d.error||'fal.ai HTTP '+r.status).slice(0,500),r.status); return d; };
export function normalizeSupplierPrice(task,unit,unitPrice,exchangeRate) {
  const factors={image:{image:1,images:1},video:{second:5,seconds:5},music:{minute:1,minutes:1,second:60,seconds:60},voice:{minute:1,minutes:1,second:60,seconds:60},speech:{minute:1,minutes:1,second:60,seconds:60},animation:{request:1,requests:1,generation:1,generations:1},motion:{second:1,seconds:1},avatar_video:{second:1,seconds:1}};
  const normalized=String(unit||'').toLowerCase().trim(),factor=factors[task]?.[normalized];
  const price=Number(unitPrice),fx=Number(exchangeRate);
  if(!factor)throw fail('Unit ya fal.ai ni '+normalized+'; haiwezi kulinganishwa salama na kipimo cha Mlimani. Badili model au weka bei kwa mkono.',422);
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(fx)||fx<=0)throw fail('Bei ya supplier au kiwango cha USD/TZS si sahihi.',422);
  const providerCost=Math.round(price*factor*fx*1000000)/1000000;
  return {providerCost,customerPrice:Math.round(providerCost*3.5*1000000)/1000000,factor,unit:normalized};
}
export const modelPath = model => {
  const m=String(model||'').trim();
  if(!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,5}$/i.test(m)) throw fail('Admin hajaweka model ID sahihi ya fal.ai.',503);
  return m.split('/').map(encodeURIComponent).join('/');
};
const https = (v,label) => { if(!v)return ''; try{const u=new URL(String(v));if(u.protocol!=='https:')throw 0;return u.toString()}catch{throw fail(label+' lazima iwe HTTPS.')} };
export function makeInput(templateText,vars) {
  let t;try{t=JSON.parse(templateText)}catch{throw fail('Input template ya fal.ai si JSON sahihi.',503)}
  if(!t||typeof t!=='object'||Array.isArray(t))throw fail('Input template lazima iwe JSON object.',503);
  const token=/^\{\{(prompt|durationSeconds|aspectRatio|audioUrl|imageUrl|voiceId|language|resolution)\}\}$/;
  const walk=v=>{
    if(Array.isArray(v))return v.map(walk).filter(x=>x!==undefined);
    if(v&&typeof v==='object'){
      const out={};
      for(const [k,x] of Object.entries(v)){
        if(typeof x==='string'&&token.test(x)&&!vars[x.match(token)[1]])continue;
        const value=walk(x);if(value!==undefined)out[k]=value;
      }
      return out;
    }
    if(typeof v==='string'){
      const exact=v.match(token);if(exact)return vars[exact[1]]??'';
      return v.replace(/\{\{(prompt|durationSeconds|aspectRatio|audioUrl|imageUrl|voiceId|language|resolution)\}\}/g,(_m,k)=>String(vars[k]??''));
    }
    return v;
  };
  return walk(t);
}
export function registerStudioFalRoutes(app,{db,need,admin,env,cashWalletBalance,consumeWalletCredits,creditCashWallet}) {
  const now=()=>Date.now(), key=()=>env.FAL_API_KEY||env.FAL_KEY;
  db.exec(`CREATE TABLE IF NOT EXISTS studio_fal_config(task TEXT PRIMARY KEY,model TEXT NOT NULL DEFAULT '',input_template TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL)`);
  const config = task => {
    const row=db.prepare('SELECT model,input_template FROM studio_fal_config WHERE task=?').get(task);
    const t=TASKS[task];
    return { model:row?.model || env[t[0]] || '', template:row?.input_template || env[t[1]] || '' };
  };
  const price=k=>Number(db.prepare('SELECT customer_price FROM admin_pricing WHERE config_key=?').get(k)?.customer_price||0);
  for(const [id,t] of Object.entries(TASKS)){
    const [,,p,label,unit]=t;
    db.prepare("INSERT OR IGNORE INTO admin_pricing(config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at) VALUES(?,?,?, ?,0,0,'TZS',?,?)")
      .run(p,'fal.ai · '+label,'fal_'+id,unit,'Weka provider cost na bei ya mteja baada ya kuthibitisha model.',now());
  }
  db.exec("CREATE TABLE IF NOT EXISTS studio_fal_jobs(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,task TEXT NOT NULL,model TEXT NOT NULL,request_id TEXT NOT NULL,status TEXT NOT NULL,charge_tzs REAL NOT NULL,billing_status TEXT NOT NULL,result_json TEXT,output_url TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  const refund=(j,reason)=>{if(j.billing_status!=='reserved')return;creditCashWallet(db,j.user_id,j.charge_tzs,'studio-fal-refund:'+j.id,reason);db.prepare("UPDATE studio_fal_jobs SET status='FAILED',billing_status='refunded',error=?,updated_at=? WHERE id=?").run(String(reason).slice(0,500),now(),j.id)};
  const headers=()=>{if(!key())throw fail('Admin aweke FAL_API_KEY kwenye Render.',503);return {Authorization:'Key '+key(),'Content-Type':'application/json'}};
  const root=model=>'https://queue.fal.run/'+modelPath(model);
  const outputUrl=d=>[d?.video?.url,d?.audio?.url,d?.image?.url,d?.url,d?.images?.[0]?.url,d?.videos?.[0]?.url,d?.audios?.[0]?.url,d?.data?.url].find(x=>typeof x==='string'&&x.startsWith('https://'))||null;
  const view=j=>({jobId:j.id,task:j.task,status:j.status,outputUrl:j.output_url||null,result:j.result_json?JSON.parse(j.result_json):null,chargedTzs:j.charge_tzs,billingStatus:j.billing_status,error:j.error||null});
  const modelPresets = {
    image:['fal-ai/flux/schnell','fal-ai/flux/dev','fal-ai/flux-pro'],
    video:['minimax/h3-max/image-to-video'],
    music:['fal-ai/lyria2','fal-ai/minimax-music'],
    voice:['fal-ai/elevenlabs/tts','fal-ai/minimax/speech-2.6-hd'],
    speech:['fal-ai/whisper','fal-ai/elevenlabs/speech-to-text'],
    animation:['fal-ai/wan-i2v','fal-ai/minimax/video-01-live'],
    motion:['minimax/h3-max/reference-to-video'],
    avatar_video:['minimax/h3-max/lip-sync/image-to-video']
  };
  app.get('/api/admin/fal/config',admin,(_q,res)=>{
    res.set('Cache-Control','no-store');
    res.json({tasks:Object.entries(TASKS).map(([id,t])=>({id,label:t[3],model:config(id).model,template:config(id).template,modelVariable:t[0],templateVariable:t[1],priceKey:t[2],presets:modelPresets[id]||[]}))});
  });
  app.post('/api/admin/fal/config',admin,(req,res)=>{
    const task=String(req.body?.task||''), t=TASKS[task];
    if(!t)return res.status(400).json({error:'Huduma ya fal.ai haijulikani.'});
    const model=String(req.body?.model||'').trim(), template=String(req.body?.template||'').trim();
    try {
      modelPath(model);
      if(!template || template.length>20000)throw fail('Weka input template ya JSON isiyozidi 20KB.');
      makeInput(template,{prompt:'test',durationSeconds:5,aspectRatio:'16:9',audioUrl:'https://example.com/audio.mp3',imageUrl:'https://example.com/image.jpg',voiceId:'test',language:'sw',resolution:'768P'});
    } catch(e) { return res.status(400).json({error:e.message}); }
    db.prepare(`INSERT INTO studio_fal_config(task,model,input_template,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(task) DO UPDATE SET model=excluded.model,input_template=excluded.input_template,updated_at=excluded.updated_at`).run(task,model,template,now());
    res.json({ok:true,task,model,templateSaved:true});
  });
  // Sync live supplier price and convert it into the app's billing unit before applying x3.5.
  app.get('/api/admin/fal/pricing/:task',admin,async(req,res)=>{
    const task=String(req.params.task||''),t=TASKS[task];
    if(!t)return res.status(404).json({error:'Huduma ya fal.ai haijulikani.'});
    const model=String(config(task).model||'').trim();
    if(!model)return res.status(409).json({error:'Chagua na hifadhi model kwanza.'});
    if(!key())return res.status(503).json({error:'FAL_API_KEY haijawekwa kwenye Render.'});
    const fx=Number(db.prepare("SELECT customer_price FROM admin_pricing WHERE config_key='usd_tzs'").get()?.customer_price||0);
    if(!Number.isFinite(fx)||fx<=0)return res.status(409).json({error:'Weka kiwango halali cha USD/TZS kwenye Billing Admin kwanza.'});
    try{
      const url='https://api.fal.ai/v1/models/pricing?endpoint_id='+encodeURIComponent(model);
      const response=await fetch(url,{headers:{Authorization:'Key '+key(),Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      const data=await json(response);
      const item=(data.prices||[]).find(x=>String(x.endpoint_id||'')===model)||(data.prices||[])[0];
      if(!item||!Number.isFinite(Number(item.unit_price))||Number(item.unit_price)<=0)throw fail('fal.ai haijarudisha bei halali ya model hii.',404);
      const unit=String(item.unit||'').toLowerCase().trim(),currency=String(item.currency||'').toUpperCase();
      if(currency!=='USD')throw fail('Sarafu ya supplier ni '+(currency||'haijulikani')+'. Auto-conversion inahitaji bei ya USD.',422);
      const normalized=normalizeSupplierPrice(task,unit,item.unit_price,fx);
      const providerCost=normalized.providerCost,customerPrice=normalized.customerPrice,factor=normalized.factor;
      const stamp=now(),priceKey=t[2];
      const note=('fal.ai live price · '+model+' · USD '+item.unit_price+'/'+unit+' · FX '+fx+' TZS/USD · unit factor '+factor+' · synced '+new Date(stamp).toISOString()).slice(0,500);
      db.prepare("UPDATE admin_pricing SET provider_cost=?,customer_price=?,currency='TZS',notes=?,updated_at=? WHERE config_key=?").run(providerCost,customerPrice,note,stamp,priceKey);
      res.json({ok:true,task,model,sourceUnit:unit,sourceUnitPrice:Number(item.unit_price),currency:'USD',exchangeRate:fx,billingUnit:t[4],unitFactor:factor,providerCostTzs:providerCost,customerPriceTzs:customerPrice,markup:3.5,priceKey,updatedAt:stamp});
    }catch(e){res.status(e.status||502).json({error:'Imeshindikana kupata bei ya fal.ai: '+e.message.slice(0,350)});}
  });
  app.get('/api/admin/fal/status',admin,(_q,res)=>res.json({keyConfigured:!!key(),tasks:Object.entries(TASKS).map(([id,t])=>{const c=config(id);return {id,label:t[3],modelVariable:t[0],modelConfigured:!!c.model,templateVariable:t[1],templateConfigured:!!c.template,priceKey:t[2],priceConfigured:price(t[2])>0,ready:!!(key()&&c.model&&c.template&&price(t[2])>0)}})}));
  app.get('/api/studio/fal/:task/estimate',need,(req,res)=>{
    const t=TASKS[req.params.task];if(!t)return res.status(404).json({error:'Task haijulikani.'});
    const cfg=config(req.params.task);
    const secs=Math.max(req.params.task==='avatar_video'?5:2,Math.min(600,Math.round(+req.query.durationSeconds||5))),rate=price(t[2]);
    const units=t[4]==='per_5_seconds'?Math.ceil(secs/5):t[4]==='per_minute'?Math.ceil(secs/60):t[4]==='per_second'?secs:1,multiplier=req.params.task==='avatar_video'&&secs>15?1.2:1,charge=units*rate*multiplier;
    res.json({provider:'fal.ai',task:req.params.task,modelConfigured:!!cfg.model,templateConfigured:!!cfg.template,durationSeconds:secs,units,unit:t[4],customerPricePerUnitTzs:rate,pricingMultiplier:multiplier,estimatedChargeTzs:charge,walletBalanceTzs:cashWalletBalance(db,req.user.id),enabled:!!(key()&&cfg.model&&cfg.template&&rate>0&&cashWalletBalance(db,req.user.id)>=charge)});
  });
  app.post('/api/studio/fal/:task/jobs',need,async(req,res)=>{
    const taskId=req.params.task,t=TASKS[taskId];if(!t)return res.status(404).json({error:'Task haijulikani.'});
    let model,input,secs,charge,id;
    try{
      const cfg=config(taskId);model=String(cfg.model||'');const path=root(model);if(!key())throw fail('FAL_API_KEY haijawekwa kwenye Render.',503);if(!cfg.template)throw fail('Admin aweke input template kwenye Provider Management.',503);
      const prompt=String(req.body?.prompt||req.body?.text||'').trim().slice(0,6000);secs=Math.max(taskId==='avatar_video'?5:2,Math.min(600,Math.round(+req.body?.durationSeconds||5)));
      const vars={prompt,durationSeconds:secs,aspectRatio:['16:9','9:16','1:1','4:5','3:2','2:3'].includes(req.body?.aspectRatio)?req.body.aspectRatio:'16:9',audioUrl:https(req.body?.audioUrl,'Audio URL'),imageUrl:https(req.body?.imageUrl,'Image URL'),voiceId:String(req.body?.voiceId||'').slice(0,200),language:['sw','en'].includes(req.body?.language)?req.body.language:'',resolution:['768P','1080P','480P'].includes(req.body?.resolution)?req.body.resolution:'768P'};
      for(const v of t[5])if(!vars[v])throw fail(v==='audioUrl'?'Pakia sauti au weka kiungo cha sauti cha HTTPS.':v==='imageUrl'?'Pakia picha ya avatar au weka kiungo cha picha cha HTTPS.':'Andika maelezo ya video kwanza.');
      input=makeInput(cfg.template,vars);if(JSON.stringify(input).length>20000)throw fail('Input ni kubwa mno.',413);
      const rate=price(t[2]),units=t[4]==='per_5_seconds'?Math.ceil(secs/5):t[4]==='per_minute'?Math.ceil(secs/60):t[4]==='per_second'?secs:1,multiplier=taskId==='avatar_video'&&secs>15?1.2:1;charge=units*rate*multiplier;
      const dailyJobs=db.prepare('SELECT COUNT(*) AS n FROM studio_fal_jobs WHERE user_id=? AND created_at>?').get(req.user.id,now()-86400000).n;
      if(dailyJobs>=Math.max(1,Number(env.FAL_DAILY_JOBS||20)))throw fail('Umefikia kikomo cha kazi za fal.ai kwa saa 24. Jaribu baadaye.',429);
      if(charge<=0||Number(req.body?.expectedChargeTzs)!==charge)throw fail('Bei haijaidhinishwa au imebadilika. Kagua makadirio mapya.',409);
      if(cashWalletBalance(db,req.user.id)<charge)throw fail('Salio la Wallet halitoshi.',402);
      id=randomUUID();
    }catch(e){return res.status(e.status||400).json({error:e.message})}
    try{consumeWalletCredits(db,req.user.id,'cash',charge,'Mlimani fal.ai '+taskId+' reservation '+id)}catch(e){return res.status(402).json({error:'Salio la Wallet halitoshi.'})}
    try{
      const submitted=await json(await fetch(root(model),{method:'POST',headers:headers(),body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}));
      if(!submitted.request_id||!submitted.status_url||!submitted.response_url)throw fail('fal.ai haikurudisha queue request kamili.',502);
      if(new URL(submitted.status_url).hostname!=='queue.fal.run'||new URL(submitted.response_url).hostname!=='queue.fal.run')throw fail('fal.ai imerudisha URL isiyoruhusiwa.',502);
      db.prepare("INSERT INTO studio_fal_jobs(id,user_id,task,model,request_id,status,charge_tzs,billing_status,created_at,updated_at) VALUES(?,?,?,?,?,'IN_QUEUE',?,'reserved',?,?)").run(id,req.user.id,taskId,model,String(submitted.request_id),charge,now(),now());
      res.status(202).json({jobId:id,provider:'fal.ai',task:taskId,status:'IN_QUEUE',queuePosition:submitted.queue_position??null,chargedTzs:charge});
    }catch(e){try{creditCashWallet(db,req.user.id,charge,'studio-fal-refund:'+id,'Refund ya fal.ai iliyoshindwa kuanzishwa')}catch(x){console.error('fal refund failed',x.message)}res.status(e.status||502).json({error:'fal.ai imeshindwa kuanzisha kazi: '+e.message.slice(0,250)})}
  });
  app.get('/api/studio/fal/jobs/:id',need,async(req,res)=>{
    const j=db.prepare('SELECT * FROM studio_fal_jobs WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!j)return res.status(404).json({error:'Kazi haijapatikana.'});
    if(j.status==='COMPLETED'||j.status==='FAILED')return res.json(view(j));
    try{
      const url=root(j.model)+'/requests/'+encodeURIComponent(j.request_id),s=await json(await fetch(url+'/status',{headers:{Authorization:'Key '+key()},signal:AbortSignal.timeout(20000)}));
      if(s.status!=='COMPLETED'){db.prepare('UPDATE studio_fal_jobs SET status=?,updated_at=? WHERE id=?').run(s.status||'IN_PROGRESS',now(),j.id);return res.json({...view(j),status:s.status||'IN_PROGRESS',queuePosition:s.queue_position??null})}
      if(s.error||s.error_type){refund(j,'fal.ai generation imeshindwa: '+String(s.error||s.error_type));return res.json(view(db.prepare('SELECT * FROM studio_fal_jobs WHERE id=?').get(j.id)))}
      const result=await json(await fetch(url,{headers:{Authorization:'Key '+key()},signal:AbortSignal.timeout(60000)}));
      db.prepare("UPDATE studio_fal_jobs SET status='COMPLETED',billing_status='captured',result_json=?,output_url=?,updated_at=? WHERE id=?").run((JSON.stringify(result).length<=200000?JSON.stringify(result):JSON.stringify({truncated:true,outputUrl:outputUrl(result)})),outputUrl(result),now(),j.id);
      res.json(view(db.prepare('SELECT * FROM studio_fal_jobs WHERE id=?').get(j.id)));
    }catch(e){res.status(e.status||502).json({error:'Imeshindikana kupata matokeo ya fal.ai: '+e.message.slice(0,200)})}
  });
}
