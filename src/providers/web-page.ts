import type {CdpClient} from '../browser/cdp-client.js'
export type WebPageHealth='ready'|'login_required'|'page_changed'|'service_error'
export interface WebConversationState{conversationId?:string;url:string;ready:boolean;changed:boolean}
export interface WebPageHealthResult{status:WebPageHealth;message?:string;state:WebConversationState}
export abstract class WebPageAdapter{
 constructor(protected readonly cdp:CdpClient){}
 abstract isLoggedIn():Promise<boolean>
 abstract getConversationState():Promise<WebConversationState>
 abstract sendMessage(text:string):Promise<void>
 abstract readAnswer(previous:string):Promise<string>
 abstract detectError():Promise<{code:string;message:string}|null>
 abstract isGenerating():Promise<boolean>
 abstract expectedHost():string
 async health():Promise<WebPageHealthResult>{
  const state=await this.getConversationState()
  if(!state.url.includes(this.expectedHost()))return {status:'page_changed',message:'当前浏览器页面不是目标模型页面',state}
  if(!state.ready)return {status:'page_changed',message:'目标页面输入区尚未就绪，页面结构可能已变化',state}
  if(!await this.isLoggedIn())return {status:'login_required',message:'网页账号登录状态已失效或尚未登录',state}
  const error=await this.detectError()
  if(error)return {status:error.code==='LOGIN_REQUIRED'?'login_required':'service_error',message:error.message,state}
  return {status:'ready',state}
 }
 async *streamAnswer(signal?:AbortSignal):AsyncIterable<string>{
  let previous='',idle=0
  const started=Date.now()
  while(Date.now()-started<180000){
   if(signal?.aborted){await this.stop();throw signal.reason??new Error('请求已取消')}
   const error=await this.detectError();if(error)throw new Error(error.code+': '+error.message)
   const state=await this.getConversationState();if(state.changed)throw new Error('PAGE_CHANGED: 网页会话已发生变化')
   const current=(await this.readAnswer(previous)).trimEnd()
   if(current.startsWith(previous)&&current.length>previous.length){const delta=current.slice(previous.length);previous=current;idle=0;yield delta}
   else if(current!==previous&&current.length>previous.length){previous=current;idle=0;yield current}
   else if(previous)idle++
   if(previous&&!await this.isGenerating()&&idle>=2)return
   await new Promise(r=>setTimeout(r,400))
  }
  throw new Error('SERVICE_UNAVAILABLE: 网页模型响应超时')
 }
 async stop(){await this.cdp.evaluate<void>(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/stop|停止|中止/i.test(x.textContent||''));b?.click()})()`)}
}