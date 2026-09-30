import type { Context } from '@deepseek-ai/cordis'
import { AccountManager } from './account-manager.js'
import { registerRoutes } from './http-routes.js'
export const name='dsh-account-models'
export const inject=['webServer']
export function apply(ctx:Context){const m=new AccountManager();void m.init().then(()=>{const dispose=registerRoutes(m,r=>ctx.webServer.register(r));ctx.effect(()=>async()=>{dispose();await m.dispose()},'dsh-account-models')}).catch(e=>ctx.logger.error(e))}