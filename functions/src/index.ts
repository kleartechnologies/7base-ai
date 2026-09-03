import { setGlobalOptions } from 'firebase-functions/v2'

/**
 * MARKA backend entry point.
 *
 * Deployed close to the users this product serves. Every export here is an
 * authenticated boundary — no function trusts its caller's claims about
 * ownership, and no secret ever crosses back to the client.
 */
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 })

export { chatAssistantReply } from './chat/assistantReply'
export { campaignBuildFromRecommendation } from './campaign/build'
export { creativeGenerateFromCampaign, creativeRetryImage } from './creative/generate'
export {
  businessStartWebsiteAnalysis,
  businessRunWebsiteAnalysis,
} from './business/analyzeWebsite'
