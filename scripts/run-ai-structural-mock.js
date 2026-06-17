const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const fakeApiKey = 'mock-structural-key-do-not-write';

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function includesAll(text, snippets) {
  return snippets.map((snippet) => ({
    snippet,
    present: text.includes(snippet),
  }));
}

function assertNoSecretLeak(serialized) {
  const patterns = [
    fakeApiKey,
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
  ];
  const matched = patterns.find((pattern) => (
    typeof pattern === 'string' ? serialized.includes(pattern) : pattern.test(serialized)
  ));
  if (matched) {
    throw new Error(`Refusing to write structural AI evidence with possible secret leak: ${matched}`);
  }
}

function buildMockOpenAiCompatibleExchange() {
  const request = {
    method: 'POST',
    url: 'mock://openai-compatible/chat/completions',
    headers: {
      authorization: `Bearer ${fakeApiKey}`,
      'content-type': 'application/json',
    },
    body: {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Return strict JSON for a Listing rewrite.' },
        {
          role: 'user',
          content: [
            'ASIN: B0STRUCTURAL',
            'Section: bullet',
            'Current text: Stainless steel bottle.',
            'Keyword: insulated travel mug',
            'Return JSON with suggestedText, reason, and riskWarnings.',
          ].join('\n'),
        },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    },
  };

  const response = {
    ok: true,
    status: 200,
    body: {
      choices: [{
        message: {
          content: JSON.stringify({
            suggestedText: 'Insulated travel mug keeps drinks hot or cold for daily commutes.',
            reason: 'Uses the accepted keyword while preserving a factual product claim.',
            riskWarnings: ['Verify insulation duration before publishing.'],
          }),
        },
      }],
      usage: {
        prompt_tokens: 51,
        completion_tokens: 33,
        total_tokens: 84,
      },
    },
  };

  const parsedContent = JSON.parse(response.body.choices[0].message.content);
  return {
    request: {
      ...request,
      headers: {
        authorization: 'Bearer [redacted-mock-key]',
        'content-type': request.headers['content-type'],
      },
    },
    response,
    parsedContent,
  };
}

function main() {
  const openaiCompatibleSource = readSource('packages/ai-adapter/src/openai-compatible.ts');
  const desktopMainSource = readSource('apps/desktop/src/main/index.ts');
  const exchange = buildMockOpenAiCompatibleExchange();

  const evidence = {
    kind: 'ai-openai-compatible-structural-mock',
    generatedAt: new Date().toISOString(),
    status: 'STRUCTURAL_ONLY',
    readinessImpact: 'NO_FINAL_READINESS_CREDIT',
    finalReadinessCredit: false,
    mockOnly: true,
    externalNetworkRequestMade: false,
    keyPresent: false,
    provider: {
      type: 'openai-compatible',
      baseUrl: 'mock://openai-compatible',
      model: exchange.request.body.model,
      endpointPath: '/chat/completions',
    },
    safety: {
      adWriteActionsPerformed: false,
      full8Started: false,
      reportCollectionStarted: false,
      appSettingsMutated: false,
      apiKeyReadFromEnvironment: false,
    },
    sourceChecks: {
      openAiCompatibleProvider: includesAll(openaiCompatibleSource, [
        "this.buildUrl('/chat/completions')",
        'this.buildHeaders()',
        'max_tokens',
        'response_format',
        "responseFormat !== 'json_object'",
        'choices?.[0]?.message?.content',
      ]),
      listingAiDraftFlow: includesAll(desktopMainSource, [
        'new OpenAICompatibleProvider(buildAiProviderConfig(settings))',
        'AI 理由：',
        "source: 'ai'",
        'aiFallbackReason: undefined',
      ]),
    },
    requestShape: {
      method: exchange.request.method,
      url: exchange.request.url,
      headers: exchange.request.headers,
      body: exchange.request.body,
      hasMessagesArray: Array.isArray(exchange.request.body.messages),
      usesOpenAiCompatibleTokenField: Object.prototype.hasOwnProperty.call(exchange.request.body, 'max_tokens'),
    },
    responseShape: {
      ok: exchange.response.ok,
      status: exchange.response.status,
      hasChoicesMessageContent: Boolean(exchange.response.body.choices?.[0]?.message?.content),
      usage: exchange.response.body.usage,
      parsedListingDraft: {
        suggestedTextLength: exchange.parsedContent.suggestedText.length,
        reasonLength: exchange.parsedContent.reason.length,
        riskWarningsCount: exchange.parsedContent.riskWarnings.length,
        evidenceWouldContainAiReason: true,
        sourceWouldBeAi: true,
        fallbackWouldBeCleared: true,
      },
    },
    limitations: [
      'This evidence does not call DeepSeek or any real OpenAI-compatible provider.',
      'This evidence does not prove credentials, quota, network reachability, latency, or model quality.',
      'Final readiness must continue to require deepseek-live-* and installed-listing-ai-draft-* real-key evidence.',
    ],
  };

  const serialized = JSON.stringify(evidence, null, 2);
  assertNoSecretLeak(serialized);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `structural-ai-openai-compatible-mock-${Date.now()}.json`);
  fs.writeFileSync(evidencePath, `${serialized}\n`, 'utf8');
  console.log(`STRUCTURAL_ONLY: OpenAI-compatible AI mock evidence written: ${evidencePath}`);
  console.log('Notice: NO_FINAL_READINESS_CREDIT');
}

main();
