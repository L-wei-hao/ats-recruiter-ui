import type {
  ActivityItem,
  Candidate,
  CandidateFact,
  SearchFilter,
  UploadDraft,
  VerificationItem,
  WorkflowItem
} from '../types';

export const defaultSearchFilter: SearchFilter = {
  query: '',
  status: 'all',
  functionArea: 'all',
  verifiedOnly: false
};

export const initialUploadDraft: UploadDraft = {
  candidateName: '',
  title: '',
  company: '',
  fileName: 'resume.pdf'
};

export const defaultTotals = {
  uploaded: 6,
  processing: 4,
  indexed: 18,
  failed: 1,
  review: 3
};

export const workflowSeed: WorkflowItem[] = [
  {
    id: 'wf-001',
    name: 'New resume ingestion',
    status: 'running',
    owner: 'Document worker',
    lastRun: '2 min ago',
    details: 'Parsing, chunking, and embedding are in progress for 2 resumes.',
    progress: 72
  },
  {
    id: 'wf-002',
    name: 'Human verification queue',
    status: 'reviewing',
    owner: 'Recruiter panel',
    lastRun: '8 min ago',
    details: '3 facts need review before they can be promoted into canonical profile data.',
    progress: 48
  },
  {
    id: 'wf-003',
    name: 'Search index refresh',
    status: 'complete',
    owner: 'Search service',
    lastRun: '14 min ago',
    details: 'New pgvector and full-text records are available to the recruiter search UI.',
    progress: 100
  }
];

export const verificationSeed: VerificationItem[] = [
  {
    id: 'ver-001',
    candidateId: 'cand-001',
    factLabel: 'Current title',
    proposedValue: 'AI Integration Engineer',
    evidence: 'Resume header + work history mentions AI automation delivery in fintech.',
    confidence: 0.94,
    source: 'resume parser',
    status: 'pending'
  },
  {
    id: 'ver-002',
    candidateId: 'cand-002',
    factLabel: 'Work authorization',
    proposedValue: 'Singapore PR',
    evidence: 'Candidate profile note from recruiter screening call.',
    confidence: 0.82,
    source: 'recruiter note',
    status: 'pending'
  },
  {
    id: 'ver-003',
    candidateId: 'cand-003',
    factLabel: 'Skill evidence',
    proposedValue: 'pgvector',
    evidence: 'Project section references semantic search and vector indexing.',
    confidence: 0.88,
    source: 'resume parser',
    status: 'pending'
  }
];

function facts(...items: CandidateFact[]): CandidateFact[] {
  return items;
}

export const candidateSeed: Candidate[] = [
  {
    id: 'cand-001',
    name: 'Loh Wei Hao',
    currentTitle: 'AI Integration Engineer',
    currentCompany: 'Fintech Platform',
    location: 'Singapore',
    country: 'Singapore',
    functionArea: 'AI / Automation',
    industry: 'Fintech',
    verifiedSkills: ['n8n', 'RAG', 'Java Spring Boot', 'Python'],
    matchScore: 96,
    pipelineStage: 'Shortlisted',
    resumeStatus: 'indexed',
    highlights: [
      'MAS-regulated fintech and AML experience',
      'Built AI workflow automation with n8n',
      'Strong backend delivery in Java and Python'
    ],
    resumes: [
      {
        id: 'res-001',
        fileName: 'loh_wei_hao_resume_2026.pdf',
        status: 'indexed',
        uploadedAt: 'Today 09:21',
        processedAt: 'Today 09:24',
        source: 'Self-upload',
        language: 'en',
        fileSizeKb: 428,
        notes: 'Indexed and available for search.'
      },
      {
        id: 'res-002',
        fileName: 'loh_wei_hao_portfolio.pdf',
        status: 'needs_review',
        uploadedAt: 'Yesterday 17:52',
        processedAt: 'Yesterday 17:58',
        source: 'Recruiter upload',
        language: 'en',
        fileSizeKb: 612,
        notes: 'Needs manual verification of AI-extracted skills.'
      }
    ],
    facts: facts(
      {
        id: 'fact-001',
        label: 'Current title',
        value: 'AI Integration Engineer',
        source: 'resume',
        verified: true,
        evidence: 'Profile header and current role in resume.'
      },
      {
        id: 'fact-002',
        label: 'Primary industry',
        value: 'Fintech',
        source: 'recruiter',
        verified: true,
        evidence: 'Verified in screening notes and company context.'
      },
      {
        id: 'fact-003',
        label: 'AI automation',
        value: 'n8n workflow orchestration',
        source: 'ai',
        verified: false,
        evidence: 'AI extraction from project and skills sections.'
      }
    ),
    experiences: [
      {
        id: 'exp-001',
        company: 'Fintech Platform',
        title: 'AI Integration Engineer',
        period: '2024 - Present',
        functionArea: 'AI / Automation',
        industry: 'Fintech',
        summary: 'Built internal assistants, workflow automations, and RAG-based search tooling.'
      },
      {
        id: 'exp-002',
        company: 'Banking Operations Team',
        title: 'Software Engineer',
        period: '2021 - 2024',
        functionArea: 'Backend',
        industry: 'Banking',
        summary: 'Delivered Spring Boot services and compliance automation for regulated operations.'
      }
    ]
  },
  {
    id: 'cand-002',
    name: 'Sarah Tan',
    currentTitle: 'Solutions Architect',
    currentCompany: 'SaaS Scaleup',
    location: 'Singapore',
    country: 'Singapore',
    functionArea: 'Platform',
    industry: 'Enterprise SaaS',
    verifiedSkills: ['AWS', 'Kubernetes', 'TypeScript'],
    matchScore: 81,
    pipelineStage: 'Screening',
    resumeStatus: 'extracting_text',
    highlights: [
      'Strong cloud architecture background',
      'Recent work on AI copilots for support teams',
      'Needs verification on current employment status'
    ],
    resumes: [
      {
        id: 'res-003',
        fileName: 'sarah_tan_resume.pdf',
        status: 'extracting_text',
        uploadedAt: 'Today 08:14',
        source: 'Recruiter upload',
        language: 'en',
        fileSizeKb: 301,
        notes: 'Awaiting parsing completion.'
      }
    ],
    facts: facts(
      {
        id: 'fact-004',
        label: 'Current title',
        value: 'Solutions Architect',
        source: 'resume',
        verified: true,
        evidence: 'Extracted from current role section.'
      },
      {
        id: 'fact-005',
        label: 'AI capability',
        value: 'copilot orchestration',
        source: 'ai',
        verified: false,
        evidence: 'Project description references AI support tooling.'
      }
    ),
    experiences: [
      {
        id: 'exp-003',
        company: 'SaaS Scaleup',
        title: 'Solutions Architect',
        period: '2022 - Present',
        functionArea: 'Platform',
        industry: 'Enterprise SaaS',
        summary: 'Owns customer-facing architecture, integrations, and technical discovery.'
      }
    ]
  },
  {
    id: 'cand-003',
    name: 'Daniel Koh',
    currentTitle: 'Senior Backend Engineer',
    currentCompany: 'Health Tech Co',
    location: 'Singapore',
    country: 'Singapore',
    functionArea: 'Backend',
    industry: 'Healthcare',
    verifiedSkills: ['Python', 'FastAPI', 'pgvector', 'PostgreSQL'],
    matchScore: 77,
    pipelineStage: 'New',
    resumeStatus: 'needs_review',
    highlights: [
      'Good fit for search and document processing',
      'Resume parsing detected several unverified skill claims',
      'Requires human review before moving forward'
    ],
    resumes: [
      {
        id: 'res-004',
        fileName: 'daniel_koh_resume.pdf',
        status: 'needs_review',
        uploadedAt: 'Yesterday 20:46',
        processedAt: 'Today 07:03',
        source: 'Candidate portal',
        language: 'en',
        fileSizeKb: 246,
        notes: 'Multiple facts require reviewer confirmation.'
      }
    ],
    facts: facts(
      {
        id: 'fact-006',
        label: 'Current title',
        value: 'Senior Backend Engineer',
        source: 'resume',
        verified: true,
        evidence: 'Declared in the experience summary.'
      },
      {
        id: 'fact-007',
        label: 'Semantic search',
        value: 'pgvector',
        source: 'ai',
        verified: false,
        evidence: 'Detected in project write-up but not yet verified.'
      }
    ),
    experiences: [
      {
        id: 'exp-004',
        company: 'Health Tech Co',
        title: 'Senior Backend Engineer',
        period: '2023 - Present',
        functionArea: 'Backend',
        industry: 'Healthcare',
        summary: 'Builds API services and data pipelines for care operations.'
      }
    ]
  }
];

export const activitySeed: ActivityItem[] = [
  {
    id: 'act-001',
    at: '11:02',
    kind: 'resume.status.updated',
    label: 'Resume indexed',
    detail: 'loh_wei_hao_resume_2026.pdf moved from embedding to indexed.'
  },
  {
    id: 'act-002',
    at: '10:49',
    kind: 'background_job.updated',
    label: 'Verification queue updated',
    detail: '3 facts now require human verification.'
  },
  {
    id: 'act-003',
    at: '10:31',
    kind: 'workflow.completed',
    label: 'Search refresh complete',
    detail: 'The latest pgvector records are now searchable.'
  }
];
