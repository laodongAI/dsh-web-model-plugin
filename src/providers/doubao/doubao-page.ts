import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * 豆包 Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class DoubaoPage extends WebPageAdapter{
 expectedHost(){return "doubao.com"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea,[contenteditable=\"true\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:chat|conversation|bot/chat)/([\w-]+)/)||[])[1],ready:!!document.querySelector("textarea,[contenteditable=\"true\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea,[contenteditable=\"true\"]",'发送|send|submit|生成',text,"豆包")
 }

 async readAnswer(previous:string){
  return this.readLatest("[class*=\"message\"],[class*=\"markdown\"],main article",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("登录|手机号登录|登录后")
 }
}
