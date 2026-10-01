import {randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {AccountStore} from './account-store.js'
import type {WebviewBrowserBridge} from './browser/webview-bridge.js'
import type {AccountProvider,AccountSnapshot} from './types.js'
import {DefaultBrowserProvider} from './providers/browser-provider.js'
import type {WebPageTiming} from './providers/web-page.js'
import {PROVIDER_MAP} from './provider-catalog.js'

export class AccountManager {
 readonly rootDir=join(homedir(),'.dsh','account-models')
 private store=new AccountStore(this.rootDir)
 private readonly bridge:WebviewBrowserBridge
 private providers=new Map<string,DefaultBrowserProvider>()
 private selectedProvider:AccountProvider|undefined

 constructor(bridge:WebviewBrowserBridge,private readonly pageTiming:WebPageTiming={streamTimeoutMs:180000,noStartTimeoutMs:60000,uploadTimeoutMs:15000}){
  this.bridge=bridge
 }

 async init(){await this.store.load()}

 list():AccountSnapshot[]{return this.store.list().map(a=>({...a,browserRunning:a.status!=='browser_closed'}))}

 selectProvider(provider:AccountProvider){this.selectedProvider=provider}
 getSelectedProvider(){return this.selectedProvider}

 async add(provider:AccountProvider,displayName?:string){
  const id=randomUUID()
  const now=new Date().toISOString()
  const profileDir=join(this.rootDir,provider,id)
  const port=0
  const a={
   id,
   provider,
   displayName:displayName?.trim()||PROVIDER_MAP[provider].name,
   profileDir,
   debugPort:port,
   status:'unknown' as const,
   createdAt:now,
   updatedAt:now
  }
  await this.store.upsert(a)
  this.providers.set(id,new DefaultBrowserProvider(provider,this.bridge.connect(provider),undefined,this.pageTiming))
  return this.snapshot(id)!
 }

 async open(id:string){
  const a=this.require(id)
  await this.store.upsert({...a,debugPort:0,status:'unknown',updatedAt:new Date().toISOString()})
  if(!this.providers.has(id))this.providers.set(id,new DefaultBrowserProvider(a.provider,this.bridge.connect(a.provider),undefined,this.pageTiming))
  return this.snapshot(id)!
 }

 async checkProvider(provider:AccountProvider){
  const account=await this.ensureProvider(provider)
  const adapter=this.providers.get(account.id)
  if(!adapter)throw new Error('Provider 未初始化')
  const health=await adapter.health()
  const status=health.status
  const snapshot=this.snapshot(account.id)
  if(snapshot)await this.store.upsert({...snapshot,status:status==='ready'?'ready':status==='login_required'?'login_required':'unknown',updatedAt:new Date().toISOString(),lastError:health.message})
  return {provider,status,ready:status==='ready',message:health.message??null,accountId:account.id,url:health.state.url}
 }

 async checkReady(id:string){
  const a=this.require(id)
  if(!this.providers.has(id))await this.open(id)
  const p=this.providers.get(id)
  if(!p)throw new Error('Provider 未初始化')
  const ready=await p.checkReady()
  await this.store.upsert({...a,status:ready?'ready':'login_required',updatedAt:new Date().toISOString(),lastError:undefined})
  return this.snapshot(id)!
 }

 async close(id:string){
  const a=this.require(id)
  this.providers.delete(id)
  await this.store.upsert({...a,status:'browser_closed',updatedAt:new Date().toISOString()})
  return this.snapshot(id)!
 }

 async remove(id:string){
  const a=this.require(id)
  this.providers.delete(id)
  await this.store.remove(id)
  if(this.selectedProvider===a.provider)this.selectedProvider=undefined
 }

 findByProvider(provider:AccountProvider){return this.store.list().find(a=>a.provider===provider)}

 async ensureProvider(provider:AccountProvider){
  this.selectProvider(provider)
  const existing=this.findByProvider(provider)
  if(existing){
   if(!this.providers.has(existing.id))await this.open(existing.id)
   return this.snapshot(existing.id)!
  }
  return this.add(provider)
 }
 getProvider(id:string){this.require(id);return this.providers.get(id)}


 snapshot(id:string){
  const a=this.store.get(id)
  return a?{...a,browserRunning:a.status!=='browser_closed'}:undefined
 }

 async dispose(){this.providers.clear()}

 private require(id:string){
  const a=this.store.get(id)
  if(!a)throw new Error('账号不存在: '+id)
  return a
 }
}
