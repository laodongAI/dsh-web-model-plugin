import {PAGE_CONFIGS} from '../../provider-catalog.js'
import {ConfiguredWebPage,type WebPageTiming} from '../web-page.js'
import type {CdpClient} from '../../browser/cdp-client.js'

/** Microsoft Copilot compatibility export backed by the shared provider config. */
export class CopilotPage extends ConfiguredWebPage{
 constructor(cdp:CdpClient,timing:WebPageTiming){
  super(PAGE_CONFIGS.copilot,cdp,timing)
 }
}
