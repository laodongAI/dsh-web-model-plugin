import {connectTab,listTabs} from '../browser/cdp-client.js'
import {BrowserConversationManager} from '../browser/conversation-manager.js'
import type {AccountProvider} from '../types.js'
import type {BrowserChatRequest,BrowserProvider,BrowserProviderModel,BrowserProviderErrorCode} from './provider.js'
import {DeepSeekPage} from './deepseek/deepseek-page.js'
import {ChatGptPage} from './chatgpt/chatgpt-page.js'
export class DefaultBrowserProvider implements BrowserProvider {
 constructor(public readonly provider:AccountProvider,private readonly port:number,private readonly conversations=new BrowserConversationManager()){}
 private async page(sessionId:string,accountId:string){
  const tab=await this.conversations.findTab(this.port,sessionId,accountId)
  if(!tab)throw new Error('没有找到对应浏览器页面，请先打开账号窗口')
  const cdp=await connectTab(tab);this.conversations.bind(sessionId,accountId,tab)
  return {cdp,page:this.provider==='deepseek'?new DeepSeekPage(cdp):new ChatGptPage(cdp)}
 }
 async listModels():Promise<readonly BrowserProviderModel[]>{return this.provider==='deepseek'?[{id:'deepseek-web',name:'DeepSeek Web'}]:[{id:'chatgpt-web',name:'ChatGPT Web'}]}
 async checkLogin(){const tabs=await listTabs(this.port);const tab=tabs.find(x=>this.provider==='deepseek'?/deepseek\.com/.test(x.url):/chatgpt\.com/.test(x.url));if(!tab)return false;const cdp=await connectTab(tab);try{const page=this.provider==='deepseek'?new DeepSeekPage(cdp):new ChatGptPage(cdp);return await page.isLoggedIn()}finally{await cdp.close()}}
 async *chat(req:BrowserChatRequest){
  const sessionId=req.sessionId??req.accountId
  const {page,cdp}=await this.page(sessionId,req.accountId)
  try{
   const last=req.messages.filter(m=>m.role==='user').at(-1)?.content
   if(!last)throw new Error('没有可发送的用户消息')
   if(!await page.isLoggedIn())throw new Error('网页账号需要登录')
   await page.sendMessage(last)
   for await(const delta of page.streamAnswer(req.signal))yield delta
  }finally{await cdp.close()}
 }
 classifyError(error:unknown):BrowserProviderErrorCode{
  const s=error instanceof Error?error.message:String(error)
  if(/登录|log in|sign in/i.test(s))return 'LOGIN_REQUIRED'
  if(/额度|limit|quota|usage limit/i.test(s))return 'QUOTA_EXCEEDED'
  if(/频繁|too many|rate limit/i.test(s))return 'RATE_LIMITED'
  if(/timeout|超时/i.test(s))return 'SERVICE_UNAVAILABLE'
  if(/未找到|没有找到|输入框|DOM/i.test(s))return 'PAGE_CHANGED'
  return 'UNKNOWN'
 }
}