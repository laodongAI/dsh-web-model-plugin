import {connectTab,listTabs} from '../browser/cdp-client.js'
import {BrowserConversationManager} from '../browser/conversation-manager.js'
import {PROVIDER_MAP} from '../provider-catalog.js'
import type {AccountProvider} from '../types.js'
import type {BrowserChatRequest,BrowserProvider,BrowserProviderModel,BrowserProviderErrorCode} from './provider.js'
import {DeepSeekPage} from './deepseek/deepseek-page.js'
import {ChatGptPage} from './chatgpt/chatgpt-page.js'
import {QwenPage} from './qwen/qwen-page.js'
import {TencentYuanbaoPage} from './tencent-yuanbao/tencent-yuanbao-page.js'
import {DoubaoPage} from './doubao/doubao-page.js'
import {PerplexityPage} from './perplexity/perplexity-page.js'
import {CopilotPage} from './copilot/copilot-page.js'
import {HuggingChatPage} from './huggingchat/huggingchat-page.js'
import {KimiPage} from './kimi/kimi-page.js'
import {ChatGlmPage} from './chatglm/chatglm-page.js'

export class DefaultBrowserProvider implements BrowserProvider {
 constructor(public readonly provider:AccountProvider,private readonly port:number,private readonly conversations=new BrowserConversationManager()){}

 private createPage(cdp:import('../browser/cdp-client.js').CdpClient){
  const pages={deepseek:DeepSeekPage,chatgpt:ChatGptPage,qwen:QwenPage,'tencent-yuanbao':TencentYuanbaoPage,doubao:DoubaoPage,perplexity:PerplexityPage,copilot:CopilotPage,huggingchat:HuggingChatPage,kimi:KimiPage,chatglm:ChatGlmPage} as const
  const C=pages[this.provider]
  return new C(cdp)
 }

 private async page(sessionId:string,accountId:string){
  const tab=await this.conversations.findTab(this.port,sessionId,accountId)
  if(!tab)throw new Error('PAGE_CHANGED: 没有找到可绑定的浏览器页面，请先打开账号窗口')
  const cdp=await connectTab(tab)
  const page=this.createPage(cdp)
  const health=await page.health()
  if(health.status!=='ready'&&health.status!=='login_required'){
   await cdp.close()
   throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
  }
  const state=health.state
  const oldBinding=this.conversations.get(sessionId)
  if(oldBinding?.conversationId&&state.conversationId&&oldBinding.conversationId!==state.conversationId){
   this.conversations.markDesynced(sessionId)
   await cdp.close()
   throw new Error('PAGE_CHANGED: 当前网页已切换到其他会话')
  }
  this.conversations.bind(sessionId,accountId,tab,state.conversationId)
  return {cdp,page}
 }

 async listModels():Promise<readonly BrowserProviderModel[]>{
  const item=PROVIDER_MAP[this.provider]
  return [{id:item.id+'-web',name:item.name+' Web'}]
 }

 async screenshot(){
  const tabs=await listTabs(this.port)
  const tab=tabs.find(x=>PROVIDER_MAP[this.provider].hostPattern.test(x.url))
  if(!tab)throw new Error('没有找到当前 Provider 的浏览器页面')
  const cdp=await connectTab(tab)
  try{return {...await cdp.screenshot(),url:tab.url,title:tab.title}}
  finally{await cdp.close()}
 }

 async checkReady(){
  const tabs=await listTabs(this.port)
  const tab=tabs.find(x=>PROVIDER_MAP[this.provider].hostPattern.test(x.url))
  if(!tab)return false
  const cdp=await connectTab(tab)
  try{return await this.createPage(cdp).canChat()}
  finally{await cdp.close()}
 }

 async *chat(req:BrowserChatRequest){
  const sessionId=req.sessionId??req.accountId
  this.conversations.begin(req.accountId,sessionId)
  let cdp:import('../browser/cdp-client.js').CdpClient|undefined
  try{
   const result=await this.page(sessionId,req.accountId)
   cdp=result.cdp
   const {page}=result
   const last=req.messages.filter(m=>m.role==='user').at(-1)?.content??''
   if(!last&&!req.attachments?.length)throw new Error('没有可发送的用户消息')
   const health=await page.health()
   if(health.status==='login_required')throw new Error('LOGIN_REQUIRED: '+(health.message??'网页账号需要登录'))
   if(health.status!=='ready')throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
   if(req.attachments?.length){
    const paths=this.conversations.unuploaded(sessionId,req.attachments.map(x=>x.path))
    if(paths.length){await page.uploadFiles(paths);this.conversations.markUploaded(sessionId,paths)}
   }
   await page.sendMessage(last)
   for await(const delta of page.streamAnswer(req.signal))yield delta
  }finally{
   if(cdp)await cdp.close()
   this.conversations.end(req.accountId,sessionId)
  }
 }

 classifyError(error:unknown):BrowserProviderErrorCode{
  const s=error instanceof Error?error.message:String(error)
  if(/PAGE_CHANGED/i.test(s))return 'PAGE_CHANGED'
  if(/LOGIN_REQUIRED|登录|log in|sign in/i.test(s))return 'LOGIN_REQUIRED'
  if(/额度|limit|quota|usage limit/i.test(s))return 'QUOTA_EXCEEDED'
  if(/频繁|too many|rate limit/i.test(s))return 'RATE_LIMITED'
  if(/timeout|超时|service unavailable|服务异常/i.test(s))return 'SERVICE_UNAVAILABLE'
  if(/未找到|没有找到|输入框|DOM|页面结构|网页页面/i.test(s))return 'PAGE_CHANGED'
  return 'UNKNOWN'
 }
}
