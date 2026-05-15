import type { WaitCondition } from '@amazon-ai-ops/shared-types';

export const WAIT = {
  NETWORK_IDLE: (timeout = 30000): WaitCondition => ({
    type: 'networkidle',
    timeout,
  }),
  
  DOM_CONTENT_LOADED: (timeout = 15000): WaitCondition => ({
    type: 'domcontentloaded',
    timeout,
  }),
  
  SELECTOR: (selector: string, timeout = 10000): WaitCondition => ({
    type: 'selector',
    value: selector,
    timeout,
  }),
  
  TEXT: (text: string, timeout = 10000): WaitCondition => ({
    type: 'text',
    value: text,
    timeout,
  }),
  
  URL: (pattern: string, timeout = 15000): WaitCondition => ({
    type: 'url',
    value: pattern,
    timeout,
  }),
};

export const waitForText = (page: any, text: string, timeout = 10000) => {
  return page.waitForFunction(
    (t: string) => document.body.innerText.includes(t),
    text,
    { timeout }
  );
};

export const waitForUrlChange = (page: any, timeout = 15000) => {
  const currentUrl = page.url();
  return page.waitForFunction(
    (url: string) => document.URL !== url,
    currentUrl,
    { timeout }
  );
};
