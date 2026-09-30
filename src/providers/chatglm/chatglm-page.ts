import {WebPageAdapter,type WebConversationState} from '../web-page.js'

/** 智谱清言网页适配器：仅通过用户可见网页 DOM/CDP 交互，不调用智谱私有 HTTP API。 */
export class ChatGlmPage extends WebPageAdapter{
 expectedHost(){return 'chatglm.cn'}
 async canChat(){
  return this.cdp.evaluate<boolean>(`(()=>{const t=document.body?.innerText||'';if(/微信扫码登录|手机号登录|请输入手机号|获取验证码/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]'))return false;return !!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]')})()`)
 }
 async getConversationState():Promise<WebConversationState>{
  return this.cdp.evaluate<WebConversationState>(`(()=>({url:location.href,conversationId:(location.pathname.match(/(?:chat|conversation|c)\\/([a-zA-Z0-9_-]+)/)||[])[1],ready:!!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]'),changed:false}))()`)
 }
 async sendMessage(text:string){
  await this.cdp.evaluate<void>(`(()=>{const e=document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]');if(!e)throw new Error('PAGE_CHANGED: 智谱 AI 输入框未找到');e.focus();if(e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement){const s=Object.getOwnPropertyDescriptor(e.constructor.prototype,'value')?.set;s?.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))}else{e.textContent=${JSON.stringify(text)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}))}const b=[...document.querySelectorAll('button')].find(x=>/发送|send|提交|生成/i.test((x.textContent||'')+' '+(x.getAttribute('aria-label')||''))&&!x.disabled);if(b)b.click();else e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}))})()`)
 }
 async readAnswer(previous:string){
  return this.cdp.evaluate<string>(`(()=>{const p=${JSON.stringify(previous)};const selectors=['[class*="markdown"]','[class*="message"]','[class*="assistant"]','main article'];const n=selectors.flatMap(s=>[...document.querySelectorAll(s)]).map(x=>(x.innerText||'').trim()).filter(x=>x&&x!==p);return n.at(-1)||''})()`)
 }
 async isGenerating(){
  return this.cdp.evaluate<boolean>(`(()=>[...document.querySelectorAll('button')].some(b=>/停止|stop|中止|取消生成/i.test((b.textContent||'')+' '+(b.getAttribute('aria-label')||''))))()`)
 }
 async detectError(){
  return this.cdp.evaluate<{code:string;message:string}|null>(`(()=>{const t=document.body?.innerText||'';if(/微信扫码登录|手机号登录|请输入手机号|获取验证码/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"],input[placeholder*="聊天"],input[placeholder*="消息"]'))return {code:'LOGIN_REQUIRED',message:'智谱 AI 当前尚未进入可对话状态，请在网页中完成登录'};if(/积分不足|额度|quota|limit reached/i.test(t))return {code:'QUOTA_EXCEEDED',message:'当前智谱 AI 账号达到使用限制'};if(/频繁|too many|rate limit/i.test(t))return {code:'RATE_LIMITED',message:'智谱 AI 请求过于频繁'};if(/服务异常|service unavailable|网络错误/i.test(t))return {code:'SERVICE_UNAVAILABLE',message:'智谱 AI Web 服务暂时不可用'};return null})()`)
 }
}
