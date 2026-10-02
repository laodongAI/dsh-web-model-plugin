import {LlmAdapter,LlmError,type GenerateOptions,type LlmModelInfo,type LlmResolvedModelInfo,type StreamChunk,type ToolCallId} from '@deepseek-ai/dsh-llm'
import type {AccountManager} from './account-manager.js'
import type {AttachmentStore} from '@deepseek-ai/dsh-attachment'
import {PROVIDERS,PROVIDER_MAP} from './provider-catalog.js'
import type {AccountProvider} from './types.js'

function providerOfModel(model:string):AccountProvider|undefined{
 if((PROVIDERS as readonly {id:AccountProvider}[]).some(x=>x.id===model))return model as AccountProvider
 return undefined
}

const TOOL_CALL_RE=/<dsh_tool_call>\s*([\s\S]*?)\s*<\/dsh_tool_call>/g

function stripToolCalls(text:string){return text.replace(TOOL_CALL_RE,'').trim()}
/** 从文本提取 <dsh_tool_call> 工具调用；uniqueSeed 参与 ID 生成保证跨轮/跨会话唯一 */
function extractToolCalls(text:string,uniqueSeed:string,allowedTools:ReadonlySet<string>){
 const calls:{id:ToolCallId;name:string;arguments:string}[]=[]
 let i=0
 let openingTags=0
 for(const _match of text.matchAll(/<dsh_tool_call>/g))openingTags++
 for(const match of text.matchAll(TOOL_CALL_RE)){
  i++
  try{
   const value=JSON.parse(match[1]) as {name?:unknown;arguments?:unknown;id?:unknown}
   if(typeof value.name!=='string'||!value.name.trim())throw new Error('工具名称无效')
   const name=value.name.trim()
   if(!allowedTools.has(name))throw new Error(`模型请求了本轮未提供的工具：${name}`)
   const args=typeof value.arguments==='string'?value.arguments:JSON.stringify(value.arguments??{})
   const parsedArgs=JSON.parse(args) as unknown
   if(!parsedArgs||typeof parsedArgs!=='object'||Array.isArray(parsedArgs))throw new Error(`工具 ${name} 的 arguments 必须是 JSON 对象`)
   calls.push({id:(typeof value.id==='string'&&value.id?value.id:`web-${uniqueSeed}-${i}`) as ToolCallId,name,arguments:args})
  }catch(error){
   throw new LlmError(`网页返回了无效的 DSH 工具调用：${error instanceof Error?error.message:String(error)}`,'PROVIDER_ERROR',{cause:error})
  }
 }
 if(openingTags!==calls.length)throw new LlmError('网页返回了未闭合或格式错误的 DSH 工具调用','PROVIDER_ERROR')
 return calls
}
export class DshBrowserAdapter extends LlmAdapter{
 private readonly conversations=new Map<string,{provider:AccountProvider}>()
 // 同 session 并发防护：一个 DSH 会话同时只允许一个 Web AI 请求在途，防止重复发送到网页
 private readonly inflight=new Set<string>()

 /** recovery.loginWaitTimeoutMs：LOGIN_REQUIRED/PAGE_CHANGED 时"等待用户在右侧浏览器修复后自动继续"的最长等待毫秒数；0=不等待直接报错 */
 constructor(private readonly accounts:AccountManager,private readonly attachments:AttachmentStore,private readonly recovery:{loginWaitTimeoutMs:number}={loginWaitTimeoutMs:0}){super()}

 override providerInfo(provider:string){
  return {id:provider,name:'Web AI（浏览器）'}
 }

 override async listModels(provider:string):Promise<readonly LlmModelInfo[]>{
  if(provider!=='web-ai')return []
  return PROVIDERS.map(item=>{
   const account=this.accounts.findByProvider(item.id)
   const state=account?.status==='ready'?'已就绪'
    :account?.status==='login_required'?'需要登录'
    :account?.status==='page_changed'?'页面需要恢复'
    :account?.status==='error'?'页面异常'
    :'首次使用将打开浏览器'
   return {provider,id:item.id,name:item.name+'（浏览器）',description:`${item.name} · ${state}`,inputModalities:['text','image'] as const}
  })
 }

 override async resolveModel(provider:string,model:string,signal?:AbortSignal):Promise<LlmResolvedModelInfo>{
  if(signal?.aborted)throw signal.reason??new Error('请求已取消')
  if(provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${provider}`,'MODEL_UNAVAILABLE')
  const selected=providerOfModel(model)
  if(selected){
   this.accounts.selectProvider(selected)
   const account=this.accounts.findByProvider(selected)
   return {provider,id:model,name:PROVIDER_MAP[selected].name+'（浏览器）',inputModalities:['text','image']}
  }
  const legacy=this.accounts.list().find(a=>a.id===model)
  if(legacy)return {provider,id:model,name:legacy.displayName,inputModalities:['text','image']}
  throw new LlmError(`未知 Web AI 模型：${model}`,'MODEL_UNAVAILABLE')
 }

 override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
  if(options.provider!=='web-ai')throw new LlmError(`未知 Web AI Provider：${options.provider}`,'MODEL_UNAVAILABLE')
  const selected=providerOfModel(options.model)
  if(!selected)throw new LlmError('必须从 DSH 中间模型选择器选择一个 Web AI Provider','MODEL_UNAVAILABLE')
  // 参数校验提前到启动浏览器之前，避免开页面后才报 UNSUPPORTED_OPTION
  this.validateOptions(options)

  this.accounts.selectProvider(selected)
  const account=await this.accounts.ensureProvider(selected)
  let adapter=this.accounts.getProvider(account.id)
  if(!adapter){
   await this.accounts.open(account.id)
   adapter=this.accounts.getProvider(account.id)
  }
  if(!adapter)throw new LlmError('账号浏览器启动失败，请检查对应 Provider 的浏览器会话','SERVICE_UNAVAILABLE')

  this.validateOptions(options)
  const sessionId=options.sessionId?String(options.sessionId):account.id
  if(this.inflight.has(sessionId))throw new LlmError('当前 DSH 会话已有 Web AI 请求在进行中，请等待完成或点停止','PROVIDER_ERROR')
  this.inflight.add(sessionId)
  try{
  const toolSchemas=options.tools??[]
  const browserAttachments=this.collectAttachments(options.messages)
  const state=this.conversations.get(sessionId)
  const firstTurn=!state||state.provider!==selected
  const prompt=this.buildBrowserPrompt(options,firstTurn,toolSchemas)
  // —— 实时流式状态：answer=网页累计回答；emitted=已作为 text-delta 下发的字符数；blockOpen=是否已发出 text block-start ——
 let answer=''
  let emitted=0
  let blockOpen=false
  let messageSubmitted=false
  const chatRequest={accountId:account.id,model:options.model,sessionId,messages:[{role:'user',content:prompt}],attachments:browserAttachments,signal:options.signal,onSubmitted:()=>{messageSubmitted=true}}
  const runChat=()=>adapter.chat(chatRequest)
  const resumeChat=()=>adapter.resume(chatRequest)
  // consume：边收网页增量，边把 <dsh_tool_call> 标签之前的安全前缀实时下发给 DSH；疑似半截标签前缀暂缓，避免泄漏为正文
  const consume=async function*(iter:AsyncIterable<string>):AsyncIterable<StreamChunk>{
   for await(const delta of iter){
    if(!delta)continue
    answer+=delta
    const tagStart=answer.indexOf('<dsh_tool_call>')
    let safeEnd=tagStart>=0?tagStart:answer.length
    if(tagStart<0){for(let n=Math.min(14,answer.length);n>0;n--){if(answer.endsWith('<dsh_tool_call>'.slice(0,n))){safeEnd=answer.length-n;break}}}
    if(safeEnd>emitted){
     if(!blockOpen){yield {type:'block-start',index:0,blockType:'text'};blockOpen=true}
     yield {type:'text-delta',index:0,text:answer.slice(emitted,safeEnd)}
     emitted=safeEnd
    }
   }
  }
  try{
   try{
    for await(const chunk of consume(runChat()))yield chunk
   }catch(chatError){
    // 可恢复异常（需登录/页面变化/暂不可用）且尚未产出任何内容：提示用户修复，轮询恢复后自动重试本次请求
    const chatCode=adapter.classifyError(chatError)
    const recoverable=messageSubmitted&&emitted===0&&!options.signal?.aborted&&this.recovery.loginWaitTimeoutMs>0&&(chatCode==='LOGIN_REQUIRED'||chatCode==='PAGE_CHANGED'||chatCode==='SERVICE_UNAVAILABLE')
    if(!recoverable)throw chatError
    const reason=chatCode==='LOGIN_REQUIRED'?'需要登录':chatCode==='PAGE_CHANGED'?'页面或会话发生变化':'页面暂不可用'
    if(!blockOpen){yield {type:'block-start',index:0,blockType:'text'};blockOpen=true}
    yield {type:'text-delta',index:0,text:`[${PROVIDER_MAP[selected].name} ${reason}] 请在 DSH 右侧浏览器完成登录/修复页面（最长等待 ${Math.round(this.recovery.loginWaitTimeoutMs/60000)} 分钟），恢复后将自动继续本次请求……\n\n`}
    const recovered=await this.waitForRecovery(adapter,this.recovery.loginWaitTimeoutMs,options.signal,sessionId)
    if(!recovered)throw chatError
    yield {type:'text-delta',index:0,text:'[检测到页面已恢复，自动继续]\n\n'}
    // Resume reading the already-submitted response; never submit the user's prompt twice.
    answer=''
    for await(const chunk of consume(resumeChat()))yield chunk
   }
   this.conversations.set(sessionId,{provider:selected})
   const toolCalls=extractToolCalls(answer,`${sessionId}-${Date.now().toString(36)}`,new Set(toolSchemas.map(tool=>tool.name)))
   const visible=stripToolCalls(answer)
   if(toolCalls.length){
    if(visible){
     if(emitted<visible.length){if(!blockOpen){yield {type:'block-start',index:0,blockType:'text'};blockOpen=true};yield {type:'text-delta',index:0,text:visible.slice(emitted)}}
     yield {type:'block-end',index:0,block:{type:'text',text:visible}}
    }
    for(let i=0;i<toolCalls.length;i++){
     const call=toolCalls[i]
     const index=i+(visible?1:0)
     yield {type:'block-start',index,blockType:'tool-call'}
     yield {type:'tool-call-delta',index,id:call.id,name:call.name,argumentsDelta:call.arguments}
     yield {type:'block-end',index,block:{type:'tool-call',id:call.id,name:call.name,arguments:call.arguments}}
    }
    yield {type:'finish',reason:{kind:'tool-calls'}}
    return
   }
   if(!visible)throw new LlmError('网页没有提取到模型回答','EMPTY_RESPONSE')
   // 正常结束：补发尚未下发的尾部文本（曾被暂缓的半截前缀最终证实不是工具标签）
   if(emitted<visible.length){if(!blockOpen){yield {type:'block-start',index:0,blockType:'text'};blockOpen=true};yield {type:'text-delta',index:0,text:visible.slice(emitted)}}
   yield {type:'block-end',index:0,block:{type:'text',text:visible}}
   yield {type:'finish',reason:{kind:'stop'}}
  }catch(error){
   // 用户主动取消（Stop）：按 LLM 协议映射为 ABORTED，避免被误报为 PROVIDER_ERROR
   if(options.signal?.aborted&&!(error instanceof LlmError))throw new LlmError('请求已取消','ABORTED',{cause:error})
   const code=adapter.classifyError(error)
   const providerName=PROVIDER_MAP[selected].name
   const detail=error instanceof Error?error.message:String(error)
   if(code==='LOGIN_REQUIRED'||code==='SESSION_EXPIRED'){
    throw new LlmError(`${providerName} 尚未完成登录或登录状态已失效。请在 DSH 右侧浏览器完成登录/验证，确认页面可以正常对话后，再回到 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'AUTH',{cause:error})
   }
   if(code==='PAGE_CHANGED'){
    throw new LlmError(`${providerName} 右侧浏览器的页面或会话发生变化，当前请求无法继续。请在右侧浏览器恢复到可对话页面，然后在 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'PROVIDER_ERROR',{cause:error})
   }
   if(code==='SERVICE_UNAVAILABLE'){
    throw new LlmError(`${providerName} 没有在规定时间内返回响应。请检查 DSH 右侧浏览器中的页面、网络和登录状态，修复后在 DSH Chat 重新发送。\n浏览器地址：${PROVIDER_MAP[selected].url}`,'UNAVAILABLE',{cause:error})
   }
   const mapped=code==='RATE_LIMITED'?'RATE_LIMIT':code==='QUOTA_EXCEEDED'?'QUOTA_EXCEEDED':'PROVIDER_ERROR'
   throw error instanceof LlmError?error:new LlmError(`${providerName} Web AI 请求失败：${detail}` ,mapped,{cause:error})
  }
  }finally{
   // 无论成功/失败/取消都释放并发锁，防止死锁后续请求
   this.inflight.delete(sessionId)
  }
 }

 /** 轮询页面健康直到 ready/超时/取消；用于"等待用户手工修复后自动继续"的恢复窗口 */
 private async waitForRecovery(adapter:{health(sessionId?:string):Promise<{status:string}>},timeoutMs:number,signal:AbortSignal|undefined,sessionId:string){
  const deadline=Date.now()+timeoutMs
  while(Date.now()<deadline){
   if(signal?.aborted)return false
   await new Promise(resolve=>setTimeout(resolve,500))
   if(signal?.aborted)return false
   try{if((await adapter.health(sessionId)).status==='ready')return true}catch(error){
    console.warn('[dsh-account-models] recovery health check failed:',error)
   }
  }
  return false
 }

 private validateOptions(options:GenerateOptions){
  if(options.reasoningEffort){
   throw new LlmError('Web AI 浏览器模式当前不能可靠控制 reasoningEffort，请在模型原生网页中使用默认推理设置','UNSUPPORTED_OPTION')
  }
  if(options.temperature!==undefined){
   throw new LlmError('Web AI 浏览器模式当前不能可靠控制 temperature；请使用 Provider 网页自身的生成设置','UNSUPPORTED_OPTION')
  }
  if(options.maxTokens!==undefined){
   throw new LlmError('Web AI 浏览器模式当前不能可靠控制 maxTokens；请使用 Provider 网页自身的生成设置','UNSUPPORTED_OPTION')
  }
  if(options.stop?.length){
   throw new LlmError('Web AI 浏览器模式当前不能可靠控制 stop 序列','UNSUPPORTED_OPTION')
  }
 }

 private buildBrowserPrompt(
  options:GenerateOptions,
  firstTurn:boolean,
  tools:NonNullable<GenerateOptions['tools']>,
 ):string{
  const toolInstruction=tools.length?this.buildToolInstruction(tools):''
  if(!firstTurn){
   const latest=options.messages.at(-1)
   const content=this.renderMessageContent(latest)
   if(latest?.role==='tool'){
    return [
     '继续执行当前 DSH Agent 任务。',
     toolInstruction,
     '下面是刚刚由 DSH 主机实际执行工具得到的结果。不要把它当成用户新问题，也不要伪造工具执行；请基于结果继续推理。',
     '<dsh_tool_result>',
     content,
     '</dsh_tool_result>',
    ].filter(Boolean).join('\n\n')
   }
   if(latest?.role==='user'){
    return [
     '继续当前 DSH Agent 对话。网页会话中已经保留此前对话历史，请只处理下面这一条新的用户消息。',
     toolInstruction,
     '<dsh_user_message>',
     content,
     '</dsh_user_message>',
    ].filter(Boolean).join('\n\n')
   }
   return [toolInstruction,content].filter(Boolean).join('\n\n')
  }

  const history=options.messages.map(message=>{
   const content=this.renderMessageContent(message)
   return `[${message.role}]\n${content}`
  }).join('\n\n')
  const system=options.system?.trim()
  return [
   '你现在是 DSH Agent 使用的 Web AI 模型。DSH 主机负责工作区、文件、命令和工具执行；你只负责理解任务、推理并返回下一步结果。',
   '下面是本次 DSH 请求的完整已组装上下文。请把它视为一次真实 LLM 请求的 messages，不要要求用户重新提供这些上下文。',
   system?'<dsh_system>\n'+system+'\n</dsh_system>':'',
   toolInstruction,
   '<dsh_messages>',
   history,
   '</dsh_messages>',
  ].filter(Boolean).join('\n\n')
 }

 private buildToolInstruction(tools:NonNullable<GenerateOptions['tools']>):string{
  const catalog=tools.map(tool=>JSON.stringify({
   name:tool.name,
   description:tool.description,
   parameters:tool.parameters,
  })).join('\n')
  return [
   'DSH 主机保留工具执行权。',
   '如果需要调用工具，只能输出一个或多个 <dsh_tool_call>...</dsh_tool_call>。',
   '标签内部必须是 JSON：{"id":"可选调用ID","name":"工具名","arguments":工具参数对象}。',
   '不要直接声称工具已经执行；必须先输出工具调用，等待 DSH 主机返回工具结果。',
   '如果不需要工具，直接正常回答。',
   '当前可用工具：',
   catalog,
  ].join('\n')
 }

 private renderMessageContent(message:GenerateOptions['messages'][number]|undefined):string{
  if(!message)return ''
  if(typeof message.content==='string')return message.content
  return message.content.map(block=>{
   if(block.type==='text')return block.text
   if(block.type==='reasoning')return `[reasoning]\n${block.text}`
   if(block.type==='tool-call')return `[tool-call ${block.name}]\n${block.arguments}`
   if(block.type==='tool-addition')return `[tool-addition] ${block.toolName}`
   if(block.type==='tool-removal')return `[tool-removal] ${block.toolName}`
   if(block.type==='file')return `[file] ${block.attachment.name??'unnamed'}`
   if(block.type==='image')return `[image] ${block.attachment.name??'unnamed'}`
   return ''
  }).filter(Boolean).join('\n')
 }

 private collectAttachments(messages:GenerateOptions['messages']):readonly {path:string;name?:string;kind:'image'|'file'}[]{
  const latest=[...messages].reverse().find(m=>m.role==='user')
  if(!latest||typeof latest.content==='string')return []
  const result:{path:string;name?:string;kind:'image'|'file'}[]=[]
  for(const block of latest.content){
   if(block.type==='image'){
    const path=this.attachments.imageHostPath(block.attachment)
    if(path)result.push({path,name:block.attachment.name,kind:'image'})
   }else if(block.type==='text'){
    const match=block.text.match(/\[File\s+"[^"]+"\s+\(\d+\s+bytes,\s+sha256:[^)]+\):\s+verbatim\s+read-only\s+copy\s+saved\s+at\s+"([^"]+)"/)
    if(match){
     try{result.push({path:JSON.parse('"'+match[1]+'"'),kind:'file'})}catch{}
    }
   }
  }
  const seen=new Set<string>()
  return result.filter(x=>seen.has(x.path)?false:(seen.add(x.path),true))
 }
}
