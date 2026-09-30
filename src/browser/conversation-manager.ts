import type { CdpTab } from './cdp-client.js'
import { listTabs } from './cdp-client.js'
export interface BrowserConversation { sessionId:string; accountId:string; tabId:string; url:string; createdAt:string; lastUsedAt:string }
export class BrowserConversationManager {
 private readonly map=new Map<string,BrowserConversation>()
 bind(sessionId:string,accountId:string,tab:CdpTab){const now=new Date().toISOString();const old=this.map.get(sessionId);const value={sessionId,accountId,tabId:tab.id,url:tab.url,createdAt:old?.createdAt??now,lastUsedAt:now};this.map.set(sessionId,value);return value}
 get(sessionId:string){return this.map.get(sessionId)}
 unbind(sessionId:string){this.map.delete(sessionId)}
 clearAccount(accountId:string){for(const [id,v] of this.map)if(v.accountId===accountId)this.map.delete(id)}
 async findTab(port:number,sessionId:string,accountId:string){const binding=this.map.get(sessionId);const tabs=await listTabs(port);if(binding?.accountId===accountId){const current=tabs.find(t=>t.id===binding.tabId);if(current){binding.url=current.url;binding.lastUsedAt=new Date().toISOString();return current}}return tabs.find(t=>/^https:\/\/(chat\.)?(deepseek|chatgpt)\.com/i.test(t.url))??null}
}