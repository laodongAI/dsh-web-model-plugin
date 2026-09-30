import type {AccountProvider} from '../types.js'
export type BrowserProviderErrorCode='LOGIN_REQUIRED'|'SESSION_EXPIRED'|'QUOTA_EXCEEDED'|'RATE_LIMITED'|'SERVICE_UNAVAILABLE'|'PAGE_CHANGED'|'UNKNOWN'
export interface BrowserProviderModel{id:string;name:string;description?:string}
export interface BrowserAttachment{path:string;name?:string;kind:'image'|'file'}
export interface BrowserChatRequest{
 accountId:string; model:string; sessionId?:string;
 messages:readonly {role:string;content:string}[]; attachments?:readonly BrowserAttachment[]; signal?:AbortSignal
}
export interface BrowserProvider{
 readonly provider:AccountProvider
 listModels():Promise<readonly BrowserProviderModel[]>
 checkLogin():Promise<boolean>
 chat(request:BrowserChatRequest):AsyncIterable<string>
 classifyError(error:unknown):BrowserProviderErrorCode
}