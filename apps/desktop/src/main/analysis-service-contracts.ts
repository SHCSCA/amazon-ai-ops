import type Database from 'better-sqlite3';
import {
  AnalysisAuthorityRepository,
  AnalysisAuthorityRepositoryError,
  MissionDomainRepository,
  RecommendationRepository,
  type AnalysisCausalMemoryItem,
} from '@amazon-ai-ops/local-db';
import {
  type ActionRecommendation,
  type AnalysisAuthorizationBlocker,
  type AnalysisAuthorizationBlockerCode,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionGrantRecord,
  type MissionAnalysisRunProjection,
  type MissionAnalysisProjection,
  type PolicyVersionRules,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

export interface RecommendationGenerationResultForAnalysis {
  generated: number;
  metrics: number;
  skippedDuplicates: number;
  refreshedDuplicates: number;
  recommendationCandidates: number;
  recommendationIds: number[];
  aiExplanation: {
    configured: boolean;
    invoked: boolean;
    reason: string;
    model?: string;
    strategyDiagnosis?: { source?: 'ai' | 'rule' };
  };
  scope: {
    storeId: string;
    storeName: string;
    marketplaceCode: string;
    dateFrom: string;
    dateTo: string;
    asin?: string;
    batchId?: string;
  };
}

export interface AnalysisRecommendationGenerationScope {
  missionId?: string;
  storeContext: StoreContextEnvelope;
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: 'US';
  asin?: string;
  batchId: string;
  /** 仅供 Main 使用的同产品、有独立证明的历史结果。 */
  causalMemory: readonly AnalysisCausalMemoryItem[];
  /** 规范化业务内容与证明共同决定稳定摘要。 */
  memoryDigest: string;
  /** 分析运行失效后取消 Main 与供应商工作。 */
  signal: AbortSignal;
}

export interface CapturedAnalysisGenerationAuthority {
  readonly ruleRevision: string;
  readonly modelRevision: string;
  readonly generateRecommendations: (
    scope: AnalysisRecommendationGenerationScope,
  ) => Promise<RecommendationGenerationResultForAnalysis>;
}

export interface AnalysisAuthorityServiceOptions {
  db: Database.Database;
  repository: AnalysisAuthorityRepository;
  missionRepository: MissionDomainRepository;
  recommendationRepository: RecommendationRepository;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>;
  generateRecommendations: CapturedAnalysisGenerationAuthority['generateRecommendations'];
  /** 生产入口捕获不可变生成权限；兼容生成器仍受当前版本核验。 */
  captureGenerationAuthority?: () => CapturedAnalysisGenerationAuthority;
  currentRuleRevision: () => string;
  currentModelRevision: () => string;
  allowedProofRoots: (context: StoreContextEnvelope) => readonly string[];
  onAutomaticGrantIssued?: (
    context: StoreContextEnvelope,
    grant: MissionGrantRecord,
  ) => void;
  onAnalysisRunCompleted?: (run: MissionAnalysisRunProjection) => void;
  /** Main 对单次建议生成设置的截止时限。 */
  generationTimeoutMs?: number | undefined;
  now?: () => Date;
}
