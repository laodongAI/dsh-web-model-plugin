 async readAnswer(previous:string){return this.readLatest("div.ds-markdown,main article",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<{code:string;message:string}|null>(`(()=>{const t=document.body?.innerText||'';if(/登录|log in|sign in/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'DeepSeek 需要登录'};if(/额度|usage limit|quota/i.test(t))return {code:'QUOTA_EXCEEDED',message:'当前 DeepSeek 账号达到使用限制'};if(/频繁|too many|rate limit/i.test(t))return {code:'RATE_LIMITED',message:'请求过于频繁'};return null})()`)}
} async detectError(){return this.commonError("登录|sign in|log in")}}