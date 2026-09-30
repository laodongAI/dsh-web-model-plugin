import {randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {AccountStore} from './account-store.js'
import {BrowserManager} from './browser-manager.js'
import type {AccountProvider,AccountSnapshot} from './types.js'
import {DefaultBrowserProvider} from './providers/browser-provider.js'
export class AccountManager {
 readonly rootDir=join(homedir(),'.dsh','account-models')
 private store=new AccountStore(this.rootDir); private browser=new BrowserManager()
 private providers=new Map<string,DefaultBrowserProvider>()
 async init(){await this.store.load()}
 list():AccountSnapshot[]{return this.store.list().map(a=>({...a,browserRunning:this.browser.isRunning(a.id)}))}
 async add(provider:AccountProvider,displayName?:string){const id=randomUUID();const now=new Date().toISOString();const profileDir=join(this.rootDir,provider,id,'profile');const port=await this.browser.open(id,provider,profileDir);const a={id,provider,displayName:displayName?.trim()||(provider==='chatgpt'?'ChatGPT':provider==='qwen'?'Qwen':provider==='tencent-yuanbao'?'腾讯混元 AI Studio':provider==='doubao'?'豆包':provider==='perplexity'?'Perplexity':provider==='copilot'?'Microsoft Copilot':provider==='huggingchat'?'HuggingChat':provider==='chatglm'?'智谱 AI':'Kimi'),profileDir,debugPort:port,status:'login_required' as const,createdAt:now,updatedAt:now};await this.store.upsert(a);this.providers.set(id,new DefaultBrowserProvider(provider,port));return this.snapshot(id)!}
 async open(id:string){const a=this.require(id);const port=await this.browser.open(id,a.provider,a.profileDir);await this.store.upsert({...a,debugPort:port,status:'unknown',updatedAt:new Date().toISOString()});this.providers.set(id,new DefaultBrowserProvider(a.provider,port));return this.snapshot(id)!}
 async checkReady(id:string){const a=this.require(id);if(!this.browser.isRunning(id))await this.open(id);const p=this.providers.get(id);if(!p)throw new Error('Provider 未初始化');const ready=await p.checkReady();await this.store.upsert({...a,status:ready?'ready':'login_required',updatedAt:new Date().toISOString(),lastError:undefined});return this.snapshot(id)!}
 async close(id:string){const a=this.require(id);await this.browser.close(id);this.providers.delete(id);await this.store.upsert({...a,status:'browser_closed',updatedAt:new Date().toISOString()});return this.snapshot(id)!}
 async remove(id:string){this.require(id);await this.browser.close(id);this.providers.delete(id);await this.store.remove(id)}
 getProvider(id:string){this.require(id);return this.providers.get(id)}
 snapshot(id:string){const a=this.store.get(id);return a?{...a,browserRunning:this.browser.isRunning(id)}:undefined}
 async dispose(){await this.browser.closeAll()}
 private require(id:string){const a=this.store.get(id);if(!a)throw new Error('账号不存在: '+id);return a}
}