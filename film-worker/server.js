import express from 'express';
import Database from 'better-sqlite3';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
app.use(express.json({ limit: '2mb' }));
const PORT = Number(process.env.PORT || 10000);
const TOKEN = String(process.env.MLIMANI_INTERNAL_TOKEN || '');
const AGNES_KEY = String(process.env.AGNES_API_KEY || '');
const AGNES_BASE = String(process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com').replace(/\/+$/, '');
const MODEL = 'agnes-video-2.5-flash'; // Never silently fall back to a paid model.
const DATA_DIR = path.resolve(process.env.FILM_DATA_DIR || './film-data');
const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'film-worker.db'));
db.pragma('journal_mode = WAL');
db.exec(`
 CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL,
  scenes_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0,
  completed_scenes INTEGER NOT NULL DEFAULT 0, total_scenes INTEGER NOT NULL,
  output_path TEXT, output_key TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS clips (
  job_id TEXT NOT NULL, clip_index INTEGER NOT NULL, scene_index INTEGER NOT NULL,
  part_index INTEGER NOT NULL, seconds INTEGER NOT NULL, video_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
  file_path TEXT, PRIMARY KEY(job_id,clip_index)
 );
`);
const s3 = process.env.R2_ENDPOINT && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
 ? new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } })
 : null;
const bucket = process.env.R2_BUCKET || '';
const active = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const auth = (req,res,next) => {
 if (!TOKEN || req.headers.authorization !== 'Bearer ' + TOKEN) return res.status(403).json({ error:'Hapana.' });
 next();
};
const transient = new Set([408,429,500,502,503,504,520,522,524]);
async function agnes(pathname, options={}) {
 let last;
 for (let attempt=0; attempt<5; attempt++) {
  try {
   const response = await fetch(AGNES_BASE + pathname, { ...options, signal: AbortSignal.timeout(90000),
    headers: { Authorization:'Bearer '+AGNES_KEY, ...(options.headers||{}) } });
   const body = await response.json().catch(()=>({}));
   if (!response.ok) {
    const error = new Error(body.error?.message || body.message || body.error || 'Agnes API request failed.');
    error.status = response.status;
    if (!transient.has(response.status) || attempt===4) throw error;
    last = error;
   } else return body;
  } catch(error) {
   last=error;
   if (error.status && !transient.has(error.status)) throw error;
   if (attempt===4) throw error;
  }
  await sleep(Math.min(30000, 1500 * (2 ** attempt)));
 }
 throw last || new Error('Agnes API haijibu.');
}
function chunksFor(scenes) {
 const result=[];
 for (let sceneIndex=0; sceneIndex<scenes.length; sceneIndex++) {
  const scene=scenes[sceneIndex], duration=Number(scene.duration);
  const pieces=duration<=12?[duration]:[Math.floor(duration/2), duration-Math.floor(duration/2)];
  for (let partIndex=0;partIndex<pieces.length;partIndex++) {
   const seconds=pieces[partIndex];
   if(seconds<4||seconds>12) throw new Error('Scene '+(sceneIndex+1)+' haiwezi kugawanywa katika vipande vinavyokubalika na Agnes.');
   result.push({sceneIndex,partIndex,seconds,prompt:String(scene.prompt).trim(),aspectRatio:scene.aspectRatio||'16:9'});
  }
 }
 return result;
}
function runFfmpeg(args) {
 return new Promise((resolve,reject)=>{
  if(!ffmpegPath) return reject(new Error('FFmpeg binary haikupatikana.'));
  const child=spawn(ffmpegPath,args,{stdio:['ignore','ignore','pipe']});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-5000)});
  child.on('error',reject);
  child.on('close',code=>code===0?resolve():reject(new Error('FFmpeg imeshindwa: '+stderr.slice(-1200))));
 });
}
async function getClip(clip, jobDir) {
 const file=path.join(jobDir,'clip-'+clip.clip_index+'.mp4');
 if(clip.status==='completed' && fs.existsSync(file)) return file;
 let videoId=clip.video_id;
 if(!videoId) {
  const created=await agnes('/v1/videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   model:MODEL, prompt:clip.prompt, mode:'text', seconds:String(clip.seconds), size:'720P',
   aspect_ratio:clip.aspect_ratio || '16:9', n:1
  })});
  videoId=created.video_id || created.id;
  if(!videoId) throw new Error('Agnes haikurudisha video_id. Hakuna modeli ya kulipia itakayotumika kama mbadala.');
  db.prepare('UPDATE clips SET video_id=?,status=? WHERE job_id=? AND clip_index=?').run(videoId,'submitted',clip.job_id,clip.clip_index);
 }
 let result=null;
 for(let attempt=0;attempt<240;attempt++) {
  result=await agnes('/agnesapi?video_id='+encodeURIComponent(videoId)+'&model_name='+encodeURIComponent(MODEL));
  const status=String(result.status||'').toLowerCase();
  if(status==='completed') break;
  if(status==='failed'||status==='cancelled') throw new Error(result.error || 'Agnes imeshindwa kutengeneza clip.');
  await sleep(10000);
 }
 if(String(result?.status||'').toLowerCase()!=='completed'||!result.url) throw new Error('Agnes haikukamilisha clip ndani ya muda ulioruhusiwa.');
 const response=await fetch(result.url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok) throw new Error('Imeshindikana kupakua clip kutoka Agnes.');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length<1024) throw new Error('Clip iliyorejeshwa ni ndogo au si video halali.');
 fs.writeFileSync(file,bytes);
 db.prepare("UPDATE clips SET status='completed',file_path=? WHERE job_id=? AND clip_index=?").run(file,clip.job_id,clip.clip_index);
 return file;
}
async function processJob(jobId) {
 if(active.has(jobId)) return;
 active.add(jobId);
 const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
 if(!job) {active.delete(jobId);return;}
 const jobDir=path.join(DATA_DIR,'work',jobId);
 fs.mkdirSync(jobDir,{recursive:true});
 try {
  db.prepare("UPDATE jobs SET status='processing',error=NULL,updated_at=? WHERE id=?").run(Date.now(),jobId);
  const scenes=JSON.parse(job.scenes_json);
  const chunks=chunksFor(scenes);
  const insert=db.prepare('INSERT OR IGNORE INTO clips(job_id,clip_index,scene_index,part_index,seconds,status) VALUES(?,?,?,?,?,\'queued\')');
  chunks.forEach((c,i)=>insert.run(jobId,i,c.sceneIndex,c.partIndex,c.seconds,'queued'));
  const clipRows=db.prepare('SELECT * FROM clips WHERE job_id=? ORDER BY clip_index').all(jobId);
  const files=[];
  for(let i=0;i<clipRows.length;i++) {
   const clip={...clipRows[i],...chunks[i],job_id:jobId};
   const file=await getClip(clip,jobDir);
   files.push(file);
   const done=clipRows.filter(x=>x.status==='completed' && fs.existsSync(x.file_path||'')).length + 1;
   const progress=Math.min(94,Math.round((done/clipRows.length)*90));
   const completedScenes=new Set(clipRows.filter(x=>x.status==='completed').map(x=>x.scene_index));
   completedScenes.add(clip.scene_index);
   db.prepare('UPDATE jobs SET progress=?,completed_scenes=?,updated_at=? WHERE id=?').run(progress,completedScenes.size,Date.now(),jobId);
  }
  const list=path.join(jobDir,'concat.txt');
  fs.writeFileSync(list,files.map(file=>"file '"+file.replace(/'/g,"'\\''")+"'").join('\n'));
  const output=path.join(OUTPUT_DIR,jobId+'.mp4');
  await runFfmpeg(['-y','-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-movflags','+faststart',output]);
  let outputKey=null;
  if(s3) {
   outputKey='films/'+job.owner_id+'/'+jobId+'.mp4';
   await s3.send(new PutObjectCommand({Bucket:bucket,Key:outputKey,Body:fs.createReadStream(output),ContentType:'video/mp4'}));
  }
  db.prepare("UPDATE jobs SET status='completed',progress=100,completed_scenes=total_scenes,output_path=?,output_key=?,updated_at=? WHERE id=?")
   .run(output,outputKey,Date.now(),jobId);
 } catch(error) {
  console.error('Film job failed',jobId,error);
  db.prepare("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?").run(String(error.message||'Uzalishaji umeshindwa.').slice(0,1000),Date.now(),jobId);
 } finally { active.delete(jobId); }
}
app.get('/health',(_req,res)=>res.json({ok:true,provider:AGNES_KEY?'agnes-configured':'agnes-key-missing',model:MODEL,storage:s3?'r2':'temporary'}));
app.post('/jobs',auth,(req,res)=>{
 if(!AGNES_KEY) return res.status(503).json({error:'AGNES_API_KEY haijawekwa kwenye Film Worker.'});
 const ownerId=String(req.body?.ownerId||'').slice(0,80), title=String(req.body?.title||'Mlimani Film').slice(0,120);
 const scenes=req.body?.scenes;
 if(!ownerId||!Array.isArray(scenes)||!scenes.length||scenes.length>120) return res.status(400).json({error:'Taarifa za filamu si sahihi.'});
 const total=scenes.reduce((n,s)=>n+Number(s.duration||0),0);
 if(total<60||total>1800||scenes.some(s=>!String(s.prompt||'').trim()||![5,15].includes(Number(s.duration)))) return res.status(400).json({error:'Scenes lazima ziwe na muda wa sekunde 5 au 15 na jumla dakika 1 hadi 30.'});
 const id=randomUUID(),now=Date.now();
 db.prepare('INSERT INTO jobs(id,owner_id,title,language,scenes_json,status,total_scenes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,ownerId,title,String(req.body.language||'sw'),JSON.stringify(scenes),'queued',scenes.length,now,now);
 setImmediate(()=>processJob(id));
 res.status(202).json({jobId:id,status:'queued',totalScenes:scenes.length});
});
app.get('/jobs/:id',auth,(req,res)=>{
 const job=db.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').get(req.params.id,String(req.query.ownerId||''));
 if(!job) return res.status(404).json({error:'Kazi haipatikani.'});
 res.json({jobId:job.id,status:job.status,progressPercent:job.progress,completedScenes:job.completed_scenes,totalScenes:job.total_scenes,title:job.title,error:job.error,output:job.status==='completed'?{ready:true}:null});
});
app.get('/jobs/:id/download',auth,async(req,res)=>{
 const job=db.prepare("SELECT * FROM jobs WHERE id=? AND owner_id=? AND status='completed'").get(req.params.id,String(req.query.ownerId||''));
 if(!job) return res.status(404).json({error:'Filamu bado haijakamilika.'});
 if(job.output_key&&s3) {
  const url=await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:job.output_key}),{expiresIn:600});
  return res.json({url,expiresIn:600});
 }
 return res.json({localFile:true,expiresIn:600});
});
app.get('/jobs/:id/file',auth,(req,res)=>{
 const job=db.prepare("SELECT * FROM jobs WHERE id=? AND owner_id=? AND status='completed'").get(req.params.id,String(req.query.ownerId||''));
 if(!job) return res.status(404).json({error:'Filamu haijakamilika.'});
 if(job.output_key&&s3) return res.status(409).json({error:'Faili hili linapatikana kupitia kiungo salama cha R2.'});
 if(!job.output_path||!fs.existsSync(job.output_path)) return res.status(404).json({error:'Faili la video halipo tena kwenye storage ya muda.'});
 res.type('mp4').download(job.output_path,'mlimani-film.mp4');
});
const server=app.listen(PORT,'0.0.0.0',()=>{
 console.log('Mlimani Film Worker listening on '+PORT+'; Agnes model '+MODEL+'; storage '+(s3?'R2':'temporary'));
 if(!TOKEN) console.warn('MLIMANI_INTERNAL_TOKEN is missing; protected job routes will reject requests.');
 db.prepare("UPDATE jobs SET status='queued',updated_at=? WHERE status='processing'").run(Date.now());
 db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at").all().forEach(j=>setImmediate(()=>processJob(j.id)));
});
function shutdown(){server.close(()=>{db.close();process.exit(0)});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
