const PROVIDERS=[
 ['deepseek','DeepSeek','https://chat.deepseek.com/'],['chatgpt','ChatGPT','https://chatgpt.com/'],['qwen','Qwen','https://chat.qwen.ai/'],
 ['tencent-yuanbao','腾讯混元 AI Studio','https://aistudio.tencent.com/'],['doubao','豆包','https://www.doubao.com/chat/'],['perplexity','Perplexity','https://www.perplexity.ai/'],
 ['copilot','Microsoft Copilot','https://copilot.microsoft.com/'],['huggingchat','HuggingChat','https://huggingface.co/chat/'],['kimi','Kimi','https://kimi.moonshot.cn/'],['chatglm','智谱 AI','https://chatglm.cn/'],
]

// Web AI 不再提供 Settings 配置页。Provider 选择由 DSH 中间模型选择器直接完成。
// 右侧 Sidebar 使用 DSH 原生 Browser 多 Tab；Host 侧按选中的 Provider 自动建立 CDP 浏览器会话。
function apply(){
 console.info('[dsh-account-models] client active: provider selection moved to DSH model selector')
}
module.exports={apply}
