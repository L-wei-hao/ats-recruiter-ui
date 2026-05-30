export type ViewKey = 'dashboard' | 'search' | 'candidate' | 'upload' | 'verification' | 'workflows';

export type CandidateFact = {
  id: string;
  label: string;
  value: string;
  source: 'resume' | 'recruiter' | 'candidate' | 'ai';
  verified: boolean;
  evidence: string;
};

export type ResumeRecord = {
  id: string;
  fileName: string;
  status: string;
  uploadedAt: string;
  processedAt?: string;
  source: string;
  language: string;
  fileSizeKb: number;
  notes: string;
};

export type CandidateExperience = {
  id: string;
  company: string;
  title: string;
  period: string;
  functionArea: string;
  industry: string;
  summary: string;
};

export type Candidate = {
  id: string;
  name: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  country: string;
  functionArea: string;
  industry: string;
  verifiedSkills: string[];
  matchScore: number;
  pipelineStage: string;
  resumeStatus: string;
  highlights: string[];
  resumes: ResumeRecord[];
  facts: CandidateFact[];
  experiences: CandidateExperience[];
};

export type VerificationItem = {
  id: string;
  candidateId: string;
  factLabel: string;
  proposedValue: string;
  evidence: string;
  confidence: number;
  source: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
};

export type WorkflowItem = {
  id: string;
  name: string;
  status: 'draft' | 'reviewing' | 'queued' | 'running' | 'complete' | 'failed';
  owner: string;
  lastRun: string;
  details: string;
  progress: number;
};

export type SearchFilter = {
  query: string;
  status: string;
  functionArea: string;
  verifiedOnly: boolean;
};

export type ActivityItem = {
  id: string;
  at: string;
  kind: string;
  label: string;
  detail: string;
};

export type UploadDraft = {
  candidateName: string;
  title: string;
  company: string;
  fileName: string;
};
