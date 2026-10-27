import type { KeywordBidCommand } from './keyword-bid-adapter';

export const TARGET_PATH = '/ad_report/target/index/index';

export function command(): KeywordBidCommand {
  return {
    actionType: 'set_keyword_bid', missionGrantId: 'grant-1', storeId: 'store-one',
    browserProfileId: 'profile-store-one', sessionGeneration: 4, marketplace: 'US', currency: 'USD',
    adsAccountId: 'profile-100', campaignId: 'campaign-200', adGroupId: 'ad-group-300',
    keywordId: 'keyword-400', objectRevision: 7, expectedBeforeBidCents: 100, targetBidCents: 90,
    maxChangePct: 10,
    pageIdentityExpectation: { origin: 'https://ads.lingxing.com', pathname: TARGET_PATH, requiredTextMarkers: ['US', 'USD'] },
    evidencePaths: { before: 'C:\\trusted\\before.png', after: 'C:\\trusted\\after.png', reload: 'C:\\trusted\\reload.png' },
  };
}
