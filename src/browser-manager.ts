import {spawn,type ChildProcess} from 'node:child_process'
import {access,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import type {AccountProvider} from './types.js'
import {listTabs} from './browser/cdp-client.js'

export interface BrowserManagerConfig {
 chromePath?:string
 cdpReadyTimeoutMs:number
}

const basePorts:Record<AccountProvider,number>={deepseek:9229,chatgpt:9230,qwen:9231,'tencent-yuanbao':9232,doubao:9233,perplexity:9234,copilot:9235,huggingchat:9236,kimi:9237,chatglm:9238}

function candidates(){
 if(process.platform==='win32'){
  return [process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).flatMap(root=>[
   join(root!,'Google/Chrome/Application/chrome.exe'),
   join(root!,'Chromium/Application/chrome.exe')
  ])
 }
 if(process.platform==='darwin')return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium']
 return ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser']
}

async function findChrome(config:BrowserManagerConfig){
 for(const p of [...(config.chromePath?[config.chromePath]:[]),...(process.env.DSH_CHROME_PATH?[process.env.DSH_CHROME_PATH]:[]),...candidates()]){
  try{await access(p);return p}catch{}
 }
 throw new Error('未找到 Chrome/Chromium；请在插件配置中设置 chromePath 或环境变量 DSH_CHROME_PATH。')
}

async function portResponds(port:number){
 try{await listTabs(port);return true}catch{return false}
}

async function findFreePort(start:number){
 for(let offset=0;offset<1000;offset++){
  const port=start+offset
  if(!(await portResponds(port)))return port
 }
 throw new Error(`无法从端口 ${start} 开始找到可用 CDP 端口`)
}

async function waitCdpReady(port:number,timeoutMs:number){
 const deadline=Date.now()+timeoutMs
 let lastError:unknown
 while(Date.now()<deadline){
  try{await listTabs(port);return}
  catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,200))}
 }
 throw new Error(`Chromium CDP 在 ${timeoutMs}ms 内未就绪: ${lastError instanceof Error?lastError.message:String(lastError)}`)
}

export class BrowserManager {
 private processes=new Map<string,{process:ChildProcess;port:number}>()

 constructor(private readonly config:BrowserManagerConfig={cdpReadyTimeoutMs:20000}){}

 getPort(id:string){return this.processes.get(id)?.port}
 isRunning(id:string){const p=this.processes.get(id);return !!p&&p.process.exitCode===null}

 async open(id:string,provider:AccountProvider,profileDir:string){
  if(this.isRunning(id))return this.getPort(id)!
  await mkdir(profileDir,{recursive:true})
  const exe=await findChrome(this.config)
  const port=await findFreePort(basePorts[provider])
  const url={deepseek:'https://chat.deepseek.com/',chatgpt:'https://chatgpt.com/',qwen:'https://chat.qwen.ai/','tencent-yuanbao':'https://aistudio.tencent.com/',doubao:'https://www.doubao.com/chat/',perplexity:'https://www.perplexity.ai/',copilot:'https://copilot.microsoft.com/',huggingchat:'https://huggingface.co/chat/',kimi:'https://kimi.moonshot.cn/',chatglm:'https://chatglm.cn/'}[provider]
  const p=spawn(exe,['--no-first-run','--no-default-browser-check','--disable-sync',`--user-data-dir=${profileDir}`,`--remote-debugging-port=${port}`,'--new-window',url],{stdio:'ignore'})
  p.on('exit',()=>this.processes.delete(id))
  p.on('error',()=>this.processes.delete(id))
  this.processes.set(id,{process:p,port})
  try{
   await waitCdpReady(port,this.config.cdpReadyTimeoutMs)
   return port
  }catch(error){
   await this.close(id)
   throw error
  }
 }

 async close(id:string){
  const p=this.processes.get(id)
  if(!p)return
  p.process.kill()
  this.processes.delete(id)
 }

 async closeAll(){for(const id of [...this.processes.keys()])await this.close(id)}
}
