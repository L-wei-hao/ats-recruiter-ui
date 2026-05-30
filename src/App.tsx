import { useCallback, useMemo, useRef, useState } from 'react';
import {
  defaultTotals,
  candidateSeed,
  activitySeed,
  defaultSearchFilter,
  initialUploadDraft,
  verificationSeed,
  workflowSeed
} from './lib/demoData';
import {
  humanize,
  isActiveResumeStatus,
  labelForResumeStatus,
  mergeDashboardTotals,
} from './lib/status';
import { useLiveStatusFeed } from './hooks/useLiveStatusFeed';
import type {
  ActivityItem,
  Candidate,
  SearchFilter,
  UploadDraft,
  VerificationItem,
  ViewKey,
  WorkflowItem
} from './types';
import type { DashboardEvent, DashboardTotals } from './lib/status';

type ActivityState = ActivityItem & { emphasis?: 'info' | 'success' | 'warning' };

const NAV: Array<{ key: ViewKey; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Ingestion Hub', hint: 'Upload & queues' },
  { key: 'search', label: 'Talent Engine', hint: 'Search & profiles' },
  { key: 'verification', label: 'Verification Hub', hint: 'Audit AI facts' },
  { key: 'workflows', label: 'Automated Pipelines', hint: 'n8n pipelines' }
];

const STATUS_OPTIONS = ['all', 'uploaded', 'queued', 'extracting_text', 'structuring', 'chunking', 'embedding', 'indexed', 'needs_review', 'failed'];
const FUNCTION_OPTIONS = ['all', 'AI / Automation', 'Backend', 'Platform', 'Data', 'Operations'];

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function statusTone(status: string): string {
  if (status === 'indexed' || status === 'approved' || status === 'complete') return 'tone-success';
  if (status === 'failed' || status === 'rejected') return 'tone-danger';
  if (status === 'needs_review' || status === 'reviewing' || status === 'pending') return 'tone-warning';
  if (status === 'queued' || isActiveResumeStatus(status) || status === 'running') return 'tone-info';
  return 'tone-neutral';
}

function eventLabel(event: DashboardEvent): string {
  if (event.kind === 'resume.status.updated') {
    return `Resume ${labelForResumeStatus(event.status).toLowerCase()}`;
  }
  if (event.kind === 'background_job.updated') {
    return `Queue ${humanize(event.status)} updated`;
  }
  return humanize(event.kind);
}

function eventDetail(event: DashboardEvent): string {
  if (event.kind === 'resume.status.updated') {
    return `A resume transitioned into ${labelForResumeStatus(event.status)}.`;
  }
  if (event.kind === 'background_job.updated') {
    return `Background job totals changed for ${humanize(event.status)}.`;
  }
  return `Received ${event.kind} over the live stream.`;
}

function formatScore(score: number): string {
  return `${score.toFixed(0)}%`;
}

function includesQuery(candidate: Candidate, query: string): boolean {
  if (!query) return true;
  const haystack = [
    candidate.name,
    candidate.currentTitle,
    candidate.currentCompany,
    candidate.location,
    candidate.country,
    candidate.functionArea,
    candidate.industry,
    candidate.pipelineStage,
    candidate.resumeStatus,
    ...candidate.verifiedSkills,
    ...candidate.highlights,
    ...candidate.facts.map((fact) => `${fact.label} ${fact.value} ${fact.evidence}`),
    ...candidate.resumes.map((resume) => `${resume.fileName} ${resume.notes}`)
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function filterCandidates(candidates: Candidate[], filter: SearchFilter): Candidate[] {
  return candidates
    .filter((candidate) => includesQuery(candidate, filter.query))
    .filter((candidate) => filter.status === 'all' || candidate.resumeStatus === filter.status)
    .filter((candidate) => filter.functionArea === 'all' || candidate.functionArea === filter.functionArea)
    .filter((candidate) => !filter.verifiedOnly || candidate.facts.some((fact) => fact.verified))
    .sort((left, right) => right.matchScore - left.matchScore);
}

function updateCandidateResume(candidate: Candidate, status: string, note: string): Candidate {
  const currentResume = candidate.resumes[0];
  const nextResume = {
    ...currentResume,
    status,
    processedAt: currentResume.processedAt ?? 'just now',
    notes: note
  };
  return {
    ...candidate,
    resumeStatus: status,
    resumes: [nextResume, ...candidate.resumes.slice(1)]
  };
}

function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [searchFilter, setSearchFilter] = useState<SearchFilter>(cloneState(defaultSearchFilter));
  const [candidates, setCandidates] = useState<Candidate[]>(cloneState(candidateSeed));
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>(cloneState(verificationSeed));
  const [workflows, setWorkflows] = useState<WorkflowItem[]>(cloneState(workflowSeed));
  const [activities, setActivities] = useState<ActivityState[]>(() => cloneState(activitySeed));
  const [totals, setTotals] = useState<DashboardTotals>(cloneState(defaultTotals));
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(cloneState(initialUploadDraft));
  const [selectedCandidateId, setSelectedCandidateId] = useState(candidateSeed[0].id);
  const [spotlightTab, setSpotlightTab] = useState<'highlights' | 'experience' | 'resumes'>('highlights');
  const [liveStatus, setLiveStatus] = useState('active');
  
  const resumeCursor = useRef(0);
  const activeWorkflowCursor = useRef(0);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0],
    [candidates, selectedCandidateId]
  );

  const filteredCandidates = useMemo(
    () => filterCandidates(candidates, searchFilter),
    [candidates, searchFilter]
  );

  const selectedVerification = useMemo(
    () => verificationItems.filter((item) => item.status === 'pending'),
    [verificationItems]
  );

  const addActivity = useCallback((activity: ActivityState) => {
    setActivities((current) => [activity, ...current].slice(0, 8));
  }, []);

  const handleEvent = useCallback(
    (event: DashboardEvent) => {
      setLiveStatus(`${event.kind} · ${labelForResumeStatus(event.status ?? 'unknown')}`);
      setTotals((current) => mergeDashboardTotals(current, event));
      addActivity({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        kind: event.kind,
        label: eventLabel(event),
        detail: eventDetail(event),
        emphasis: event.kind === 'resume.status.updated' && event.status === 'indexed' ? 'success' : 'info'
      });

      if (event.kind === 'resume.status.updated') {
        setCandidates((current) => {
          if (!current.length) return current;
          const next = current.map((candidate) => ({ ...candidate, resumes: candidate.resumes.map((resume) => ({ ...resume })) }));
          const index = resumeCursor.current % next.length;
          resumeCursor.current += 1;
          const target = next[index];
          const nextStatus = event.status === 'uploaded' ? 'queued' : event.status;
          next[index] = updateCandidateResume(target, nextStatus, labelForResumeStatus(nextStatus));
          if (nextStatus === 'needs_review') {
            setVerificationItems((items) =>
              items.map((item, itemIndex) =>
                itemIndex === 0
                  ? { ...item, status: 'pending', source: 'resume parser' }
                  : item
              )
            );
          }
          return next;
        });
      }

      if (event.kind === 'background_job.updated') {
        setWorkflows((current) => {
          const next = current.map((workflow) => ({ ...workflow }));
          const index = activeWorkflowCursor.current % next.length;
          activeWorkflowCursor.current += 1;
          const workflow = next[index];
          const progressDelta = Math.max(1, Math.min(15, Math.abs(event.delta ?? 1)));
          if (event.status === 'processing') {
            workflow.progress = Math.min(99, workflow.progress + progressDelta);
            workflow.status = workflow.progress >= 95 ? 'running' : workflow.status;
          }
          if (event.status === 'review') {
            workflow.progress = Math.min(100, workflow.progress + progressDelta);
            workflow.status = workflow.progress >= 100 ? 'complete' : 'reviewing';
          }
          workflow.lastRun = 'just now';
          workflow.details = eventDetail(event);
          return next;
        });
      }
    },
    [addActivity]
  );

  const feedMode = useLiveStatusFeed({ onEvent: handleEvent });

  const stats = useMemo(
    () => [
      { label: 'Uploaded', value: totals.uploaded, accent: 'tone-info' },
      { label: 'Processing', value: totals.processing, accent: 'tone-warning' },
      { label: 'Indexed', value: totals.indexed, accent: 'tone-success' },
      { label: 'Failed', value: totals.failed, accent: 'tone-danger' },
      { label: 'Review Required', value: totals.review, accent: 'tone-neutral' }
    ],
    [totals]
  );

  const onUploadSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!uploadDraft.candidateName.trim()) return;

      const id = `cand-${Date.now().toString(36)}`;
      const resumeId = `res-${Date.now().toString(36)}`;
      const candidate: Candidate = {
        id,
        name: uploadDraft.candidateName.trim(),
        currentTitle: uploadDraft.title.trim() || 'Candidate',
        currentCompany: uploadDraft.company.trim() || 'Unspecified',
        location: 'Singapore',
        country: 'Singapore',
        functionArea: 'AI / Automation',
        industry: 'General',
        verifiedSkills: [],
        matchScore: 78,
        pipelineStage: 'New',
        resumeStatus: 'uploaded',
        highlights: [
          `Uploaded file: ${uploadDraft.fileName}`,
          'Pending parsing, chunking, and verification.'
        ],
        resumes: [
          {
            id: resumeId,
            fileName: uploadDraft.fileName,
            status: 'uploaded',
            uploadedAt: 'just now',
            source: 'Manual upload',
            language: 'en',
            fileSizeKb: 342,
            notes: 'Queued for processing.'
          }
        ],
        facts: [],
        experiences: [
          {
            id: `exp-new-${Date.now()}`,
            company: uploadDraft.company.trim() || 'Unspecified',
            title: uploadDraft.title.trim() || 'Candidate',
            period: '2025 - Present',
            functionArea: 'AI / Automation',
            industry: 'General',
            summary: 'Awaiting async resume ingestion and deep structure extraction.'
          }
        ]
      };

      setCandidates((current) => [candidate, ...current]);
      setTotals((current) => ({
        ...current,
        uploaded: current.uploaded + 1,
        processing: current.processing + 1
      }));
      addActivity({
        id: `act-${Date.now()}`,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        kind: 'resume.uploaded',
        label: 'Resume uploaded',
        detail: `${uploadDraft.fileName} uploaded for ${uploadDraft.candidateName}.`,
        emphasis: 'success'
      });
      setSelectedCandidateId(id);
      setSpotlightTab('resumes');
      setView('search');
      setUploadDraft({ ...initialUploadDraft, fileName: 'resume.pdf' });
      setSearchFilter((current) => ({ ...current, query: uploadDraft.candidateName }));
    },
    [addActivity, uploadDraft]
  );

  const updateVerificationStatus = useCallback(
    (itemId: string, nextStatus: VerificationItem['status'], nextValue?: string) => {
      setVerificationItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            status: nextStatus,
            proposedValue: nextValue ?? item.proposedValue
          };
        })
      );

      const item = verificationItems.find((entry) => entry.id === itemId);
      if (!item) return;

      setCandidates((current) =>
        current.map((candidate) => {
          if (candidate.id !== item.candidateId) return candidate;
          const nextFacts = candidate.facts.some((fact) => fact.label === item.factLabel)
            ? candidate.facts.map((fact) =>
                fact.label === item.factLabel
                  ? {
                      ...fact,
                      value: nextValue ?? item.proposedValue,
                      verified: nextStatus !== 'rejected',
                      source: 'recruiter' as const
                    }
                  : fact
              )
            : [
                ...candidate.facts,
                {
                  id: `fact-${Date.now()}`,
                  label: item.factLabel,
                  value: nextValue ?? item.proposedValue,
                  source: 'recruiter' as const,
                  verified: nextStatus !== 'rejected',
                  evidence: item.evidence
                }
              ];
          return { ...candidate, facts: nextFacts };
        })
      );

      addActivity({
        id: `act-${Date.now()}-${nextStatus}`,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        kind: `verification.${nextStatus}`,
        label: `Verification ${nextStatus}`,
        detail: `${item?.factLabel ?? 'Fact'} ${nextStatus} for ${item?.candidateId ?? 'unknown candidate'}.`,
        emphasis: nextStatus === 'approved' ? 'success' : nextStatus === 'rejected' ? 'warning' : 'info'
      });
    },
    [addActivity, verificationItems]
  );

  const handleEditVerification = useCallback(
    (itemId: string) => {
      const current = verificationItems.find((item) => item.id === itemId);
      if (!current) return;
      const nextValue = window.prompt(`Edit ${current.factLabel}`, current.proposedValue);
      if (!nextValue || !nextValue.trim()) return;
      updateVerificationStatus(itemId, 'edited', nextValue.trim());
    },
    [updateVerificationStatus, verificationItems]
  );

  const getCandidateInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  const getCandidateName = (id: string) => {
    return candidates.find((c) => c.id === id)?.name ?? 'Unknown';
  };

  const getCandidateTitle = (id: string) => {
    const cand = candidates.find((c) => c.id === id);
    return cand ? `${cand.currentTitle} · ${cand.currentCompany}` : '';
  };

  return (
    <div className="app-shell">
      {/* 1. Left Sidebar Navigation */}
      <aside className="sidebar-nav">
        <div>
          <div className="brand-section">
            <div className="brand-logo">
              <svg fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: '22px', height: '22px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21L14.907 18M18 10.5c0 3.5-3.5 6-3.5 6s-3.5-2.5-3.5-6a3.5 3.5 0 1 1 7 0Z" />
              </svg>
            </div>
            <span className="brand-name">ATS Recruit Engine</span>
          </div>

          <nav className="nav-links" aria-label="Primary sidebar navigation">
            {NAV.map((item) => {
              // Custom SVG paths for premium icons
              let icon = (
                <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              );
              if (item.key === 'dashboard') {
                icon = (
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0-3-3m3 3 3-3m-8.25 6a9 9 0 1 1 16.5 0" />
                  </svg>
                );
              } else if (item.key === 'search') {
                icon = (
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                );
              } else if (item.key === 'verification') {
                icon = (
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                  </svg>
                );
              } else if (item.key === 'workflows') {
                icon = (
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                  </svg>
                );
              }
              return (
                <button
                  key={item.key}
                  className={`nav-tab ${view === item.key ? 'nav-tab--active' : ''}`}
                  onClick={() => setView(item.key)}
                >
                  {icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-profile">
          <div className="profile-avatar">WH</div>
          <div className="profile-info">
            <span className="profile-name">Loh Wei Hao</span>
            <span className="profile-role">Recruiter Admin</span>
          </div>
        </div>
      </aside>

      {/* 2. Main Workspace Layout */}
      <main className="workspace-hub">
        <header className="hub-header">
          <div>
            <div className="panel__eyebrow">ATS recruiter workspace</div>
            <h1>
              {view === 'dashboard' && 'Ingestion Hub'}
              {view === 'search' && 'Talent Engine'}
              {view === 'verification' && 'Verification Hub'}
              {view === 'workflows' && 'Automated Pipelines'}
            </h1>
            <p>
              {view === 'dashboard' && 'Upload candidate resumes, monitor live queues, and review background ingest logs.'}
              {view === 'search' && 'Search profiles with pgvector hybrid matches and deep-dive into candidate highlights & timelines.'}
              {view === 'verification' && 'Approve, reject, or edit AI-extracted unverified candidate facts.'}
              {view === 'workflows' && 'Observe active n8n background agents, integrations, and automated pipeline execution.'}
            </p>
          </div>
          <div className="hub-header__status">
            <div className="status-chip">
              <span className={`dot dot--${feedMode}`} />
              <span>{feedMode.toUpperCase()} STREAM</span>
            </div>
          </div>
        </header>

        {/* ==========================================================
            VIEW: Ingestion Hub (Dashboard + Upload Form)
            ========================================================== */}
        {view === 'dashboard' && (
          <div className="ingestion-hub-grid">
            <div className="ingestion-hub-left">
              {/* Form panel */}
              <section className="glass-panel panel">
                <div className="panel__eyebrow">Resume Intake</div>
                <h2>Ingest Resume Document</h2>
                <form className="upload-form" onSubmit={onUploadSubmit}>
                  <div className="form-group">
                    <label htmlFor="candidate-name">Candidate Full Name</label>
                    <input
                      id="candidate-name"
                      className="form-input"
                      required
                      value={uploadDraft.candidateName}
                      onChange={(event) => setUploadDraft((current) => ({ ...current, candidateName: event.target.value }))}
                      placeholder="e.g. Loh Wei Hao"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="candidate-title">Current Job Title</label>
                    <input
                      id="candidate-title"
                      className="form-input"
                      value={uploadDraft.title}
                      onChange={(event) => setUploadDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder="e.g. AI Integration Engineer"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="candidate-company">Current Employer</label>
                    <input
                      id="candidate-company"
                      className="form-input"
                      value={uploadDraft.company}
                      onChange={(event) => setUploadDraft((current) => ({ ...current, company: event.target.value }))}
                      placeholder="e.g. Fintech Platform"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="file-name">Document Filename</label>
                    <input
                      id="file-name"
                      className="form-input"
                      value={uploadDraft.fileName}
                      onChange={(event) => setUploadDraft((current) => ({ ...current, fileName: event.target.value }))}
                      placeholder="resume.pdf"
                    />
                  </div>
                  
                  <div className="upload-zone" onClick={() => document.getElementById('candidate-name')?.focus()}>
                    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                    </svg>
                    <p>Click details to configure</p>
                    <span>Ready for parsing & extraction</span>
                  </div>

                  <button className="btn-primary" type="submit">
                    <svg fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: '18px', height: '18px' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    <span>Upload & Start Ingest</span>
                  </button>
                </form>
              </section>
            </div>

            <div className="ingestion-hub-right">
              {/* Queue Snapshot stats */}
              <section className="glass-panel panel">
                <div className="panel__eyebrow">Queue Overview</div>
                <h2>Background Ingestion Metrics</h2>
                <div className="hero-stats">
                  {stats.map((stat) => (
                    <article key={stat.label} className="stat-card">
                      <span>{stat.label}</span>
                      <strong className={stat.accent}>{stat.value}</strong>
                    </article>
                  ))}
                </div>
              </section>

              {/* Live Activity panel */}
              <section className="glass-panel panel">
                <div className="hub-section-header">
                  <div>
                    <div className="panel__eyebrow">System stream</div>
                    <h3>Live Worker Feed</h3>
                  </div>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>SSE Auto-reconnect active</span>
                </div>
                <div className="live-activity-list">
                  {activities.map((activity) => {
                    let accentClass = 'rgba(99, 102, 241, 0.1)';
                    let strokeColor = 'var(--accent)';
                    let iconSvg = (
                      <svg fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: '16px', height: '16px' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    );
                    
                    if (activity.emphasis === 'success') {
                      accentClass = 'rgba(16, 185, 129, 0.1)';
                      strokeColor = 'var(--success)';
                      iconSvg = (
                        <svg fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: '16px', height: '16px' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3" />
                        </svg>
                      );
                    } else if (activity.emphasis === 'warning') {
                      accentClass = 'rgba(245, 158, 11, 0.1)';
                      strokeColor = 'var(--warning)';
                    }
                    
                    return (
                      <article key={activity.id} className="activity-card">
                        <div className="activity-icon-wrap" style={{ backgroundColor: accentClass, color: strokeColor }}>
                          {iconSvg}
                        </div>
                        <div className="activity-content">
                          <div className="activity-header">
                            <span className="activity-label">{activity.label}</span>
                            <span className="activity-time">{activity.at}</span>
                          </div>
                          <p className="activity-detail">{activity.detail}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* ==========================================================
            VIEW: Talent Engine (Split-Screen Workspace)
            ========================================================== */}
        {view === 'search' && (
          <div className="talent-engine-workspace">
            {/* Left Pane: Search Controls & Cards scroller */}
            <div className="search-results-panel">
              <div className="search-controls">
                <div className="search-input-wrap">
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.602 10.602Z" />
                  </svg>
                  <input
                    className="search-bar-input"
                    value={searchFilter.query}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Try: Loh Wei Hao Fintech n8n"
                  />
                </div>
                
                <div className="search-filters-row">
                  <select
                    className="select-input"
                    value={searchFilter.status}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, status: event.target.value }))}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'all' ? 'All Ingest Statuses' : labelForResumeStatus(option)}
                      </option>
                    ))}
                  </select>

                  <select
                    className="select-input"
                    value={searchFilter.functionArea}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, functionArea: event.target.value }))}
                  >
                    {FUNCTION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'all' ? 'All Functions' : option}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="checkbox-wrap">
                  <input
                    type="checkbox"
                    checked={searchFilter.verifiedOnly}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, verifiedOnly: event.target.checked }))}
                  />
                  <span>Show only verified evidence</span>
                </label>
              </div>

              <div className="candidates-cards-scroller">
                {filteredCandidates.length ? (
                  filteredCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      className={`candidate-card ${candidate.id === selectedCandidate?.id ? 'candidate-card--active' : ''}`}
                      onClick={() => setSelectedCandidateId(candidate.id)}
                    >
                      <div className="card-topbar">
                        <div className="card-title-wrap">
                          <span className="card-name">{candidate.name}</span>
                          <span className="card-subtitle">{candidate.currentTitle}</span>
                        </div>
                        <span className={`badge ${statusTone(candidate.resumeStatus)}`}>
                          {labelForResumeStatus(candidate.resumeStatus)}
                        </span>
                      </div>
                      
                      <p className="card-snippet">{candidate.highlights[0]}</p>

                      <div className="card-tag-row">
                        <span>{candidate.location} · {candidate.functionArea}</span>
                        <span className="score-tag">{formatScore(candidate.matchScore)} match</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">No candidates match current filters</div>
                )}
              </div>
            </div>

            {/* Right Pane: Spotlight Deep Dive */}
            <div className="glass-panel spotlight-profile-panel">
              {selectedCandidate ? (
                <div className="spotlight-profile-panel__content">
                  {/* Hero headers */}
                  <div className="profile-hero">
                    <div className="profile-main-meta">
                      <h2>{selectedCandidate.name}</h2>
                      <div className="profile-location-row">
                        <span>{selectedCandidate.currentTitle} · {selectedCandidate.currentCompany}</span>
                        <span>{selectedCandidate.location}</span>
                      </div>
                      <div style={{ marginTop: '6px' }}>
                        <span className="profile-stage-badge">{selectedCandidate.pipelineStage}</span>
                      </div>
                    </div>

                    {/* Radial neon percentage indicator */}
                    <div className="radial-score-meter">
                      <div className="circular-indicator">
                        <svg>
                          <defs>
                            <linearGradient id="score-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="var(--accent)" />
                              <stop offset="100%" stopColor="var(--cyan)" />
                            </linearGradient>
                          </defs>
                          <circle className="bg-circle" cx="22" cy="22" r="18" />
                          <circle 
                            className="fg-circle" 
                            cx="22" 
                            cy="22" 
                            r="18" 
                            strokeDasharray={113}
                            strokeDashoffset={113 - (113 * selectedCandidate.matchScore) / 100}
                          />
                        </svg>
                        <div style={{ position: 'absolute' }}>
                          <span className="score-text">{selectedCandidate.matchScore}%</span>
                        </div>
                      </div>
                      <div className="score-label">
                        <span>Match Rating</span>
                        <small>pgvector evidence</small>
                      </div>
                    </div>
                  </div>

                  {/* Profile subtabs */}
                  <div className="profile-subtabs">
                    <button 
                      className={`subtab-btn ${spotlightTab === 'highlights' ? 'subtab-btn--active' : ''}`}
                      onClick={() => setSpotlightTab('highlights')}
                    >
                      Highlights & Info
                    </button>
                    <button 
                      className={`subtab-btn ${spotlightTab === 'experience' ? 'subtab-btn--active' : ''}`}
                      onClick={() => setSpotlightTab('experience')}
                    >
                      Work History
                    </button>
                    <button 
                      className={`subtab-btn ${spotlightTab === 'resumes' ? 'subtab-btn--active' : ''}`}
                      onClick={() => setSpotlightTab('resumes')}
                    >
                      Resumes & Facts
                    </button>
                  </div>

                  {/* Dynamic subtab content container */}
                  <div className="profile-tab-scroller">
                    {/* SUBTAB: Highlights */}
                    {spotlightTab === 'highlights' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                          <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Highlights</h4>
                          <ul className="highlights-list">
                            {selectedCandidate.highlights.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                        
                        <div>
                          <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Verified Skills</h4>
                          <div className="skills-chips-row">
                            {selectedCandidate.verifiedSkills.length ? (
                              selectedCandidate.verifiedSkills.map((skill) => (
                                <span key={skill} className="skill-chip">{skill}</span>
                              ))
                            ) : (
                              <span className="muted" style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>No human-verified skills recorded yet.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SUBTAB: Work History timeline */}
                    {spotlightTab === 'experience' && (
                      <div className="timeline-wrapper">
                        {selectedCandidate.experiences.map((exp) => (
                          <div key={exp.id} className="timeline-item">
                            <div className="timeline-dot" />
                            <div className="timeline-header">
                              <span className="timeline-title">{exp.title}</span>
                              <span className="timeline-period">{exp.period}</span>
                            </div>
                            <div className="timeline-company">{exp.company}</div>
                            <div className="timeline-meta">{exp.functionArea} · {exp.industry}</div>
                            <p className="timeline-body">{exp.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* SUBTAB: Resumes & AI Facts */}
                    {spotlightTab === 'resumes' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                          <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Documents</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {selectedCandidate.resumes.map((res) => (
                              <div key={res.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '12px', background: 'rgba(0,0,0,0.15)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{res.fileName}</strong>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{res.source} · {res.fileSizeKb}KB</span>
                                </div>
                                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                  <span className={`badge ${statusTone(res.status)}`}>{labelForResumeStatus(res.status)}</span>
                                  <small style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>{res.uploadedAt}</small>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>Extracted Fact Audit</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {selectedCandidate.facts.length ? (
                              selectedCandidate.facts.map((fact) => (
                                <div key={fact.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', border: '1px solid var(--panel-border)', borderRadius: '12px', background: 'rgba(0,0,0,0.1)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong style={{ fontSize: '0.84rem' }}>{fact.label}</strong>
                                    <span className={`badge ${fact.verified ? 'tone-success' : 'tone-warning'}`}>
                                      {fact.verified ? 'Verified' : 'Unverified'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{fact.value}</div>
                                  <small style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: '1.3' }}>
                                    <strong>Source:</strong> {fact.source.toUpperCase()} <br />
                                    <strong>Evidence:</strong> "{fact.evidence}"
                                  </small>
                                </div>
                              ))
                            ) : (
                              <span className="muted" style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>No unverified or verified facts loaded.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="spotlight-fallback">
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
                  </svg>
                  <p>Select a candidate card from the list to audit profile evidence and milestones</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==========================================================
            VIEW: Verification Hub (Facts auditing deck)
            ========================================================== */}
        {view === 'verification' && (
          <div className="verification-hub-layout">
            <div className="verification-header-summary">
              <span className="badge tone-warning">{selectedVerification.length} PENDING AUDITS</span>
            </div>

            <div className="verification-list-container">
              {selectedVerification.length ? (
                selectedVerification.map((item) => (
                  <article key={item.id} className="verification-audit-card">
                    <div className="audit-card-top">
                      <div className="candidate-mini-profile">
                        <div className="candidate-avatar">
                          {getCandidateInitials(getCandidateName(item.candidateId))}
                        </div>
                        <div className="candidate-mini-info">
                          <span className="candidate-mini-name">{getCandidateName(item.candidateId)}</span>
                          <span className="candidate-mini-title">{getCandidateTitle(item.candidateId)}</span>
                        </div>
                      </div>
                      <span className="audit-tag-badge">{item.source}</span>
                    </div>

                    <div className="audit-card-content">
                      <div className="audit-fact-section">
                        <span className="audit-label">PROPOSED FACT / CHANGE</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 700 }}>{item.factLabel}</span>
                          <span className="audit-proposed-value">{item.proposedValue}</span>
                        </div>

                        <div style={{ marginTop: '12px' }}>
                          <span className="audit-label">PRODUCER CONFIDENCE</span>
                          <div className="audit-confidence-wrap">
                            <div className="confidence-bar-outer">
                              <div 
                                className="confidence-bar-inner" 
                                style={{ width: `${item.confidence * 100}%` }}
                              />
                            </div>
                            <span className="confidence-text">{Math.round(item.confidence * 100)}%</span>
                          </div>
                        </div>
                      </div>

                      <div className="audit-evidence-citation">
                        <span>Parser Evidence Citation</span>
                        <p>"{item.evidence}"</p>
                      </div>
                    </div>

                    <div className="audit-card-actions">
                      <button 
                        className="btn-audit btn-audit--approve" 
                        type="button" 
                        onClick={() => updateVerificationStatus(item.id, 'approved')}
                      >
                        Approve Change
                      </button>
                      <button 
                        className="btn-audit" 
                        type="button" 
                        onClick={() => handleEditVerification(item.id)}
                      >
                        Edit Fact
                      </button>
                      <button 
                        className="btn-audit btn-audit--reject" 
                        type="button" 
                        onClick={() => updateVerificationStatus(item.id, 'rejected')}
                      >
                        Reject Proposed
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state" style={{ padding: '60px' }}>
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: '40px', height: '40px', color: 'var(--success)', marginBottom: '8px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3" />
                  </svg>
                  <h3>All Caught Up!</h3>
                  <p>All AI-extracted profile facts have been audited by a recruiter.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==========================================================
            VIEW: Automated Pipelines (workflows)
            ========================================================== */}
        {view === 'workflows' && (
          <div className="workflows-hub-grid">
            {workflows.map((wf) => (
              <article key={wf.id} className="workflow-card">
                <div className="workflow-card-top">
                  <div className="workflow-name-wrap">
                    <span className="workflow-title">{wf.name}</span>
                    <span className="workflow-owner">Orchestrator: {wf.owner}</span>
                  </div>
                  <span className={`badge ${statusTone(wf.status)}`}>
                    {wf.status === 'running' ? 'Active' : humanize(wf.status)}
                  </span>
                </div>

                <div className="workflow-progress-section">
                  <div className="workflow-progress-labels">
                    <span>Task Progress</span>
                    <span>{wf.progress}%</span>
                  </div>
                  <div className="progress-bar-outer">
                    <div className="progress-bar-inner" style={{ width: `${wf.progress}%` }} />
                  </div>
                </div>

                <p className="workflow-details-p">{wf.details}</p>

                <div className="workflow-footer">
                  <span>n8n execution</span>
                  <span>Last run: {wf.lastRun}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
