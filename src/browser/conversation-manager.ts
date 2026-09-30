import type {CdpTab} from './cdp-client.js'
import {listTabs} from './cdp-client.js'
export type BrowserConversationStatus='bound'|'desynced'
export interface BrowserConversation{
 sessionId:string;accountId:string;tabId:string;url:string;conversationId?:string;
 createdAt:string;lastUsedAt:string;status:BrowserConversationStatus
}
export class BrowserConversationManager{
 private readonly map=new Map<string,BrowserConversation>()
 private readonly uploaded=new Map<string,Set<string>>()
 bind(sessionId:string,accountId:string,tab:CdpTab,conversationId?:string){
  const now=new Date().toISOString(),old=this.map.get(sessionId)
  const value={sessionId,accountId,tabId:tab.id,url:tab.url,conversationId,createdAt:old?.createdAt??now,lastUsedAt:now,status:'bound' as const}
  this.map.set(sessionId,value);return value
 }
 get(sessionId:string){return this.map.get(sessionId)}
 findByAccount(accountId:string){for(const v of this.map.values())if(v.accountId===accountId)return v}
 markDesynced(sessionId:string){const v=this.map.get(sessionId);if(v)v.status='desynced'}
 unbind(sessionId:string){this.map.delete(sessionId);this.uploaded.delete(sessionId)}
 clearAccount(accountId:string){for(const [id,v] of this.map)if(v.accountId===accountId){this.map.delete(id);this.uploaded.delete(id)}}
 unuploaded(sessionId:string,paths:readonly string[]){const seen=this.uploaded.get(sessionId)??new Set<string>();return paths.filter(p=>!seen.has(p))}
 markUploaded(sessionId:string,paths:readonly string[]){const seen=this.uploaded.get(sessionId)??new Set<string>();for(const p of paths)seen.add(p);this.uploaded.set(sessionId,seen)}
 async findTab(port:number,sessionId:string,accountId:string){
  const binding=this.map.get(sessionId),tabs=await listTabs(port)
  if(binding?.accountId===accountId){
   const current=tabs.find(t=>t.id===binding.tabId)
   if(current){binding.url=current.url;binding.lastUsedAt=new Date().toISOString();return current}
  }
  return tabs.find(t=>/^https:\/\/(chat\.)?(deepseek|chatgpt)\.com|^https:\/\/chat\.qwen\.ai/i.test(t.url))??null
 }
}