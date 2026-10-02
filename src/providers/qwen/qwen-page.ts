import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * Qwen Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class QwenPage extends WebPageAdapter{
 expectedHost(){return "chat.qwen.ai"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea[placeholder*=\"帮助\"],textarea,[contenteditable=\"true\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:c|chat|conversation)/([a-zA-Z0-9_-]+)/)||[])[1],ready:!!document.querySelector("textarea[placeholder*=\"帮助\"],textarea,[contenteditable=\"true\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea[placeholder*=\"帮助\"],textarea,[contenteditable=\"true\"]",'发送|send|submit|生成',text,"Qwen")
 }

 async readAnswer(previous:string){
  return this.readLatest(".qwen-chat-message,[data-message-author-role=\"assistant\"],.message-content,.markdown-body,main article",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("登录到 Qwen|Log in to Qwen|Sign in to Qwen")
 }
}
