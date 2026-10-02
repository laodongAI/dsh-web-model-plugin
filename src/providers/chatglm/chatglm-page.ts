import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/**
 * 智谱 AI Web 页面适配器。
 * 仅通过 DSH 右侧可见 WebView/GuestView 的 DOM 交互，
 * 不调用 Provider 私有 HTTP API。
 */
export class ChatGlmPage extends WebPageAdapter{
 expectedHost(){return "chatglm.cn"}

 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"聊天\"],input[placeholder*=\"消息\"]"))()`)
 }

 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:chat|conversation|c)/([a-zA-Z0-9_-]+)/)||[])[1],ready:!!document.querySelector("textarea,[contenteditable=\"true\"],input[placeholder*=\"聊天\"],input[placeholder*=\"消息\"]"),changed:false}))()`)
 }

 async sendMessage(text:string){
  await this.fillAndSubmit("textarea,[contenteditable=\"true\"],input[placeholder*=\"聊天\"],input[placeholder*=\"消息\"]",'发送|send|submit|生成',text,"智谱 AI")
 }

 async readAnswer(previous:string){
  return this.readLatest("[class*=\"markdown\"],[class*=\"message\"],[class*=\"assistant\"],main article",previous)
 }

 async isGenerating(){
  return this.isBusy()
 }

 async detectError(){
  return this.commonError("微信扫码登录|手机号登录|请输入手机号|获取验证码")
 }
}
