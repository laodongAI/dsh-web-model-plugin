import {randomUUID} from 'node:crypto'
import type {AccountProvider} from '../types.js'
import type {CdpClient} from './cdp-client.js'

export interface BrowserBridgeRequest {id:string;provider:AccountProvider;expression:string}

interface Pending {
 id:string
 provider:AccountProvider
 expression:string
 createdAt:number
 claimed:boolean
 timeout:number  // 本条请求的执行超时（毫秒）
 resolve:(value:unknown)=>void
 reject:(error:Error)=>void
}

const MAX_PENDING=256
// 单条表达式最长执行超时上限，防止调用方传超大 timeout 阻塞队列
const MAX_TIMEOUT_MS=120000

export class WebviewBrowserBridge {
 private readonly pending=new Map<string,Pending>()
 // 默认单次 DOM 表达式执行超时；可被 evaluate 的 timeoutMs 参数覆盖
 private readonly timeoutMs=15000
 // 可选分级日志回调（由插件入口注入 cordis logger：debug/info/warn/error）
 constructor(private readonly log:(level:'debug'|'info'|'warn'|'error',message:string)=>void=()=>{}){}

 evaluate<T>(provider:AccountProvider,expression:string,timeoutMs?:number):Promise<T>{
  // 队列上限防护：积压过多直接拒绝，避免内存无限增长
  if(this.pending.size>=MAX_PENDING){
   this.log('error','bridge queue full, rejecting evaluate')
   return Promise.reject(new Error('SERVICE_UNAVAILABLE: Browser Bridge 队列已满，请稍后重试'))
  }
  const id=randomUUID()
  const timeout=Math.min(timeoutMs??this.timeoutMs,MAX_TIMEOUT_MS)
  return new Promise<T>((resolve,reject)=>{
   this.pending.set(id,{id,provider,expression,createdAt:Date.now(),claimed:false,timeout,
    resolve:resolve as (value:unknown)=>void,reject})
   this.log('debug',`bridge evaluate queued: provider=${provider} id=${id} timeout=${timeout}`)
   // unref 防止 timer 阻止进程退出
   const timer=setTimeout(()=>this.expire(id),timeout)
   ;(timer as unknown as {unref?:()=>void}).unref?.()
  })
 }

 /** Client 轮询取任务；reportVisible=Client 上报的当前可见 Provider，目标 Provider 不在其中时快速失败挂起请求（Tab 已被关闭，避免空等超时） */
 next(reportVisible?:readonly AccountProvider[]):BrowserBridgeRequest|undefined{
  this.expireAll()
  if(reportVisible){
   const visible=new Set(reportVisible)
   for(const item of this.pending.values()){
    if(item.claimed||visible.has(item.provider))continue
    this.pending.delete(item.id)
    this.log('info',`bridge fast-fail: provider=${item.provider} 页面不可见（Tab 可能被关闭） id=${item.id}`)
    item.reject(new Error('BROWSER_NOT_READY: DSH 右侧浏览器没有当前 Provider 的页面（Tab 可能已被关闭），请重新打开后重试'))
   }
  }
  const item=[...this.pending.values()].find(x=>!x.claimed)
  if(!item)return undefined
  item.claimed=true
  return {id:item.id,provider:item.provider,expression:item.expression}
 }

 resolve(id:string,value:unknown){const item=this.pending.get(id);if(!item)return;this.pending.delete(id);this.log('debug',`bridge resolve: id=${id}`);item.resolve(value)}
 reject(id:string,message:string){const item=this.pending.get(id);if(!item)return;this.pending.delete(id);this.log('warn',`bridge reject: id=${id} error=${message}`);item.reject(new Error(message))}

 connect(provider:AccountProvider):CdpClient{
  return {
   evaluate:<T>(expression:string,timeoutMs?:number)=>this.evaluate<T>(provider,expression,timeoutMs),
   async setFileInputFiles(){throw new Error('当前使用 DSH 右侧原生 Browser，文件上传请先在右侧浏览器手工完成')},
   async close(){},
  }
 }

 /** 观测数据：队列长度/claimed 数/最老请求年龄/按 Provider 分布，供 stats 端点诊断积压 */
 stats(){
  const byProvider:Record<string,number>={}
  let claimed=0,oldest=0
  const now=Date.now()
  for(const item of this.pending.values()){
   byProvider[item.provider]=(byProvider[item.provider]??0)+1
   if(item.claimed)claimed++
   const age=now-item.createdAt
   if(age>oldest)oldest=age
  }
  return {pending:this.pending.size,claimed,queued:this.pending.size-claimed,oldestAgeMs:oldest,byProvider}
 }

 dispose(){
  for(const item of this.pending.values())item.reject(new Error('Browser Bridge 已关闭'))
  this.pending.clear()
 }

 private expire(id:string){
  const item=this.pending.get(id)
  if(item&&Date.now()-item.createdAt>=item.timeout){
   this.pending.delete(id)
   this.log('error',`bridge timeout: id=${id} provider=${item.provider}`)
   item.reject(new Error('SERVICE_UNAVAILABLE: DSH 右侧浏览器操作超时，请检查当前 Provider 页面'))
  }
 }

 private expireAll(){for(const id of [...this.pending.keys()])this.expire(id)}
}
