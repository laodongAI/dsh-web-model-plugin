import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * Microsoft Copilot Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class CopilotPage extends WebPageAdapter{
 expectedHost(){return "copilot.microsoft.com"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"Message\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:conversation|c)/([\w-]+)/)||[])[1],ready:!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"Message\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea,[contenteditable=\"true\"],input[placeholder*=\"Message\"]",'发送|send|submit|生成',text,"Microsoft Copilot")
 }

 async readAnswer(previous:string){
  return this.readLatest("[data-content],main article,[class*=\"markdown\"],[class*=\"response\"]",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("sign in|登录|account")
 }
}
