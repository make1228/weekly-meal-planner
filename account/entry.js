import {accountConfig} from './config.js';
import {installCloudSync as installLegacyCompatibleUI} from '../cloud-ui.js';
import {createAccountSync} from './transport.js';
export function installCloudSync(adapter){
 return accountConfig.mode==='public'
  ?installLegacyCompatibleUI(adapter,{config:accountConfig,transport:createAccountSync,accountMode:true})
  :installLegacyCompatibleUI(adapter);
}
