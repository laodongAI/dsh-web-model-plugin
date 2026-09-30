export type AccountProvider = 'deepseek' | 'chatgpt'
export type AccountStatus = 'unknown' | 'login_required' | 'ready' | 'browser_closed' | 'error'
export interface AccountRecord {
  id:string; provider:AccountProvider; displayName:string; profileDir:string; status:AccountStatus
  createdAt:string; updatedAt:string; lastError?:string
}
export interface AccountSnapshot extends AccountRecord { browserRunning:boolean }