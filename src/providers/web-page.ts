import type {CdpClient} from '../browser/cdp-client.js'
export interface WebConversationState{conversationId?:string;url:string;ready:boolean;changed:boolean}
export abstract class WebPageAdapter{
 constructor(protected readonly cdp:CdpClient){}
 abstract isLoggedIn():Promise<boolean>
 abstract getConversationState():Promise<WebConversationState>
 abstract sendMessage(text:string):Promise<void>
 abstract readAnswer(previous:string):Promise<string>
 abstract detectError():Promise<{code:string;message:string}|null>
 abstract isGenerating():Promise<boolean>
 async *streamAnswer(signal?:AbortSignal):AsyncIterable<string>{
  let previous='',idle=0
  const started=Date.now()
  while(Date.now()-started<180000){
   if(signal?.aborted){await this.stop();throw signal.reason??new Error('请求已取消')}
   const error=await this.detectError();if(error)throw new Error(error.message)
   const state=await this.getConversationState();if(state.changed)throw new Error('PAGE_CHANGED: 网页会话已发生变化')
   const current=(await this.readAnswer(previous)).trimEnd()
   if(current.startsWith(previous)&&current.length>previous.length){const delta=current.slice(previous.length);previous=current;idle=0;yield delta}
   else if(current!==previous&&current.length>previous.length){previous=current;idle=0;yield current}
   else if(previous)idle++
   if(previous&&!await this.isGenerating()&&idle>=2)return
   await new Promise(r=>setTimeout(r,400))
  }
  throw new Error('网页模型响应超时')
 }
 async stop(){await this.cdp.evaluate<void>(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/stop|停止|中止/i.test(x.textContent||''));b?.click()})()`)}
}