import type {CdpClient} from '../browser/cdp-client.js'

export type WebPageHealth='ready'|'login_required'|'page_changed'|'service_error'
export interface WebConversationState{conversationId?:string;url:string;ready:boolean;changed:boolean}
export interface WebPageHealthResult{status:WebPageHealth;message?:string;state:WebConversationState}
// 各超时配置；fillTimeoutMs 为“填充输入框/点击发送”两步 DOM 操作的单独超时（大 payload 页面需要更久）
export interface WebPageTiming{streamTimeoutMs:number;noStartTimeoutMs:number;uploadTimeoutMs:number;fillTimeoutMs?:number}

const DEFAULT_TIMING:WebPageTiming={streamTimeoutMs:180000,noStartTimeoutMs:60000,uploadTimeoutMs:15000,fillTimeoutMs:30000}

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

 protected async fillAndSubmit(selectors:string,buttonPattern:string,text:string,provider:string){
  // 拆成“填充”+“提交”两步：旧的单次表达式包含点击，点击引发页面导航时 Electron 会把
  // 整个脚本报成 GUEST_VIEW_ERROR；拆开后填充幂等可重试，提交窗口更小
  const sels=JSON.stringify(selectors.split(',').map(s=>s.trim()))
  const fillTimeout=this.timing.fillTimeoutMs??30000
  const fillExpr=`(()=>{
   const sels=${sels};
   const el=sels.map(s=>document.querySelector(s)).find(Boolean);
   if(!el)throw new Error('PAGE_CHANGED: '+${JSON.stringify(provider)}+' 输入框未找到');
   el.focus();
   const value=${JSON.stringify(text)};
   if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    setter?.call(el,value);
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
   }else{
    el.textContent=value;
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
   }
   return true;
  })()`
  // 填充失败重试一次（填充是幂等操作，重发安全）
  try{await this.cdp.evaluate<void>(fillExpr,fillTimeout)}
  catch(error){
   console.warn('[dsh-account-models] fill retry after error:',error)
   await this.cdp.evaluate<void>(fillExpr,fillTimeout)
  }
  // 提交单独执行：降低“点击→导航→脚本结果丢失”的概率
  // 提交前校验输入框内容已就绪，防止空发送
  await this.cdp.evaluate<void>(`(()=>{const sels=${sels};const el=sels.map(s=>document.querySelector(s)).find(Boolean);if(!el)throw new Error('PAGE_CHANGED: '+${JSON.stringify(provider)}+' 输入框未找到');const t=(el.value??el.textContent??'').trim();if(!t)throw new Error('PAGE_CHANGED: '+${JSON.stringify(provider)}+' 输入框未接收内容')})()`,fillTimeout)
  await this.cdp.evaluate<void>(`(()=>{
   const sels=${sels};
   const el=sels.map(s=>document.querySelector(s)).find(Boolean);
   if(!el)throw new Error('PAGE_CHANGED: '+${JSON.stringify(provider)}+' 输入框未找到');
   const re=new RegExp(${JSON.stringify(buttonPattern)},'i');
   const button=[...document.querySelectorAll('button,[role="button"]')].find(b=>!b.hasAttribute('disabled')&&!b.getAttribute('aria-disabled')&&re.test((b.textContent||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')));
   if(button){button.click();return}
   el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
  })()`,fillTimeout)
 }

 protected async readLatest(selectors:string,previous:string){
  // 排除用户输入节点与输入框祖先内的节点（避免把用户自己的话当回答），从后向前找第一个与 previous 不同的值
  return this.cdp.evaluate<string>(`(()=>{const p=${JSON.stringify(previous)};const sels=${JSON.stringify(selectors.split(',').map(s=>s.trim()))};const nodes=sels.flatMap(s=>[...document.querySelectorAll(s)]);const inputTexts=new Set([...document.querySelectorAll('textarea,input,[contenteditable="true"]')].map(x=>(x.value??x.textContent??'').trim()).filter(Boolean));const values=nodes.filter(x=>!x.closest('textarea,input')).map(x=>(x.innerText||x.textContent||'').trim()).filter(Boolean).filter(x=>!inputTexts.has(x));if(!values.length)return '';for(let i=values.length-1;i>=0;i--){if(values[i]!==p)return values[i]}return values.at(-1)||''})()`);
 }

 protected async isBusy(buttonPattern='stop|停止|中止|cancel'){
  return this.cdp.evaluate<boolean>(`(()=>{const re=new RegExp(${JSON.stringify(buttonPattern)},'i');return [...document.querySelectorAll('button,[role="button"]')].some(b=>re.test((b.textContent||'')+' '+(b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||''))&&!b.hasAttribute('disabled'))})()`);
 }

 /**
  * 页面错误检测（登录/配额/限流）。
  * 误报教训：旧版对整页文本匹配裸词 quota|limit|额度|限额|频繁，
  * 而账号菜单"剩余额度"、模型说明含"limit"等正常文案都会命中，导致 QUOTA_EXCEEDED 误报。
  * 现改为：登录检测保持整页扫描（有"无输入框"守护）；配额/限流只匹配完整错误短语，
  * 并把命中的页面原文片段附在错误消息里，便于区分真实报错与误报。
  */
 protected async commonError(loginPattern:string,quotaPattern='额度已用完|额度不足|已达使用上限|达到使用上限|余额不足|欠费|quota exceeded|usage limit|reached your|out of credits',ratePattern='请求过于频繁|操作过于频繁|稍后再试|rate limit|too many requests'){
  return this.cdp.evaluate<{code:string;message:string}|null>(`(()=>{const t=document.body?.innerText||'';if(new RegExp(${JSON.stringify(loginPattern)},'i').test(t)&&!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="消息"],input[placeholder*="Message"]'))return {code:'LOGIN_REQUIRED',message:${JSON.stringify('网页账号需要登录')}};const q=t.match(new RegExp(${JSON.stringify(quotaPattern)},'i'));if(q)return {code:'QUOTA_EXCEEDED',message:'当前账号达到使用限制（页面提示：'+String(q[0]).slice(0,60)+'）'};const r=t.match(new RegExp(${JSON.stringify(ratePattern)},'i'));if(r)return {code:'RATE_LIMITED',message:'请求过于频繁（页面提示：'+String(r[0]).slice(0,60)+'）'};return null})()`);
 }

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
   // 识别明确的上传失败提示，立即报错不再空等
   const fail=/上传失败|文件过大|不支持的文件|upload failed|file too large/i.exec(state.text)
   if(fail)throw new Error('SERVICE_UNAVAILABLE: 网页文件上传失败（页面提示：'+fail[0]+'）')
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
  // 轮询间隔分离：首字前 250ms（降首字延迟），首字后 400ms（降开销）；连续 2 次相同且非生成中判定结束
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
   if(current&&current!==previous){
    if(previous&&!current.startsWith(previous))throw new Error('PAGE_CHANGED: 网页回答在生成过程中被替换，已停止以避免重复或错误输出')
    yield current.slice(previous.length)
    previous=current;idle=0;firstOutputAt??=Date.now()
   }else if(previous)idle++
   if(!firstOutputAt&&Date.now()-started>=this.timing.noStartTimeoutMs)throw new Error('SERVICE_UNAVAILABLE: 网页模型在限定时间内未开始生成回答')
   if(previous&&!await this.isGenerating()&&idle>=2)return
   await sleep(firstOutputAt?400:250)
  }
  throw new Error('SERVICE_UNAVAILABLE: 网页模型响应超时')
 }

 async stop(){await this.cdp.evaluate<void>(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/stop|停止|中止/i.test(x.textContent||''));b?.click()})()`)}
}

/** 页面适配器配置：全部为纯数据，网站改版时只改 provider-catalog.ts 中的 PAGE_CONFIGS 数据表 */
export interface WebPageConfig{
 /** 提供方显示名（用于错误消息，如"DeepSeek 输入框未找到"） */
 displayName:string
 /** 目标站点 host（health 校验 location.href 是否包含） */
 host:string
 /** 输入框选择器（canChat 判定 + sendMessage 填充 + ready 判定） */
 inputSelectors:string
 /** 会话 ID 的 URL 路径正则源字符串（捕获组 1 为会话 ID） */
 conversationIdPattern:string
 /** 发送按钮文本/aria-label/title 匹配正则源（i 标志） */
 sendButtonPattern:string
 /** 回答内容选择器（readLatest 依序取最后一个非空） */
 answerSelectors:string
 /** 登录提示正则源（commonError 的 loginPattern） */
 loginPattern:string
 /** 可选：生成中/停止按钮匹配正则源（缺省 stop|停止|中止|cancel） */
 busyPattern?:string
 /** 可选：额度用尽正则源（缺省用 commonError 默认） */
 quotaPattern?:string
 /** 可选：限流正则源（缺省用 commonError 默认） */
 ratePattern?:string
}

/** 数据驱动的通用页面适配器：行为全部由 WebPageConfig 数据决定，替代 10 个结构重复的子类 */
export class ConfiguredWebPage extends WebPageAdapter{
 constructor(protected readonly config:WebPageConfig,cdp:CdpClient,timing:WebPageTiming){super(cdp,timing)}
 expectedHost(){return this.config.host}
 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector(${JSON.stringify(this.config.inputSelectors)}))()`)
 }
 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(new RegExp(${JSON.stringify(this.config.conversationIdPattern)}))||[])[1],ready:!!document.querySelector(${JSON.stringify(this.config.inputSelectors)}),changed:false}))()`)
 }
 async sendMessage(text:string){
  await this.fillAndSubmit(this.config.inputSelectors,this.config.sendButtonPattern,text,this.config.displayName)
 }
 async readAnswer(previous:string){
  return this.readLatest(this.config.answerSelectors,previous)
 }
 async isGenerating(){
  return this.isBusy(this.config.busyPattern)
 }
 async detectError(){
  return this.commonError(this.config.loginPattern,this.config.quotaPattern,this.config.ratePattern)
 }
}

function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms))}
