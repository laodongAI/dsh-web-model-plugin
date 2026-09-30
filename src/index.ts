import type {Context} from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {AccountManager} from './account-manager.js'
import {registerRoutes} from './http-routes.js'
import {DshBrowserAdapter} from './dsh-browser-adapter.js'

export const name='dsh-account-models'

export interface Config {
 chromePath?:string
 cdpReadyTimeoutMs:number
 streamTimeoutMs:number
 noStartTimeoutMs:number
 uploadTimeoutMs:number
}

export const Config:Schema<Config>=Schema.object({
 chromePath:Schema.string().role('path').optional(),
 cdpReadyTimeoutMs:Schema.number().min(1000).default(20000),
 streamTimeoutMs:Schema.number().min(10000).default(180000),
 noStartTimeoutMs:Schema.number().min(1000).default(60000),
 uploadTimeoutMs:Schema.number().min(1000).default(15000),
})

export const inject=['llm','webServer','attachments']

export function apply(ctx:Context,config:Config){
 const accounts=new AccountManager(
  {chromePath:config.chromePath,cdpReadyTimeoutMs:config.cdpReadyTimeoutMs},
  {streamTimeoutMs:config.streamTimeoutMs,noStartTimeoutMs:config.noStartTimeoutMs,uploadTimeoutMs:config.uploadTimeoutMs},
 )
 let disposed=false

 void accounts.init().then(()=>{
  if(disposed){void accounts.dispose();return}
  const adapter=new DshBrowserAdapter(accounts,ctx.attachments)
  const disposeAdapter=ctx.llm.registerAdapter(['web-ai'],adapter)
  const disposeRoutes=registerRoutes(accounts,r=>ctx.webServer.register(r))
  ctx.effect(()=>{
   return async()=>{
    disposeAdapter()
    disposeRoutes()
    await accounts.dispose()
   }
  },'dsh-account-models')
 }).catch(error=>ctx.logger.error(error))

 ctx.effect(()=>()=>{disposed=true},'dsh-account-models-init-guard')
}
