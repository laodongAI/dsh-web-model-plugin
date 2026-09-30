import { spawn,type ChildProcess } from 'node:child_process'
import { access,mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {AccountProvider} from './types.js'
const basePorts:Record<AccountProvider,number>={deepseek:9229,chatgpt:9230}
function candidates(){if(process.platform==='win32')return [process.env.LOCALAPPDATA,process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).flatMap(root=>[join(root!,'Google/Chrome/Application/chrome.exe'),join(root!,'Chromium/Application/chrome.exe')]);if(process.platform==='darwin')return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium'];return ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser']}
async function findChrome(){for(const p of [...(process.env.DSH_CHROME_PATH?[process.env.DSH_CHROME_PATH]:[]),...candidates()]){try{await access(p);return p}catch{}}throw new Error('未找到 Chrome/Chromium；请设置 DSH_CHROME_PATH。')}
function hash(s:string){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return h}
export class BrowserManager {
 private processes=new Map<string,{process:ChildProcess;port:number}>()
 getPort(id:string){return this.processes.get(id)?.port}
 isRunning(id:string){const p=this.processes.get(id);return !!p&&p.process.exitCode===null}
 async open(id:string,provider:AccountProvider,profileDir:string){if(this.isRunning(id))return this.getPort(id)!;await mkdir(profileDir,{recursive:true});const exe=await findChrome();const port=basePorts[provider]+Math.abs(hash(id))%1000;const url=provider==='deepseek'?'https://chat.deepseek.com/':'https://chatgpt.com/';const p=spawn(exe,['--no-first-run','--no-default-browser-check','--disable-sync',`--user-data-dir=${profileDir}`,`--remote-debugging-port=${port}`,'--new-window',url],{stdio:'ignore'});p.on('exit',()=>this.processes.delete(id));p.on('error',()=>this.processes.delete(id));this.processes.set(id,{process:p,port});return port}
 async close(id:string){const p=this.processes.get(id);if(!p)return;p.process.kill();this.processes.delete(id)}
 async closeAll(){for(const id of [...this.processes.keys()])await this.close(id)}
}