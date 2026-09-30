import type { Context } from '@deepseek-ai/cordis'
import { AccountManager } from './account-manager.js'
import { registerRoutes } from './http-routes.js'
import { DshBrowserAdapter } from './dsh-browser-adapter.js'

export const name='dsh-account-models'
export const inject=['llm','webServer']

export function apply(ctx:Context){
  const accounts=new AccountManager()
  void accounts.init().then(()=>{
    const adapter=new DshBrowserAdapter(accounts)
    const disposeAdapter=ctx.llm.registerAdapter(['deepseek-web','chatgpt-web','qwen-web'],adapter)
    const disposeRoutes=registerRoutes(accounts,r=>ctx.webServer.register(r))
    ctx.effect(()=>async()=>{
      disposeAdapter()
      disposeRoutes()
      await accounts.dispose()
    },'dsh-account-models')
  }).catch(e=>ctx.logger.error(e))
}
