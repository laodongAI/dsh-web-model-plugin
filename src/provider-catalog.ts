import type {AccountProvider} from './types.js'
import type {WebPageConfig} from './providers/web-page.js'

export interface ProviderCatalogItem {
 id:AccountProvider
 name:string
 url:string
 hostPattern:RegExp
 basePort:number
}

export const PROVIDERS:readonly ProviderCatalogItem[]=[
 {id:'deepseek',name:'DeepSeek',url:'https://chat.deepseek.com/',hostPattern:/chat\.deepseek\.com/i,basePort:9229},
 {id:'chatgpt',name:'ChatGPT',url:'https://chatgpt.com/',hostPattern:/chatgpt\.com/i,basePort:9230},
 {id:'qwen',name:'Qwen',url:'https://chat.qwen.ai/',hostPattern:/chat\.qwen\.ai/i,basePort:9231},
 {id:'tencent-yuanbao',name:'腾讯元宝',url:'https://yuanbao.tencent.com/',hostPattern:/yuanbao\.tencent\.com/i,basePort:9232},
 {id:'doubao',name:'豆包',url:'https://www.doubao.com/chat/',hostPattern:/doubao\.com/i,basePort:9233},
 {id:'perplexity',name:'Perplexity',url:'https://www.perplexity.ai/',hostPattern:/perplexity\.ai/i,basePort:9234},
 {id:'copilot',name:'Microsoft Copilot',url:'https://copilot.microsoft.com/',hostPattern:/copilot\.microsoft\.com/i,basePort:9235},
 {id:'huggingchat',name:'HuggingChat',url:'https://huggingface.co/chat/',hostPattern:/huggingface\.co\/chat/i,basePort:9236},
 {id:'kimi',name:'Kimi',url:'https://kimi.com/',hostPattern:/kimi\.com/i,basePort:9237},
 {id:'chatglm',name:'智谱 AI',url:'https://chatglm.cn/',hostPattern:/chatglm\.cn/i,basePort:9238},
]

export const PROVIDER_MAP=Object.fromEntries(PROVIDERS.map(x=>[x.id,x])) as Record<AccountProvider,ProviderCatalogItem>
export const providerName=(provider:AccountProvider)=>PROVIDER_MAP[provider].name

/**
 * Host 侧域名匹配单一事实源：URL → Provider。
 * Client 侧（src/client/index.js）因无法 import TS 保持独立清单，修改域名时两处需同步。
 */
export const PROVIDER_DOMAINS:Readonly<Record<AccountProvider,readonly string[]>>={
 deepseek:['chat.deepseek.com'],
 chatgpt:['chatgpt.com','chat.openai.com'],
 qwen:['chat.qwen.ai','qwen.ai'],
 'tencent-yuanbao':['yuanbao.tencent.com'],
 doubao:['doubao.com'],
 perplexity:['perplexity.ai'],
 copilot:['copilot.microsoft.com'],
 huggingchat:['huggingface.co'],
 kimi:['kimi.com','kimi.moonshot.cn'],
 chatglm:['chatglm.cn'],
}

/** 根据 URL 反查 Provider（host 精确或子域匹配）；不匹配返回 undefined */
export function findProviderByHost(url:string):AccountProvider|undefined{
 let host:string
 try{host=new URL(url).hostname.toLowerCase()}catch{return undefined}
 for(const [id,domains] of Object.entries(PROVIDER_DOMAINS) as [AccountProvider,readonly string[]][]){
  if(domains.some(d=>host===d||host.endsWith('.'+d)))return id
 }
 return undefined
}

/** 判断 URL 是否属于指定 Provider */
export function isProviderHost(provider:AccountProvider,url:string):boolean{
 return findProviderByHost(url)===provider
}

// ===== 10 个 Web AI 页面适配器配置表（纯数据；网站改版时只改这里）=====
// 字段含义见 web-page.ts 的 WebPageConfig 注释。
// answerSelectors 收敛原则：优先限定 assistant 容器（role/类名），避免把用户消息气泡当回答。
export const PAGE_CONFIGS:Readonly<Record<AccountProvider,WebPageConfig>>={
 deepseek:{
  displayName:'DeepSeek',host:'deepseek.com',
  inputSelectors:'textarea,[contenteditable="true"]',
  conversationIdPattern:'(?:chat|conversation|c)/([a-zA-Z0-9_-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'div.ds-markdown,[data-message-author-role="assistant"]',
  loginPattern:'登录|log in|sign in',
 },
 chatgpt:{
  displayName:'ChatGPT',host:'chatgpt.com',
  inputSelectors:'textarea,[contenteditable="true"]',
  conversationIdPattern:'(?:c|conversation)/([a-zA-Z0-9_-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[data-message-author-role="assistant"]',
  loginPattern:'log in|sign up|登录|注册',
 },
 qwen:{
  displayName:'Qwen',host:'chat.qwen.ai',
  inputSelectors:'textarea[placeholder*="帮助"],textarea,[contenteditable="true"]',
  conversationIdPattern:'(?:c|chat|conversation)/([a-zA-Z0-9_-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[data-message-author-role="assistant"],.qwen-chat-message,.markdown-body',
  loginPattern:'登录到 Qwen|Log in to Qwen|Sign in to Qwen',
 },
 'tencent-yuanbao':{
  displayName:'腾讯元宝',host:'yuanbao.tencent.com',
  inputSelectors:'textarea,[contenteditable="true"],input[placeholder*="问"],input[placeholder*="消息"]',
  conversationIdPattern:'(?:chat|conversation|c)/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[class*="assistant"] [class*="markdown"],[class*="message"][class*="assistant"]',
  loginPattern:'登录|请登录|sign in',
 },
 doubao:{
  displayName:'豆包',host:'doubao.com',
  inputSelectors:'textarea,[contenteditable="true"]',
  conversationIdPattern:'(?:chat|conversation|bot/chat)/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[class*="message"][class*="assistant"],[class*="markdown"]',
  loginPattern:'登录|手机号登录|登录后',
 },
 perplexity:{
  displayName:'Perplexity',host:'perplexity.ai',
  inputSelectors:'textarea,[contenteditable="true"],textarea[placeholder*="Ask"]',
  conversationIdPattern:'(?:search|thread)/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[data-testid*="answer"],[class*="prose"]',
  loginPattern:'sign in|log in|登录',
 },
 copilot:{
  displayName:'Microsoft Copilot',host:'copilot.microsoft.com',
  inputSelectors:'textarea,[contenteditable="true"],input[placeholder*="Message"]',
  conversationIdPattern:'(?:conversation|c)/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[data-content][class*="response"],[class*="response"] [class*="markdown"]',
  loginPattern:'sign in|登录|account',
 },
 huggingchat:{
  displayName:'HuggingChat',host:'huggingface.co',
  inputSelectors:'textarea,[contenteditable="true"]',
  conversationIdPattern:'/chat/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[data-role="assistant"],[class*="assistant"] [class*="prose"]',
  loginPattern:'sign in|登录',
 },
 kimi:{
  displayName:'Kimi',host:'kimi.com',
  inputSelectors:'textarea,[contenteditable="true"]',
  conversationIdPattern:'(?:chat|conversation|c)/([\\w-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[class*="assistant"] [class*="markdown"],[class*="message"]',
  loginPattern:'登录|手机号登录|sign in',
 },
 chatglm:{
  displayName:'智谱 AI',host:'chatglm.cn',
  // 去掉 input[placeholder*="聊天"]：易匹配到侧栏搜索框
  inputSelectors:'textarea,[contenteditable="true"],input[placeholder*="消息"]',
  conversationIdPattern:'(?:chat|conversation|c)/([a-zA-Z0-9_-]+)',
  sendButtonPattern:'发送|send|submit|生成',
  answerSelectors:'[class*="assistant"] [class*="markdown"],[class*="message"][class*="assistant"]',
  loginPattern:'微信扫码登录|手机号登录|请输入手机号|获取验证码',
 },
}
