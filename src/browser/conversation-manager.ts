import type {CdpTab} from './cdp-client.js'
import {listTabs} from './cdp-client.js'
import type {AccountProvider} from '../types.js'
import {PROVIDER_MAP} from '../provider-catalog.js'

export type BrowserConversationStatus='bound'|'desynced'
export interface BrowserConversation{
 sessionId:string;accountId:string;tabId:string;url:string;conversationId?:string;
 createdAt:string;lastUsedAt:string;status:BrowserConversationStatus
}

export class BrowserConversationManager{
 private readonly map=new Map<string,BrowserConversation>()
 private readonly uploaded=new Map<string,Set<string>>()
 private readonly busy=new Map<string,string>()

 begin(accountId:string,sessionId:string){
  const owner=this.busy.get(accountId)
  if(owner&&owner!==sessionId)throw new Error('PAGE_CHANGED: 当前账号正在处理另一个 DSH 会话，请稍后重试')
  this.busy.set(accountId,sessionId)
 }

 end(accountId:string,sessionId:string){
  if(this.busy.get(accountId)===sessionId)this.busy.delete(accountId)
 }

 bind(sessionId:string,accountId:string,tab:CdpTab,conversationId?:string){
  const now=new Date().toISOString(),old=this.map.get(sessionId)
  const value={sessionId,accountId,tabId:tab.id,url:tab.url,conversationId,createdAt:old?.createdAt??now,lastUsedAt:now,status:'bound' as const}
  this.map.set(sessionId,value)
  return value
 }

 get(sessionId:string){return this.map.get(sessionId)}

 findByAccount(accountId:string){
  for(const v of this.map.values())if(v.accountId===accountId)return v
 }

 markDesynced(sessionId:string){const v=this.map.get(sessionId);if(v)v.status='desynced'}

 unbind(sessionId:string){this.map.delete(sessionId);this.uploaded.delete(sessionId)}

 clearAccount(accountId:string){
  for(const [id,v] of this.map)if(v.accountId===accountId){this.map.delete(id);this.uploaded.delete(id)}
  this.busy.delete(accountId)
 }

 unuploaded(sessionId:string,paths:readonly string[]){
  const seen=this.uploaded.get(sessionId)??new Set<string>()
  return paths.filter(p=>!seen.has(p))
 }

 markUploaded(sessionId:string,paths:readonly string[]){
  const seen=this.uploaded.get(sessionId)??new Set<string>()
  for(const p of paths)seen.add(p)
  this.uploaded.set(sessionId,seen)
 }

 async findTab(port:number,sessionId:string,accountId:string,provider:AccountProvider){
  const binding=this.map.get(sessionId),tabs=await listTabs(port)
  if(binding?.accountId===accountId){
   const current=tabs.find(t=>t.id===binding.tabId)
   if(current){binding.url=current.url;binding.lastUsedAt=new Date().toISOString();return current}
  }
  const pattern=PROVIDER_MAP[provider].hostPattern
  return tabs.find(t=>pattern.test(t.url))??null
 }
}
