import {IncomingMessage,ServerResponse} from 'node:http'
import type {AccountManager} from './account-manager.js'
import type {AccountProvider} from './types.js'

const SUPPORTED:readonly AccountProvider[]=['deepseek','chatgpt','qwen','tencent-yuanbao','doubao','perplexity','copilot','huggingchat','kimi','chatglm']

type Route={kind:'exact'|'prefix';path:string;handler:(q:IncomingMessage,s:ServerResponse)=>void|Promise<void>}

export function registerRoutes(m:AccountManager,register:(r:Route)=>()=>void){
 const routes:Route[]=[
  {kind:'exact',path:'/api/dsh-account-models/accounts',handler:async(q,s)=>{if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405);return json(s,m.list())}},
  {kind:'exact',path:'/api/dsh-account-models/browser/view',handler:async(q,s)=>{
   if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405)
   try{
    const id=new URL(q.url??'/', 'http://dsh.local').searchParams.get('accountId')||m.getDefaultAccount()?.id
    if(!id)return json(s,{error:'未配置默认 Web AI 账号'},400)
    const a=m.list().find(x=>x.id===id)
    if(!a)return json(s,{error:'账号不存在'},404)
    const shot=await m.screenshot(id)
    return json(s,{accountId:id,provider:a.provider,displayName:a.displayName,status:a.status,url:shot.url,title:shot.title,image:`data:image/jpeg;base64,${shot.data}`})
   }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
  }},
  {kind:'exact',path:'/api/dsh-account-models/config',handler:async(q,s)=>{
   if(q.method==='GET')return json(s,m.getConfig())
   if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
   try{return json(s,await m.setConfig(await body(q) as {defaultProvider?:AccountProvider;defaultAccountId?:string}))}
   catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
  }},
  {kind:'exact',path:'/api/dsh-account-models/accounts/add',handler:async(q,s)=>{
   if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
   try{
    const b=await body(q) as {provider?:AccountProvider;displayName?:string}
    if(!b.provider||!SUPPORTED.includes(b.provider))return json(s,{error:'provider 不受支持'},400)
    return json(s,await m.add(b.provider,b.displayName))
   }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},500)}
  }},
 ]

 for(const action of ['open','check','close'] as const){
  routes.push({kind:'exact',path:`/api/dsh-account-models/accounts/${action}`,handler:async(q,s)=>{
   if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
   try{
    const b=await body(q) as {accountId?:string}
    if(!b.accountId)return json(s,{error:'accountId 必填'},400)
    if(action==='open')return json(s,await m.open(b.accountId))
    if(action==='check')return json(s,await m.checkReady(b.accountId))
    return json(s,await m.close(b.accountId))
   }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
  }})
 }

 routes.push({kind:'exact',path:'/api/dsh-account-models/accounts/remove',handler:async(q,s)=>{
  if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
  try{
   const b=await body(q) as {accountId?:string}
   if(!b.accountId)return json(s,{error:'accountId 必填'},400)
   await m.remove(b.accountId)
   return json(s,{ok:true})
  }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
 }})

 return()=>routes.map(register).forEach(dispose=>dispose())
}

async function body(q:IncomingMessage){
 const chunks:Buffer[]=[]
 for await(const chunk of q)chunks.push(Buffer.from(chunk))
 return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}
}

function json(s:ServerResponse,value:unknown,status=200){
 s.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
 s.end(JSON.stringify(value))
}
