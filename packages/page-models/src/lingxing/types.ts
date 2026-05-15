import type { PageModel, PageStateCheck } from '@amazon-ai-ops/shared-types';

export interface LingxingPageStateCheck extends PageStateCheck {
  loggedIn: {
    urlPatterns: string[];
    requiredTexts: string[];
    forbiddenTexts: string[];
  };
  loggedOut: {
    urlPatterns: string[];
    requiredTexts: string[];
  };
  sessionExpired?: {
    urlPatterns: string[];
    requiredTexts: string[];
  };
}
