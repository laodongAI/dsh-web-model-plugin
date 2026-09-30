import type {CdpClient} from '../browser/cdp-client.js'
export abstract class WebPageAdapter {
 constructor(protected readonly cdp:CdpClient){}
 abstract isLoggedIn():Promise<boolean>
 abstract sendMessage(text:string):Promise<void>
 abstract readAnswer(previous:string):Promise<string>
 abstract waitForAnswer(signal?:AbortSignal):Promise<void>
 abstract detectError():Promise<{code:string;message:string}|null>
 abstract isGenerating():Promise<boolean>
 async stop(){await this.cdp.evaluate<void>(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/stop|停止|中止/i.test(x.textContent||''));b?.click()})()`)}
}