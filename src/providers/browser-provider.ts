import {connectTab,listTabs} from '../browser/cdp-client.js'
import {BrowserConversationManager} from '../browser/conversation-manager.js'
import type {AccountProvider} from '../types.js'
import type {BrowserChatRequest,BrowserProvider,BrowserProviderModel,BrowserProviderErrorCode} from './provider.js'
import {DeepSeekPage} from './deepseek/deepseek-page.js'
import {ChatGptPage} from './chatgpt/chatgpt-page.js'
export class DefaultBrowserProvider implements BrowserProvider {
 constructor(public readonly provider:AccountProvider,private readonly port:number,private readonly conversations=new BrowserConversationManager()){}
 private async page(sessionId:string,accountId:string){
  const existing=this.conversations.findByAccount(accountId);if(existing&&existing.sessionId!==sessionId)throw new Error('PAGE_CHANGED: 当前账号已有其他 DSH 会话占用浏览器会话，请先结束另一个会话')
  const tab=await this.conversations.findTab(this.port,sessionId,accountId)
  if(!tab)throw new Error('PAGE_CHANGED: 没有找到可绑定的浏览器页面，请先打开账号窗口')
  const cdp=await connectTab(tab);const page=this.provider==='deepseek'?new DeepSeekPage(cdp):new ChatGptPage(cdp);const health=await page.health();if(health.status!=='ready'&&health.status!=='login_required')throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'));const state=health.state;const oldBinding=this.conversations.get(sessionId);if(oldBinding?.conversationId&&state.conversationId&&oldBinding.conversationId!==state.conversationId){this.conversations.markDesynced(sessionId);throw new Error('PAGE_CHANGED: 当前网页已切换到其他会话')}this.conversations.bind(sessionId,accountId,tab,state.conversationId);return {cdp,page}
 }
 async listModels():Promise<readonly BrowserProviderModel[]>{return this.provider==='deepseek'?[{id:'deepseek-web',name:'DeepSeek Web'}]:[{id:'chatgpt-web',name:'ChatGPT Web'}]}
 async checkLogin(){const tabs=await listTabs(this.port);const tab=tabs.find(x=>this.provider==='deepseek'?/deepseek\.com/.test(x.url):/chatgpt\.com/.test(x.url));if(!tab)return false;const cdp=await connectTab(tab);try{const page=this.provider==='deepseek'?new DeepSeekPage(cdp):new ChatGptPage(cdp);return await page.isLoggedIn()}finally{await cdp.close()}}
 async *chat(req:BrowserChatRequest){
  const sessionId=req.sessionId??req.accountId
  const {page,cdp}=await this.page(sessionId,req.accountId)
  try{
   const last=req.messages.filter(m=>m.role==='user').at(-1)?.content
   if(!last)throw new Error('没有可发送的用户消息')
   const health=await page.health();if(health.status==='login_required')throw new Error('LOGIN_REQUIRED: '+(health.message??'网页账号需要登录'));if(health.status!=='ready')throw new Error('PAGE_CHANGED: '+(health.message??'网页页面不可用'))
   await page.sendMessage(last)
   for await(const delta of page.streamAnswer(req.signal))yield delta
  }finally{await cdp.close()}
 }
 classifyError(error:unknown):BrowserProviderErrorCode{
  const s=error instanceof Error?error.message:String(error)
  if(/PAGE_CHANGED/i.test(s))return 'PAGE_CHANGED'
    if(/LOGIN_REQUIRED|登录|log in|sign in/i.test(s))return 'LOGIN_REQUIRED'
  if(/额度|limit|quota|usage limit/i.test(s))return 'QUOTA_EXCEEDED'
  if(/频繁|too many|rate limit/i.test(s))return 'RATE_LIMITED'
  if(/timeout|超时/i.test(s))return 'SERVICE_UNAVAILABLE'
  if(/未找到|没有找到|输入框|DOM|页面结构|网页页面/i.test(s))return 'PAGE_CHANGED'
  return 'UNKNOWN'
 }
}