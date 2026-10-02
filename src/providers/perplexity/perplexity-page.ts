import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * Perplexity Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class PerplexityPage extends WebPageAdapter{
 expectedHost(){return "perplexity.ai"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea,[contenteditable=\"true\"],textarea[placeholder*=\"Ask\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:search|thread)/([\w-]+)/)||[])[1],ready:!!document.querySelector("textarea,[contenteditable=\"true\"],textarea[placeholder*=\"Ask\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea,[contenteditable=\"true\"],textarea[placeholder*=\"Ask\"]",'发送|send|submit|生成',text,"Perplexity")
 }

 async readAnswer(previous:string){
  return this.readLatest("[data-testid*=\"answer\"],[class*=\"prose\"],main article",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("sign in|log in|登录")
 }
}
