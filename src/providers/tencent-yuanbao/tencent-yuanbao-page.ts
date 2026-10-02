import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * 腾讯元宝 Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class TencentYuanbaoPage extends WebPageAdapter{
 expectedHost(){return "yuanbao.tencent.com"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"问\"],input[placeholder*=\"消息\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:chat|conversation|c)/([\w-]+)/)||[])[1],ready:!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"问\"],input[placeholder*=\"消息\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea,[contenteditable=\"true\"],input[placeholder*=\"问\"],input[placeholder*=\"消息\"]",'发送|send|submit|生成',text,"腾讯元宝")
 }

 async readAnswer(previous:string){
  return this.readLatest("main article,[class*=\"message\"],[class*=\"answer\"],[class*=\"markdown\"]",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("登录|请登录|sign in")
 }
}
