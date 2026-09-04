/**
 * Mission Domain Model Tests
 *
 * Tests MissionRecord, stage transitions, and labels.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidStageTransition,
  STAGE_LABELS,
  STATUS_LABELS,
  VALID_STAGE_TRANSITIONS,
  type MissionStage,
  type MissionStatus,
} from './mission-domain';

describe('MissionDomain', () => {
  describe('isValidStageTransition', () => {
    it('allows forward transitions', () => {
      expect(isValidStageTransition('fact', 'analysis')).toBe(true);
      expect(isValidStageTransition('analysis', 'decision')).toBe(true);
      expect(isValidStageTransition('decision', 'action')).toBe(true);
      expect(isValidStageTransition('action', 'readback')).toBe(true);
      expect(isValidStageTransition('readback', 'effect')).toBe(true);
    });

    it('disallows backward transitions', () => {
      expect(isValidStageTransition('analysis', 'fact')).toBe(false);
      expect(isValidStageTransition('decision', 'analysis')).toBe(false);
    });

    it('disallows skipping stages', () => {
      expect(isValidStageTransition('fact', 'decision')).toBe(false);
      expect(isValidStageTransition('analysis', 'action')).toBe(false);
    });

    it('disallows transitions from terminal effect', () => {
      expect(isValidStageTransition('effect', 'analysis')).toBe(false);
    });

    it('allows transitions to blocked from non-terminal stages', () => {
      expect(isValidStageTransition('analysis', 'blocked')).toBe(true);
      expect(isValidStageTransition('decision', 'blocked')).toBe(true);
      expect(isValidStageTransition('action', 'blocked')).toBe(true);
      expect(isValidStageTransition('readback', 'blocked')).toBe(true);
    });
  });

  describe('STAGE_LABELS', () => {
    it('provides Chinese label for each stage', () => {
      expect(STAGE_LABELS.fact).toBe('数据准备');
      expect(STAGE_LABELS.analysis).toBe('分析中');
      expect(STAGE_LABELS.decision).toBe('决策中');
      expect(STAGE_LABELS.action).toBe('执行中');
      expect(STAGE_LABELS.readback).toBe('回读验证');
      expect(STAGE_LABELS.effect).toBe('效果观察');
    });

    it('has label for all valid stages', () => {
      const stages: MissionStage[] = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'];
      for (const stage of stages) {
        expect(STAGE_LABELS[stage]).toBeTruthy();
      }
    });
  });

  describe('STATUS_LABELS', () => {
    it('provides Chinese label for each status', () => {
      expect(STATUS_LABELS.draft).toBe('草稿');
      expect(STATUS_LABELS.active).toBe('进行中');
      expect(STATUS_LABELS.paused).toBe('已暂停');
      expect(STATUS_LABELS.blocked).toBe('已阻断');
      expect(STATUS_LABELS.completed).toBe('已完成');
      expect(STATUS_LABELS.archived).toBe('已归档');
    });

    it('has label for all valid statuses', () => {
      const statuses: MissionStatus[] = ['draft', 'active', 'paused', 'blocked', 'completed', 'archived'];
      for (const status of statuses) {
        expect(STATUS_LABELS[status]).toBeTruthy();
      }
    });
  });

  describe('VALID_STAGE_TRANSITIONS', () => {
    it('has valid transitions for non-terminal stages', () => {
      expect(VALID_STAGE_TRANSITIONS.fact).toContain('analysis');
      expect(VALID_STAGE_TRANSITIONS.analysis.length).toBeGreaterThan(0);
      expect(VALID_STAGE_TRANSITIONS.decision.length).toBeGreaterThan(0);
      expect(VALID_STAGE_TRANSITIONS.action.length).toBeGreaterThan(0);
      expect(VALID_STAGE_TRANSITIONS.readback.length).toBeGreaterThan(0);
    });

    it('effect is terminal with no outgoing transitions', () => {
      expect(VALID_STAGE_TRANSITIONS.effect).toEqual([]);
    });
  });
});
