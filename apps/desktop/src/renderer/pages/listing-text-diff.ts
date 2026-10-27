import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type ListingTextDiff, type ListingTextDiffSegment } from './listing-contracts';

export function tokenizeListingText(value: string): string[] {
  return value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?|[\u4e00-\u9fff]|[^\s]/g) || [];
}

export function normalizeDiffToken(value: string): string {
  return value.toLocaleLowerCase();
}

export function buildListingTextDiffSegments(currentText: string, draftText: string): ListingTextDiff {
  const currentTokens = tokenizeListingText(currentText);
  const draftTokens = tokenizeListingText(draftText);
  const dp = Array.from({ length: currentTokens.length + 1 }, () => Array(draftTokens.length + 1).fill(0));

  for (let i = currentTokens.length - 1; i >= 0; i--) {
    for (let j = draftTokens.length - 1; j >= 0; j--) {
      if (normalizeDiffToken(currentTokens[i]) === normalizeDiffToken(draftTokens[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const currentSegments: ListingTextDiffSegment[] = [];
  const draftSegments: ListingTextDiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < currentTokens.length && j < draftTokens.length) {
    if (normalizeDiffToken(currentTokens[i]) === normalizeDiffToken(draftTokens[j])) {
      currentSegments.push({ text: currentTokens[i], kind: 'same' });
      draftSegments.push({ text: draftTokens[j], kind: 'same' });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      currentSegments.push({ text: currentTokens[i], kind: 'removed' });
      i += 1;
    } else {
      draftSegments.push({ text: draftTokens[j], kind: 'added' });
      j += 1;
    }
  }

  while (i < currentTokens.length) {
    currentSegments.push({ text: currentTokens[i], kind: 'removed' });
    i += 1;
  }
  while (j < draftTokens.length) {
    draftSegments.push({ text: draftTokens[j], kind: 'added' });
    j += 1;
  }

  return { currentSegments, draftSegments };
}
