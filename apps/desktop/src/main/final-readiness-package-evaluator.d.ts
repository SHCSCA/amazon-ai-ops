export interface ReadinessGate {
  id: string;
  name: string;
  status: string;
  ok: boolean;
  evidencePath?: string | null;
  message?: string;
  safetyFailClosed?: boolean;
}

export interface PackageEvaluation {
  gates: ReadinessGate[];
  failures: Array<{ gateId: string; code: string; message: string; evidencePath: string | null }>;
  packageIndex: any;
  currentPortablePackage: any;
  packageLaunchSmoke: any;
}

export function collectPackageIndex(releaseDir?: string | null): any;

export function evaluatePackageReadinessFromFiles(input: {
  releaseDir?: string | null;
  packageLaunchSmokePath: string | null;
  selectedBy?: string;
}): PackageEvaluation;

export function evaluateReadinessContract(input: {
  businessGates: Array<Omit<ReadinessGate, 'id'> & { id?: string }>;
  packageEvaluation: PackageEvaluation;
  manifestDriven: boolean;
}): PackageEvaluation & { allGatesPass: boolean; appReady: boolean };
