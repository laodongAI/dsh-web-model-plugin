import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from './account-store.js'
import { BrowserManager } from './browser-manager.js'
import type { AccountProvider,AccountSnapshot } from './types.js'
export class AccountManager {
  readonly rootDir=join(homedir(),'.dsh','account-models')
  private store=new AccountStore(this.rootDir); private browser=new BrowserManager()
  async init(){await this.store.load()}
  list():AccountSnapshot[]{return this.store.list().map(a=>({...a,browserRunning:this.browser.isRunning(a.id)}))}
  async add(provider:AccountProvider,displayName?:string){const id=randomUUID();const now=new Date().toISOString();const a={id,provider,displayName:displayName?.trim()||(provider==='chatgpt'?'ChatGPT':'DeepSeek'),profileDir:join(this.rootDir,provider,id,'profile'),status:'login_required' as const,createdAt:now,updatedAt:now};await this.store.upsert(a);await this.browser.open(id,provider,a.profileDir);return this.snapshot(id)!}
  async open(id:string){const a=this.require(id);await this.browser.open(id,a.provider,a.profileDir);return this.snapshot(id)!}
  async close(id:string){const a=this.require(id);await this.browser.close(id);await this.store.upsert({...a,status:'browser_closed',updatedAt:new Date().toISOString()});return this.snapshot(id)!}
  async remove(id:string){this.require(id);await this.browser.close(id);await this.store.remove(id)}
  snapshot(id:string){const a=this.store.get(id);return a?{...a,browserRunning:this.browser.isRunning(id)}:undefined}
  async dispose(){await this.browser.closeAll()}
  private require(id:string){const a=this.store.get(id);if(!a)throw new Error('账号不存在: '+id);return a}
}