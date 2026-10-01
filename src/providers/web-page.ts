import type {CdpClient} from '../browser/cdp-client.js'

export type WebPageHealth='ready'|'login_required'|'page_changed'|'service_error'
export interface WebConversationState{conversationId?:string;url:string;ready:boolean;changed:boolean}
export interface WebPageHealthResult{status:WebPageHealth;message?:string;state:WebConversationState}
export interface WebPageTiming{streamTimeoutMs:number;noStartTimeoutMs:number;uploadTimeoutMs:number}

const DEFAULT_TIMING:WebPageTiming={streamTimeoutMs:180000,noStartTimeoutMs:60000,uploadTimeoutMs:15000}

export abstract class WebPageAdapter{
 constructor(protected readonly cdp:CdpClient,protected readonly timing:WebPageTiming=DEFAULT_TIMING){}
 abstract canChat():Promise<boolean>
 abstract getConversationState():Promise<WebConversationState>
 abstract sendMessage(text:string):Promise<void>
 /**
  * Web AI 页面原生附件入口。默认实现沿用 DOM file input。
  * Provider 如果使用自定义上传流程，可以覆盖此方法。
  */
 async uploadAttachments(files:readonly string[]):Promise<void>{
  await this.uploadFiles(files)
 }
 abstract readAnswer(previous:string):Promise<string>
 abstract detectError():Promise<{code:string;message:string}|null>
 abstract isGenerating():Promise<boolean>
 abstract expectedHost():string

 async uploadFiles(files:readonly string[]):Promise<void>{
  if(files.length===0)return
  try{await this.cdp.setFileInputFiles('input[type="file"]',files)}
  catch(firstError){
   await this.clickAttachmentControl()
   const deadline=Date.now()+5000
   let lastError:unknown=firstError
   while(Date.now()<deadline){
    try{await this.cdp.setFileInputFiles('input[type="file"]',files);lastError=undefined;break}
    catch(error){lastError=error;await sleep(250)}
   }
   if(lastError)throw new Error('PAGE_CHANGED: 未能打开网页文件上传控件: '+String(lastError))
  }
  await this.waitForUpload(files)
 }

 protected async clickAttachmentControl(){
  await this.cdp.evaluate<void>(`(()=>{const xs=[...document.querySelectorAll('button,[role="button"],label')];const b=xs.find(x=>{const t=[x.textContent||'',x.getAttribute('aria-label')||'',x.getAttribute('title')||''].join(' ');return /附件|上传|文件|attach|upload|file/i.test(t)&&!/发送|send|submit/i.test(t)});if(!b)throw new Error('PAGE_CHANGED: 未找到网页附件按钮');b.click()})()`)
 }

 protected async waitForUpload(files:readonly string[]){
  const names=files.map(x=>x.split(/[\\/]/).pop()||x)
  const deadline=Date.now()+this.timing.uploadTimeoutMs
  while(Date.now()<deadline){
   const state=await this.cdp.evaluate<{count:number;text:string}>(`(()=>({count:document.querySelector('input[type="file"]')?.files?.length||0,text:document.body?.innerText||''}))()`)
   if(state.count>=files.length||names.every(n=>state.text.includes(n)))return
   await sleep(300)
  }
  throw new Error('SERVICE_UNAVAILABLE: 网页文件上传未在限定时间内完成')
 }

 async health():Promise<WebPageHealthResult>{
  const state=await this.getConversationState()
  if(!state.url.includes(this.expectedHost()))return {status:'page_changed',message:'当前浏览器页面不是目标模型页面',state}
  if(!state.ready)return {status:'page_changed',message:'目标页面输入区尚未就绪，页面结构可能已变化',state}
  if(!await this.canChat())return {status:'login_required',message:'网页账号登录状态已失效或尚未登录',state}
  const error=await this.detectError()
  if(error)return {status:error.code==='LOGIN_REQUIRED'?'login_required':'service_error',message:error.message,state}
  return {status:'ready',state}
 }

 async *streamAnswer(signal?:AbortSignal):AsyncIterable<string>{
  let previous='',idle=0
  const started=Date.now()
  let firstOutputAt:number|undefined
  while(Date.now()-started<this.timing.streamTimeoutMs){
   if(signal?.aborted){await this.stop();throw signal.reason??new Error('请求已取消')}
   const error=await this.detectError()
   if(error)throw new Error(error.code+': '+error.message)
   const state=await this.getConversationState()
   if(state.changed)throw new Error('PAGE_CHANGED: 网页会话已发生变化')
   const current=(await this.readAnswer(previous)).trimEnd()
   if(current.startsWith(previous)&&current.length>previous.length){
    const delta=current.slice(previous.length);previous=current;idle=0;firstOutputAt??=Date.now();yield delta
   }else if(current!==previous&&current.length>previous.length){
    previous=current;idle=0;firstOutputAt??=Date.now();yield current
   }else if(previous)idle++
   if(!firstOutputAt&&Date.now()-started>=this.timing.noStartTimeoutMs)throw new Error('SERVICE_UNAVAILABLE: 网页模型在限定时间内未开始生成回答')
   if(previous&&!await this.isGenerating()&&idle>=2)return
   await sleep(400)
  }
  throw new Error('SERVICE_UNAVAILABLE: 网页模型响应超时')
 }

 async stop(){await this.cdp.evaluate<void>(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/stop|停止|中止/i.test(x.textContent||''));b?.click()})()`)}
}

function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms))}
