import {request} from 'node:http'

export interface CdpTab { id:string; url:string; title:string; webSocketDebuggerUrl?:string }
export interface CdpClient {
 evaluate<T>(expression:string):Promise<T>
 setFileInputFiles(selector:string,files:readonly string[]):Promise<void>
 screenshot():Promise<{data:string;width?:number;height?:number}>
 close():Promise<void>
}

export async function listTabs(port:number):Promise<CdpTab[]>{
 const raw=await httpGet(port,'/json/list')
 return JSON.parse(raw) as CdpTab[]
}
export async function connectTab(tab:CdpTab):Promise<CdpClient>{
 if(!tab.webSocketDebuggerUrl)throw new Error('目标 Chromium 页面没有 CDP WebSocket')
 const ws=new WebSocket(tab.webSocketDebuggerUrl);await waitOpen(ws)
 let id=0
 const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:any)=>void}>()
 const rejectPending=(error:Error)=>{for(const p of pending.values())p.reject(error);pending.clear()}
 ws.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.id&&pending.has(m.id)){const p=pending.get(m.id)!;pending.delete(m.id);m.error?p.reject(new Error(m.error.message||'CDP error')):p.resolve(m.result)}}
 ws.addEventListener('close',()=>rejectPending(new Error('CDP WebSocket 已断开')))
 ws.addEventListener('error',()=>rejectPending(new Error('CDP WebSocket 发生错误')))
 const call=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});try{ws.send(JSON.stringify({id:n,method,params}))}catch(error){pending.delete(n);reject(error)}})
 await call('Runtime.enable')
 await call('Page.enable')
 return {
  async evaluate<T>(expression:string){
   const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
   if(result.exceptionDetails){
    throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'页面脚本执行失败')
   }
   return result.result?.value as T
  },
  async screenshot(){
   const result=await call('Page.captureScreenshot',{format:'jpeg',quality:72})
   return {data:result.data as string}
  },
  async setFileInputFiles(selector:string,files:readonly string[]){
   await call('DOM.enable')
   const root=await call('DOM.getDocument',{depth:1})
   const node=await call('DOM.querySelector',{nodeId:root.root.nodeId,selector})
   if(!node?.nodeId)throw new Error('PAGE_CHANGED: 未找到浏览器文件上传控件')
   await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[...files]})
   await call('Runtime.evaluate',{expression:`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}})()`})
  },
  async close(){rejectPending(new Error('CDP closed'));ws.close()}
 }
}
function httpGet(port:number,path:string):Promise<string>{return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path},res=>{const a:Buffer[]=[];res.on('data',c=>a.push(Buffer.from(c)));res.on('end',()=>res.statusCode===200?resolve(Buffer.concat(a).toString('utf8')):reject(new Error('CDP HTTP '+res.statusCode)))});req.on('error',reject);req.end()})}
function waitOpen(ws:WebSocket){return new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve(),{once:true});ws.addEventListener('error',()=>reject(new Error('无法连接 Chromium CDP')),{once:true})})}


import {randomUUID} from 'node:crypto'
import type {AccountProvider} from '../types.js'
import {PROVIDER_MAP} from '../provider-catalog.js'

type BridgePending={id:string;provider:AccountProvider;expression:string;createdAt:number;claimed:boolean;resolve:(value:unknown)=>void;reject:(error:Error)=>void}
export interface BrowserBridgeRequest{id:string;provider:AccountProvider;expression:string}

/** 将现有 CdpClient API 转接到 DSH 右侧原生 Electron <webview>。 */
export class WebviewBrowserBridge {
 private pending=new Map<string,BridgePending>()
 private readonly timeoutMs=30000

 async evaluate<T>(provider:AccountProvider,expression:string):Promise<T>{
  const id=randomUUID()
  return new Promise<T>((resolve,reject)=>{
   this.pending.set(id,{id,provider,expression,createdAt:Date.now(),claimed:false,resolve:resolve as (value:unknown)=>void,reject})
   setTimeout(()=>this.expire(id),this.timeoutMs)
  })
 }

 next():BrowserBridgeRequest|undefined{
  this.expireAll()
  const item=[...this.pending.values()].find(x=>!x.claimed)
  if(!item)return undefined
  item.claimed=true
  return {id:item.id,provider:item.provider,expression:item.expression}
 }

 resolve(id:string,value:unknown){const item=this.pending.get(id);if(!item)return;this.pending.delete(id);item.resolve(value)}
 reject(id:string,message:string){const item=this.pending.get(id);if(!item)return;this.pending.delete(id);item.reject(new Error(message))}

 connect(provider:AccountProvider):CdpClient{
  return {
   evaluate:<T>(expression:string)=>this.evaluate<T>(provider,expression),
   async setFileInputFiles(){throw new Error('当前 DSH 原生 Browser Bridge 暂不支持文件上传，请使用右侧浏览器手工上传')},
   async screenshot(){throw new Error('当前 DSH 原生 Browser Bridge 暂不支持截图')},
   async close(){},
  }
 }

 providerHost(provider:AccountProvider){return PROVIDER_MAP[provider].hostPattern.source}

 dispose(){for(const item of this.pending.values())item.reject(new Error('Browser Bridge 已关闭'));this.pending.clear()}

 private expire(id:string){
  const item=this.pending.get(id)
  if(item&&Date.now()-item.createdAt>=this.timeoutMs){
   this.pending.delete(id)
   item.reject(new Error('SERVICE_UNAVAILABLE: DSH 右侧浏览器操作超时，请检查当前 Provider 页面'))
  }
 }
 private expireAll(){for(const id of this.pending.keys())this.expire(id)}
}
