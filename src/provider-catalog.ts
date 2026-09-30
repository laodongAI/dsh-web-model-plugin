import type {AccountProvider} from './types.js'

export interface ProviderCatalogItem {
 id:AccountProvider
 name:string
 url:string
 hostPattern:RegExp
 basePort:number
}

export const PROVIDERS:readonly ProviderCatalogItem[]=[
 {id:'deepseek',name:'DeepSeek',url:'https://chat.deepseek.com/',hostPattern:/deepseek\.com/i,basePort:9229},
 {id:'chatgpt',name:'ChatGPT',url:'https://chatgpt.com/',hostPattern:/chatgpt\.com/i,basePort:9230},
 {id:'qwen',name:'Qwen',url:'https://chat.qwen.ai/',hostPattern:/chat\.qwen\.ai/i,basePort:9231},
 {id:'tencent-yuanbao',name:'腾讯混元 AI Studio',url:'https://aistudio.tencent.com/',hostPattern:/aistudio\.tencent\.com/i,basePort:9232},
 {id:'doubao',name:'豆包',url:'https://www.doubao.com/chat/',hostPattern:/doubao\.com/i,basePort:9233},
 {id:'perplexity',name:'Perplexity',url:'https://www.perplexity.ai/',hostPattern:/perplexity\.ai/i,basePort:9234},
 {id:'copilot',name:'Microsoft Copilot',url:'https://copilot.microsoft.com/',hostPattern:/copilot\.microsoft\.com/i,basePort:9235},
 {id:'huggingchat',name:'HuggingChat',url:'https://huggingface.co/chat/',hostPattern:/huggingface\.co/i,basePort:9236},
 {id:'kimi',name:'Kimi',url:'https://kimi.moonshot.cn/',hostPattern:/kimi\.(?:moonshot\.cn|com)/i,basePort:9237},
 {id:'chatglm',name:'智谱 AI',url:'https://chatglm.cn/',hostPattern:/chatglm\.cn/i,basePort:9238},
]

export const PROVIDER_MAP=Object.fromEntries(PROVIDERS.map(x=>[x.id,x])) as Record<AccountProvider,ProviderCatalogItem>
export const providerName=(provider:AccountProvider)=>PROVIDER_MAP[provider].name
