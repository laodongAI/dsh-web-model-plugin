export type AccountProvider = 'deepseek' | 'chatgpt' | 'qwen' | 'tencent-yuanbao' | 'doubao' | 'perplexity' | 'copilot' | 'huggingchat' | 'kimi'
export type AccountStatus = 'unknown' | 'login_required' | 'ready' | 'browser_closed' | 'error'
export interface AccountRecord { id:string; provider:AccountProvider; displayName:string; profileDir:string; debugPort:number; status:AccountStatus; createdAt:string; updatedAt:string; lastError?:string }
export interface AccountSnapshot extends AccountRecord { browserRunning:boolean }