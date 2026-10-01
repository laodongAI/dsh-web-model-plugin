 async readAnswer(previous:string){return this.readLatest("[class*=\"message\"],[class*=\"markdown\"],main article",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<any>(`(()=>{const t=document.body?.innerText||'';if(/登录|手机号登录|sign in/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'Kimi 需要登录'};if(/额度|limit|quota|频繁/i.test(t))return {code:'QUOTA_EXCEEDED',message:'Kimi 当前达到使用限制'};return null})()`)}
} async detectError(){return this.commonError("登录|sign in|log in")}}