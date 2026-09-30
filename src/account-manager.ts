import {randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {AccountStore} from './account-store.js'
import {BrowserManager,type BrowserManagerConfig} from './browser-manager.js'
import type {AccountProvider,AccountSnapshot} from './types.js'
import {DefaultBrowserProvider} from './providers/browser-provider.js'
import type {WebPageTiming} from './providers/web-page.js'
import {WebAiConfigStore} from './web-ai-config.js'
import {PROVIDER_MAP} from './provider-catalog.js'

export class AccountManager {
 readonly rootDir=join(homedir(),'.dsh','account-models')
 private store=new AccountStore(this.rootDir)
 private browser:BrowserManager
 private configStore=new WebAiConfigStore(this.rootDir)
 private providers=new Map<string,DefaultBrowserProvider>()

 constructor(browserConfig:BrowserManagerConfig={cdpReadyTimeoutMs:20000},private readonly pageTiming:WebPageTiming={streamTimeoutMs:180000,noStartTimeoutMs:60000,uploadTimeoutMs:15000}){
  this.browser=new BrowserManager(browserConfig)
 }

 async init(){await this.store.load();await this.configStore.load()}

 list():AccountSnapshot[]{return this.store.list().map(a=>({...a,browserRunning:this.browser.isRunning(a.id)}))}

 getConfig(){return this.configStore.get()}

 async setConfig(value:Pick<ReturnType<WebAiConfigStore['get']>,'defaultProvider'|'defaultAccountId'>){
  if(value.defaultAccountId){
   const account=this.store.get(value.defaultAccountId)
   if(!account)throw new Error('默认 Web AI 账号不存在')
   if(value.defaultProvider&&account.provider!==value.defaultProvider)throw new Error('默认 Provider 与账号不匹配')
  }
  if(value.defaultProvider&&!value.defaultAccountId){
   const account=this.store.list().find(a=>a.provider===value.defaultProvider)
   if(!account)throw new Error('该 Provider 尚未添加浏览器账号')
   value={...value,defaultAccountId:account.id}
  }
  return this.configStore.set(value)
 }

 getDefaultAccount(){
  const c=this.configStore.get()
  if(!c.defaultAccountId)return undefined
  const a=this.store.get(c.defaultAccountId)
  return a?{...a,browserRunning:this.browser.isRunning(a.id)}:undefined
 }

 async add(provider:AccountProvider,displayName?:string){
  const id=randomUUID()
  const now=new Date().toISOString()
  const profileDir=join(this.rootDir,provider,id,'profile')
  const port=await this.browser.open(id,provider,profileDir)
  const a={
   id,
   provider,
   displayName:displayName?.trim()||PROVIDER_MAP[provider].name,
   profileDir,
   debugPort:port,
   status:'login_required' as const,
   createdAt:now,
   updatedAt:now
  }
  await this.store.upsert(a)
  this.providers.set(id,new DefaultBrowserProvider(provider,port,undefined,this.pageTiming))
  return this.snapshot(id)!
 }

 async open(id:string){
  const a=this.require(id)
  const port=await this.browser.open(id,a.provider,a.profileDir)
  await this.store.upsert({...a,debugPort:port,status:'unknown',updatedAt:new Date().toISOString()})
  if(!this.providers.has(id))this.providers.set(id,new DefaultBrowserProvider(a.provider,port,undefined,this.pageTiming))
  return this.snapshot(id)!
 }

 async checkReady(id:string){
  const a=this.require(id)
  if(!this.browser.isRunning(id))await this.open(id)
  const p=this.providers.get(id)
  if(!p)throw new Error('Provider 未初始化')
  const ready=await p.checkReady()
  await this.store.upsert({...a,status:ready?'ready':'login_required',updatedAt:new Date().toISOString(),lastError:undefined})
  return this.snapshot(id)!
 }

 async close(id:string){
  const a=this.require(id)
  await this.browser.close(id)
  this.providers.delete(id)
  await this.store.upsert({...a,status:'browser_closed',updatedAt:new Date().toISOString()})
  return this.snapshot(id)!
 }

 async remove(id:string){
  this.require(id)
  await this.browser.close(id)
  this.providers.delete(id)
  await this.store.remove(id)
 }

 getProvider(id:string){this.require(id);return this.providers.get(id)}

 async screenshot(id:string){
  const a=this.require(id)
  if(!this.browser.isRunning(id))await this.open(id)
  const p=this.providers.get(id)
  if(!p)throw new Error('Provider 未初始化')
  return p.screenshot()
 }

 snapshot(id:string){
  const a=this.store.get(id)
  return a?{...a,browserRunning:this.browser.isRunning(id)}:undefined
 }

 async dispose(){await this.browser.closeAll()}

 private require(id:string){
  const a=this.store.get(id)
  if(!a)throw new Error('账号不存在: '+id)
  return a
 }
}
