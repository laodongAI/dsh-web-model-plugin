import {IncomingMessage,ServerResponse} from 'node:http'
import type {AccountManager} from './account-manager.js'
import type {AccountProvider} from './types.js'
import {PROVIDER_MAP} from './provider-catalog.js'
import type {WebviewBrowserBridge} from './browser/webview-bridge.js'

const SUPPORTED:readonly AccountProvider[]=['deepseek','chatgpt','qwen','tencent-yuanbao','doubao','perplexity','copilot','huggingchat','kimi','chatglm']
// 请求体上限 1MB，防止超大 body 打爆内存
const MAX_BODY_BYTES=1024*1024

type Route={kind:'exact'|'prefix';path:string;handler:(q:IncomingMessage,s:ServerResponse)=>void|Promise<void>}

export function registerRoutes(m:AccountManager,bridge:WebviewBrowserBridge,register:(r:Route)=>()=>void){
 const routes:Route[]=[
  {kind:'exact',path:'/api/dsh-account-models/accounts',handler:async(q,s)=>{if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405);return json(s,m.list())}},
  {kind:'exact',path:'/api/dsh-account-models/active-provider',handler:async(q,s)=>{
   if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405)
   const provider=m.getSelectedProvider()
   if(!provider)return json(s,{provider:null})
   const account=m.findByProvider(provider)
   return json(s,{provider,name:PROVIDER_MAP[provider].name,url:PROVIDER_MAP[provider].url,status:account?.status??'not_initialized',accountId:account?.id??null})
  }},
  {kind:'exact',path:'/api/dsh-account-models/browser/check',handler:async(q,s)=>{
   if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
   try{
    const b=await body(q) as {provider?:AccountProvider}
    if(!b.provider||!SUPPORTED.includes(b.provider))return json(s,{error:'provider 不受支持'},400)
    return json(s,await m.checkProvider(b.provider))
   }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
  }},
  {kind:'exact',path:'/api/dsh-account-models/browser/bridge/next',handler:async(q,s)=>{
   if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405)
   // visible 查询参数：Client 上报的当前可见 Provider 列表，用于对已关闭 Tab 的挂起请求快速失败
   const params=new URL(q.url??'/','http://localhost').searchParams
   const visible= params.has('visible')?params.get('visible')!.split(',').filter(Boolean) as AccountProvider[]:undefined
   const sessionId=params.get('sessionId')??undefined
   const request=bridge.next(visible,sessionId)
   return json(s,request??{id:null})
  }},
  {kind:'exact',path:'/api/dsh-account-models/browser/bridge/result',handler:async(q,s)=>{
   if(q.method!=='POST')return json(s,{error:'Method Not Allowed'},405)
   try{
    const b=await body(q) as {id?:string;ok?:boolean;value?:unknown;error?:string}
    if(!b.id)return json(s,{error:'id 必填'},400)
    if(b.ok)bridge.resolve(b.id,b.value)
    else bridge.reject(b.id,b.error??'DSH Browser evaluate failed')
    return json(s,{ok:true})
   }catch(error){return json(s,{error:error instanceof Error?error.message:String(error)},400)}
  }},
  // bridge 观测端点：查看队列长度/claimed 数/最老请求年龄/按 Provider 分布，诊断积压
  {kind:'exact',path:'/api/dsh-account-models/browser/bridge/stats',handler:async(q,s)=>{
   if(q.method!=='GET')return json(s,{error:'Method Not Allowed'},405)
   return json(s,bridge.stats())
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

 const disposers:(()=>void)[]=[]
 try{
  for(const route of routes)disposers.push(register(route))
 }catch(error){
  for(const dispose of disposers.reverse()){
   try{dispose()}catch(disposeError){console.error('[dsh-account-models] route rollback failed:',disposeError)}
  }
  throw error
 }
 return()=>{
  for(const dispose of disposers.splice(0).reverse()){
   try{dispose()}catch(error){console.error('[dsh-account-models] route disposal failed:',error)}
  }
 }
}

async function body(q:IncomingMessage){
 const chunks:Buffer[]=[]
 let total=0
 for await(const chunk of q){
  const buf=Buffer.from(chunk)
  total+=buf.length
  // 超限立即报错，不继续缓冲，防止超大 body 打爆内存
  if(total>MAX_BODY_BYTES)throw new Error('请求体过大')
  chunks.push(buf)
 }
 return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}
}

function json(s:ServerResponse,value:unknown,status=200){
 s.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
 s.end(JSON.stringify(value))
}
