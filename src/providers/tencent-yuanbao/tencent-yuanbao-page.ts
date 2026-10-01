 async readAnswer(previous:string){return this.readLatest("main article,[class*=\"message\"],[class*=\"answer\"],[class*=\"markdown\"]",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<any>(`(()=>{const t=document.body?.innerText||'';if(/登录|请登录|sign in/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'腾讯 AI Studio 需要登录'};if(/额度|限额|quota|rate limit/i.test(t))return {code:'QUOTA_EXCEEDED',message:'当前账号达到使用限制'};return null})()`)}
} async detectError(){return this.commonError("登录|sign in|log in")}}