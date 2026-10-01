 async readAnswer(previous:string){return this.readLatest("[data-content],main article,[class*=\"markdown\"],[class*=\"response\"]",previous)}

 async isGenerating(){return this.isBusy()}
 async detectError(){return this.cdp.evaluate<any>(`(()=>{const t=document.body?.innerText||'';if(/sign in|登录|account/i.test(t)&&!document.querySelector('textarea,[contenteditable="true"]'))return {code:'LOGIN_REQUIRED',message:'Microsoft Copilot 需要登录'};if(/limit|quota|too many/i.test(t))return {code:'QUOTA_EXCEEDED',message:'Copilot 当前达到使用限制'};return null})()`)}
} async detectError(){return this.commonError("sign in|登录|account")}}