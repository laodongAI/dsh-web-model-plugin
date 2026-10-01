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
 resolve:(value:unknown)=>void
 reject:(error:Error)=>void
}

export class WebviewBrowserBridge {
 private readonly pending=new Map<string,Pending>()
 private readonly timeoutMs=45000

 evaluate<T>(provider:AccountProvider,expression:string):Promise<T>{
  const id=randomUUID()
  return new Promise<T>((resolve,reject)=>{
   this.pending.set(id,{id,provider,expression,createdAt:Date.now(),claimed:false,
    resolve:resolve as (value:unknown)=>void,reject})
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
   async setFileInputFiles(){throw new Error('当前使用 DSH 右侧原生 Browser，文件上传请先在右侧浏览器手工完成')},
   async close(){},
  }
 }

 dispose(){
  for(const item of this.pending.values())item.reject(new Error('Browser Bridge 已关闭'))
  this.pending.clear()
 }

 private expire(id:string){
  const item=this.pending.get(id)
  if(item&&Date.now()-item.createdAt>=this.timeoutMs){
   this.pending.delete(id)
   item.reject(new Error('SERVICE_UNAVAILABLE: DSH 右侧浏览器操作超时，请检查当前 Provider 页面'))
  }
 }

 private expireAll(){for(const id of this.pending.keys())this.expire(id)}
}
