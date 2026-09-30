import type {Context} from '@deepseek-ai/cordis'
import {appendFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {homedir} from 'node:os'
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
 chromePath:Schema.string().role('path').default(undefined as unknown as string),
 cdpReadyTimeoutMs:Schema.number().min(1000).default(20000),
 streamTimeoutMs:Schema.number().min(10000).default(180000),
 noStartTimeoutMs:Schema.number().min(1000).default(60000),
 uploadTimeoutMs:Schema.number().min(1000).default(15000),
})

export const inject=['llm','webServer','attachments']

const BOOT_LOG=join(homedir(),'.dsh','account-models','plugin-startup.log')

async function bootLog(message:string){
 try{
  await mkdir(join(homedir(),'.dsh','account-models'),{recursive:true})
  await appendFile(BOOT_LOG,`[${new Date().toISOString()}] ${message}\\n`,'utf8')
 }catch{}
}

export async function apply(ctx:Context,config:Config){
 await bootLog(`apply: entered; pid=${process.pid}; node=${process.version}; cwd=${process.cwd()}`)
 try{
 await bootLog(`config: ${JSON.stringify({chromePath:config.chromePath??null,cdpReadyTimeoutMs:config.cdpReadyTimeoutMs,streamTimeoutMs:config.streamTimeoutMs,noStartTimeoutMs:config.noStartTimeoutMs,uploadTimeoutMs:config.uploadTimeoutMs})}`)
 const accounts=new AccountManager(
  {chromePath:config.chromePath,cdpReadyTimeoutMs:config.cdpReadyTimeoutMs},
  {streamTimeoutMs:config.streamTimeoutMs,noStartTimeoutMs:config.noStartTimeoutMs,uploadTimeoutMs:config.uploadTimeoutMs},
 )

 // 初始化必须属于插件启动阶段。
 // 如果持久化配置、账号存储或依赖服务初始化失败，应让 Cordis 将该 entry 标记为 FAILED，
 // 而不是在 apply 返回后异步吞掉错误，避免最终只看到“entry did not activate”。
 await bootLog('apply: AccountManager created')
 await bootLog('accounts.init: starting')
 await accounts.init()
 await bootLog('apply: accounts.init completed')

 await bootLog(`accounts.init: completed; accountCount=${accounts.list().length}; default=${JSON.stringify(accounts.getDefaultAccount()??null)}`)
 const adapter=new DshBrowserAdapter(accounts,ctx.attachments)
 await bootLog('apply: adapter created')
 await bootLog('llm.registerAdapter: starting; provider=web-ai')
 const disposeAdapter=ctx.llm.registerAdapter(['web-ai'],adapter)
 await bootLog('apply: llm adapter registered')
 await bootLog('llm.registerAdapter: completed')
 await bootLog('webServer routes: starting')
 const disposeRoutes=registerRoutes(accounts,r=>{ void bootLog(`webServer.register: ${r.kind} ${r.path}`); return ctx.webServer.register(r) })
 await bootLog('apply: routes registered')

 ctx.effect(()=>{
  return async()=>{
   disposeAdapter()
   disposeRoutes()
   await accounts.dispose()
  }
 },'dsh-account-models')
 await bootLog('webServer routes: completed')
 await bootLog('apply: completed')
 }catch(error){
  const detail=error instanceof Error ? (error.stack??error.message) : String(error)
  await bootLog(`apply: FAILED type=${typeof error}; name=${error instanceof Error?error.name:'unknown'}; message=${error instanceof Error?error.message:String(error)}`)
  await bootLog(`apply: FAILED\\n${detail}`)
  try{process.stderr.write(`[dsh-account-models] ${detail}\\n`)}catch{}
  throw error
 }
}
