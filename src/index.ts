import type {Context} from '@deepseek-ai/cordis'
import {appendFileSync,mkdirSync} from 'node:fs'
import {appendFile} from 'node:fs/promises'
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
 streamTimeoutMs:Schema.number().min(10000).default(600000),
 noStartTimeoutMs:Schema.number().min(1000).default(300000),
 uploadTimeoutMs:Schema.number().min(1000).default(15000),
})

export const inject=['llm','webServer','attachments']

const LOG_DIR=join(homedir(),'.dsh','account-models')
const BOOT_LOG=join(LOG_DIR,'plugin-startup.log')

function syncLog(marker:string){
 try{
  mkdirSync(LOG_DIR,{recursive:true})
  appendFileSync(BOOT_LOG,`[${new Date().toISOString()}] ${marker}\n`,'utf8')
 }catch{}
}

syncLog(`MODULE_LOADED pid=${process.pid} node=${process.version} cwd=${process.cwd()}`)

async function bootLog(message:string){
 syncLog(message)
 try{await appendFile(BOOT_LOG,`[${new Date().toISOString()}] ${message}\n`,'utf8')}catch{}
}

export async function apply(ctx:Context,config:Config){
 syncLog('APPLY_ENTERED')
 await bootLog(`apply: entered; pid=${process.pid}; node=${process.version}; cwd=${process.cwd()}`)
 try{
  syncLog('CONFIG_RECEIVED')
  await bootLog(`config: ${JSON.stringify({chromePath:config.chromePath??null,cdpReadyTimeoutMs:config.cdpReadyTimeoutMs,streamTimeoutMs:config.streamTimeoutMs,noStartTimeoutMs:config.noStartTimeoutMs,uploadTimeoutMs:config.uploadTimeoutMs})}`)
  syncLog('ACCOUNT_MANAGER_CREATING')
  const accounts=new AccountManager({chromePath:config.chromePath,cdpReadyTimeoutMs:config.cdpReadyTimeoutMs},{streamTimeoutMs:config.streamTimeoutMs,noStartTimeoutMs:config.noStartTimeoutMs,uploadTimeoutMs:config.uploadTimeoutMs})
  syncLog('ACCOUNT_MANAGER_CREATED')
  await bootLog('apply: AccountManager created')
  syncLog('ACCOUNT_INIT_START')
  await bootLog('accounts.init: starting')
  await accounts.init()
  syncLog('ACCOUNT_INIT_COMPLETED')
  await bootLog('apply: accounts.init completed')
  await bootLog(`accounts.init: completed; accountCount=${accounts.list().length}; default=${JSON.stringify(accounts.getDefaultAccount()??null)}`)
  syncLog('ADAPTER_CREATING')
  const adapter=new DshBrowserAdapter(accounts,ctx.attachments)
  syncLog('ADAPTER_CREATED')
  await bootLog('apply: adapter created')
  syncLog('LLM_REGISTER_START')
  await bootLog('llm.registerAdapter: starting; provider=web-ai')
  const disposeAdapter=ctx.llm.registerAdapter(['web-ai'],adapter)
  syncLog('LLM_REGISTER_COMPLETED')
  await bootLog('llm.registerAdapter: completed')
  syncLog('ROUTES_REGISTER_START')
  await bootLog('webServer routes: starting')
  const disposeRoutes=registerRoutes(accounts,r=>{syncLog(`ROUTE_REGISTER ${r.kind} ${r.path}`);void bootLog(`webServer.register: ${r.kind} ${r.path}`);return ctx.webServer.register(r)})
  syncLog('ROUTES_REGISTER_COMPLETED')
  await bootLog('apply: routes registered')
  syncLog('EFFECT_REGISTER_START')
  ctx.effect(()=>()=>{syncLog('DISPOSE_START');try{disposeAdapter()}catch(error){syncLog(`DISPOSE_ADAPTER_FAILED ${error instanceof Error?error.message:String(error)}`)}try{disposeRoutes()}catch(error){syncLog(`DISPOSE_ROUTES_FAILED ${error instanceof Error?error.message:String(error)}`)}void accounts.dispose().catch(error=>syncLog(`DISPOSE_ACCOUNTS_FAILED ${error instanceof Error?error.message:String(error)}`));syncLog('DISPOSE_COMPLETED')},'dsh-account-models')
  syncLog('EFFECT_REGISTER_COMPLETED')
  await bootLog('webServer routes: completed')
  syncLog('APPLY_COMPLETED')
  await bootLog('apply: completed')
 }catch(error){
  const detail=error instanceof Error?(error.stack??error.message):String(error)
  syncLog(`APPLY_FAILED type=${typeof error}; name=${error instanceof Error?error.name:'unknown'}; message=${error instanceof Error?error.message:String(error)}`)
  syncLog(`APPLY_FAILED_DETAIL ${detail.replaceAll('\n',' | ')}`)
  await bootLog(`apply: FAILED type=${typeof error}; name=${error instanceof Error?error.name:'unknown'}; message=${error instanceof Error?error.message:String(error)}`)
  await bootLog(`apply: FAILED\n${detail}`)
  try{process.stderr.write(`[dsh-account-models] ${detail}\n`)}catch{}
  throw error
 }
}
