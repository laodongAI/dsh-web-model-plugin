import {BrowserConversationManager} from '../browser/conversation-manager.js'
import {PROVIDER_MAP,PAGE_CONFIGS} from '../provider-catalog.js'
import type {AccountProvider} from '../types.js'
import type {BrowserChatRequest,BrowserProvider,BrowserProviderModel,BrowserProviderErrorCode} from './provider.js'
import {WebPageAdapter,ConfiguredWebPage,type WebPageHealthResult} from './web-page.js'
import type {WebPageTiming} from './web-page.js'
import type {CdpClient} from '../browser/cdp-client.js'

export class DefaultBrowserProvider implements BrowserProvider {
 constructor(public readonly provider:AccountProvider,private readonly cdp:CdpClient,private readonly conversations=new BrowserConversationManager(),private readonly timing:WebPageTiming={streamTimeoutMs:180000,noStartTimeoutMs:60000,uploadTimeoutMs:15000}){}

 private createPage(cdp:CdpClient):WebPageAdapter{
  // 数据驱动：页面行为全部由 provider-catalog.ts 的 PAGE_CONFIGS 决定，新增/改版 Provider 只需改数据表
  return new ConfiguredWebPage(PAGE_CONFIGS[this.provider],cdp,this.timing)
 }

 /**
  * 带超时保护的页面健康检查。
  * 背景：bridge 链路异常时 page.health() 可能长时间不返回（多次 evaluate 逐个等超时），
  * 这里用 8 秒兜底，避免上层恢复窗口/请求流程被卡死。
  */
 private async safeHealth(page:WebPageAdapter):Promise<WebPageHealthResult>{
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   return await Promise.race([
    page.health(),
    new Promise<WebPageHealthResult>((_,reject)=>{
     timer=setTimeout(()=>reject(new Error('SERVICE_UNAVAILABLE: 页面健康检查超时')),8000)
    }),
   ])
  }finally{
   if(timer)clearTimeout(timer)
  }
 }

 private async page(sessionId:string,accountId:string,cdp:CdpClient=this.cdp){
  const page=this.createPage(cdp)
  const health=await this.safeHealth(page)
  if(health.status!=='ready'&&health.status!=='login_required'){
   throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
  }
  const state=health.state
  const oldBinding=this.conversations.get(sessionId)
  if(oldBinding){
   const convChanged=Boolean(oldBinding.conversationId&&state.conversationId&&oldBinding.conversationId!==state.conversationId)
   const urlChanged=Boolean(oldBinding.url&&state.url&&oldBinding.url!==state.url)
   const identityLost=Boolean(oldBinding.conversationId&&!state.conversationId)
   const identityMissing=Boolean(!oldBinding.conversationId&&!state.conversationId)
   if(convChanged||(urlChanged&&(identityLost||identityMissing))){
    this.conversations.markDesynced(sessionId)
    throw new Error('PAGE_CHANGED: 当前网页已切换到其他会话')
   }
  }
  this.conversations.bind(sessionId,accountId,{id:'dsh-native-browser',url:state.url,title:''},state.conversationId)
  return {cdp,page}
 }

 async listModels():Promise<readonly BrowserProviderModel[]>{
  const item=PROVIDER_MAP[this.provider]
  return [{id:item.id+'-web',name:item.name+' Web'}]
 }

 /** 就绪检查（5 秒兜底，防止 bridge 异常时挂死） */
 async checkReady(){
  const health=await this.health()
  return health.status==='ready'
 }

 async health(sessionId?:string):Promise<WebPageHealthResult>{
  return this.safeHealth(this.createPage(sessionId?(this.cdp.withSession?.(sessionId)??this.cdp):this.cdp))
 }

 async *chat(req:BrowserChatRequest){
  const sessionId=req.sessionId??req.accountId
  const cdp=this.cdp.withSession?.(sessionId)??this.cdp
  this.conversations.begin(req.accountId,sessionId)
  try{
   const result=await this.page(sessionId,req.accountId,cdp)
   const {page}=result
   const last=req.messages.filter(m=>m.role==='user').at(-1)?.content??''
   if(!last&&!req.attachments?.length)throw new Error('没有可发送的用户消息')
   const health=await this.safeHealth(page)
   if(health.status==='login_required')throw new Error('LOGIN_REQUIRED: '+(health.message??'网页账号需要登录'))
   if(health.status!=='ready')throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
   if(req.attachments?.length){
    // 附件去重后只上传本次会话未传过的
    const seen=new Set<string>()
    const paths=req.attachments.map(x=>x.path).filter(p=>seen.has(p)?false:(seen.add(p),true))
    const pending=this.conversations.unuploaded(sessionId,paths)
    if(pending.length){
     try{await page.uploadAttachments(pending)}
     catch(error){throw new Error('ATTACHMENT_UPLOAD_FAILED: 未能上传本次请求所需附件，消息未发送', {cause:error})}
     this.conversations.markUploaded(sessionId,pending)
    }
   }
   await page.sendMessage(last)
   req.onSubmitted?.()
   for await(const delta of page.streamAnswer(req.signal))yield delta
  }finally{
   this.conversations.end(req.accountId,sessionId)
  }
 }

 async *resume(req:BrowserChatRequest){
  const sessionId=req.sessionId??req.accountId
  const cdp=this.cdp.withSession?.(sessionId)??this.cdp
  this.conversations.begin(req.accountId,sessionId)
  try{
   const {page}=await this.page(sessionId,req.accountId,cdp)
   const health=await this.safeHealth(page)
   if(health.status==='login_required')throw new Error('LOGIN_REQUIRED: '+(health.message??'网页账号需要登录'))
   if(health.status!=='ready')throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
   for await(const delta of page.streamAnswer(req.signal))yield delta
  }finally{
   this.conversations.end(req.accountId,sessionId)
  }
 }

 /**
  * 错误分类（决定上层提示与恢复策略）。
  * 顺序要点：结构类错误（输入框/DOM/未找到）先于额度类判定，
  * 且去掉了旧版裸词 "limit"（页面上大量无害文案含 limit，曾导致 QUOTA_EXCEEDED 误报）。
  */
 classifyError(error:unknown):BrowserProviderErrorCode{
  const s=error instanceof Error?error.message:String(error)
  if(/BROWSER_NOT_READY/i.test(s))return 'SERVICE_UNAVAILABLE'
  if(/PAGE_CHANGED|会话已发生变化|切换到其他会话/i.test(s))return 'PAGE_CHANGED'
  if(/LOGIN_REQUIRED|SESSION_EXPIRED/i.test(s))return 'LOGIN_REQUIRED'
  if(/未找到|没有找到|输入框|DOM|页面结构|网页页面|输入框未接收/i.test(s))return 'PAGE_CHANGED'
  if(/额度|quota|usage limit|reached your|out of credits/i.test(s))return 'QUOTA_EXCEEDED'
  if(/频繁|too many|rate limit/i.test(s))return 'RATE_LIMITED'
  if(/timeout|超时|service unavailable|服务异常|暂不可用/i.test(s))return 'SERVICE_UNAVAILABLE'
  if(/登录|log in|sign in/i.test(s))return 'LOGIN_REQUIRED'
  return 'UNKNOWN'
 }
}
