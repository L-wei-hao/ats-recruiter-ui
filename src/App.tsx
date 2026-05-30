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
  progressResumeStatus
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
  { key: 'dashboard', label: 'Dashboard', hint: 'Queue + live status' },
  { key: 'search', label: 'Search', hint: 'Find candidates fast' },
  { key: 'candidate', label: 'Profile', hint: 'Resume + evidence' },
  { key: 'upload', label: 'Upload', hint: 'Start ingestion' },
  { key: 'verification', label: 'Verification', hint: 'Approve facts' },
  { key: 'workflows', label: 'Workflows', hint: 'Pipeline views' }
];

const STATUS_OPTIONS = ['all', 'uploaded', 'queued', 'extracting_text', 'structuring', 'chunking', 'embedding', 'indexed', 'needs_review', 'failed'];
const FUNCTION_OPTIONS = ['all', 'AI / Automation', 'Backend', 'Platform', 'Data', 'Operations'];

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function statusTone(status: string): string {
  if (status === 'indexed' || status === 'approved') return 'tone-success';
  if (status === 'failed' || status === 'rejected') return 'tone-danger';
  if (status === 'needs_review' || status === 'reviewing' || status === 'pending') return 'tone-warning';
  if (status === 'queued' || isActiveResumeStatus(status)) return 'tone-info';
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
  const [liveStatus, setLiveStatus] = useState('starting');
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
    () => verificationItems.filter((item) => item.status === 'pending').slice(0, 3),
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
          const progressDelta = Math.max(1, Math.min(15, Math.abs(event.delta)));
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
      { label: 'Needs review', value: totals.review, accent: 'tone-neutral' }
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
        matchScore: 64,
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
        experiences: []
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
      setView('candidate');
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
                      source: 'recruiter'
                    }
                  : fact
              )
            : [
                ...candidate.facts,
                {
                  id: `fact-${Date.now()}`,
                  label: item.factLabel,
                  value: nextValue ?? item.proposedValue,
                  source: 'recruiter',
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

  const candidateCards = useMemo(
    () =>
      filteredCandidates.map((candidate) => (
        <button
          key={candidate.id}
          className={`candidate-card ${candidate.id === selectedCandidate?.id ? 'candidate-card--active' : ''}`}
          onClick={() => {
            setSelectedCandidateId(candidate.id);
            setView('candidate');
          }}
        >
          <div className="candidate-card__top">
            <div>
              <div className="candidate-card__name">{candidate.name}</div>
              <div className="candidate-card__subtitle">
                {candidate.currentTitle} · {candidate.currentCompany}
              </div>
            </div>
            <span className={`badge ${statusTone(candidate.resumeStatus)}`}>{labelForResumeStatus(candidate.resumeStatus)}</span>
          </div>
          <div className="candidate-card__meta">
            <span>{candidate.location}</span>
            <span>{candidate.functionArea}</span>
            <span>{formatScore(candidate.matchScore)}</span>
          </div>
          <p className="candidate-card__summary">{candidate.highlights[0]}</p>
        </button>
      )),
    [filteredCandidates, selectedCandidate?.id]
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ATS Recruiter UI</div>
          <h1>Dashboard, search, verification, and live status updates</h1>
          <p className="lede">
            Demo recruiter workspace with asynchronous queue visibility, candidate search, human verification,
            and SSE/polling-style live updates.
          </p>
        </div>
        <div className="topbar__status">
          <div className="status-chip">
            <span className={`dot dot--${feedMode}`} />
            <span>{feedMode.toUpperCase()}</span>
          </div>
          <div className="muted">{liveStatus}</div>
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Primary navigation">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-tab ${view === item.key ? 'nav-tab--active' : ''}`}
            onClick={() => setView(item.key)}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>

      <main className="layout">
        <section className="main-column">
          {view === 'dashboard' && (
            <>
              <section className="panel panel--hero">
                <div>
                  <div className="panel__eyebrow">Recruiter snapshot</div>
                  <h2>Queue health and candidate movement</h2>
                </div>
                <div className="stat-grid">
                  {stats.map((stat) => (
                    <article key={stat.label} className={`stat-card ${stat.accent}`}>
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <div>
                    <div className="panel__eyebrow">Recent activity</div>
                    <h3>Live status feed</h3>
                  </div>
                  <span className="muted">Updated from SSE / polling fallback</span>
                </div>
                <div className="activity-list">
                  {activities.map((activity) => (
                    <article key={activity.id} className="activity-row">
                      <div className="activity-row__time">{activity.at}</div>
                      <div className="activity-row__body">
                        <div className="activity-row__title">
                          <strong>{activity.label}</strong>
                          <span className={`badge ${activity.emphasis ? `tone-${activity.emphasis}` : 'tone-neutral'}`}>
                            {humanize(activity.kind)}
                          </span>
                        </div>
                        <p>{activity.detail}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <div>
                    <div className="panel__eyebrow">Pipeline view</div>
                    <h3>Workflow progress</h3>
                  </div>
                </div>
                <div className="workflow-grid">
                  {workflows.map((workflow) => (
                    <article key={workflow.id} className="workflow-card">
                      <div className="workflow-card__top">
                        <strong>{workflow.name}</strong>
                        <span className={`badge ${statusTone(workflow.status)}`}>{humanize(workflow.status)}</span>
                      </div>
                      <div className="progress">
                        <span style={{ width: `${workflow.progress}%` }} />
                      </div>
                      <p>{workflow.details}</p>
                      <div className="workflow-card__meta">
                        <span>Owner: {workflow.owner}</span>
                        <span>Last run: {workflow.lastRun}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {view === 'search' && (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <div className="panel__eyebrow">Search</div>
                  <h2>Find candidates with structured filters</h2>
                </div>
              </div>
              <div className="filter-bar">
                <label>
                  <span>Search</span>
                  <input
                    value={searchFilter.query}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Try: fintech RAG Singapore"
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={searchFilter.status}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, status: event.target.value }))}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'all' ? 'All statuses' : labelForResumeStatus(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Function area</span>
                  <select
                    value={searchFilter.functionArea}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, functionArea: event.target.value }))}
                  >
                    {FUNCTION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'all' ? 'All areas' : option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={searchFilter.verifiedOnly}
                    onChange={(event) => setSearchFilter((current) => ({ ...current, verifiedOnly: event.target.checked }))}
                  />
                  <span>Verified evidence only</span>
                </label>
              </div>
              <div className="search-results">
                {candidateCards.length ? candidateCards : <div className="empty-state">No candidates match the current filters.</div>}
              </div>
            </section>
          )}

          {view === 'candidate' && selectedCandidate && (
            <section className="panel">
              <div className="candidate-hero">
                <div>
                  <div className="panel__eyebrow">Candidate profile</div>
                  <h2>{selectedCandidate.name}</h2>
                  <p>
                    {selectedCandidate.currentTitle} · {selectedCandidate.currentCompany} · {selectedCandidate.location}
                  </p>
                </div>
                <div className="candidate-hero__meta">
                  <span className={`badge ${statusTone(selectedCandidate.resumeStatus)}`}>
                    {labelForResumeStatus(selectedCandidate.resumeStatus)}
                  </span>
                  <span className="score-pill">{formatScore(selectedCandidate.matchScore)} match</span>
                </div>
              </div>
              <div className="chip-row">
                {selectedCandidate.verifiedSkills.map((skill) => (
                  <span key={skill} className="chip">
                    {skill}
                  </span>
                ))}
              </div>
              <div className="detail-grid">
                <article className="detail-card">
                  <h3>Highlights</h3>
                  <ul>
                    {selectedCandidate.highlights.map((highlight) => (
                      <li key={highlight}>{highlight}</li>
                    ))}
                  </ul>
                </article>
                <article className="detail-card">
                  <h3>Experience</h3>
                  <div className="stacked-list">
                    {selectedCandidate.experiences.map((experience) => (
                      <div key={experience.id} className="stacked-item">
                        <strong>{experience.title}</strong>
                        <span>{experience.company}</span>
                        <small>{experience.period} · {experience.functionArea} · {experience.industry}</small>
                        <p>{experience.summary}</p>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
              <div className="detail-grid detail-grid--wide">
                <article className="detail-card">
                  <h3>Resume versions</h3>
                  <div className="stacked-list">
                    {selectedCandidate.resumes.map((resume) => (
                      <div key={resume.id} className="resume-row">
                        <div>
                          <strong>{resume.fileName}</strong>
                          <div className="muted">{resume.source} · {resume.fileSizeKb} KB · {resume.language.toUpperCase()}</div>
                        </div>
                        <div className="resume-row__side">
                          <span className={`badge ${statusTone(resume.status)}`}>{labelForResumeStatus(resume.status)}</span>
                          <small>{resume.uploadedAt}</small>
                        </div>
                        <p>{resume.notes}</p>
                      </div>
                    ))}
                  </div>
                </article>
                <article className="detail-card">
                  <h3>Facts and evidence</h3>
                  <div className="stacked-list">
                    {selectedCandidate.facts.map((fact) => (
                      <div key={fact.id} className="fact-row">
                        <div className="fact-row__top">
                          <strong>{fact.label}</strong>
                          <span className={`badge ${fact.verified ? 'tone-success' : 'tone-warning'}`}>
                            {fact.verified ? 'Verified' : 'Unverified'}
                          </span>
                        </div>
                        <div>{fact.value}</div>
                        <small className="muted">Source: {fact.source} · {fact.evidence}</small>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          )}

          {view === 'upload' && (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <div className="panel__eyebrow">Upload</div>
                  <h2>Start asynchronous resume ingestion</h2>
                </div>
              </div>
              <form className="upload-form" onSubmit={onUploadSubmit}>
                <label>
                  <span>Candidate name</span>
                  <input
                    required
                    value={uploadDraft.candidateName}
                    onChange={(event) => setUploadDraft((current) => ({ ...current, candidateName: event.target.value }))}
                    placeholder="Jane Doe"
                  />
                </label>
                <label>
                  <span>Current title</span>
                  <input
                    value={uploadDraft.title}
                    onChange={(event) => setUploadDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="AI Integration Engineer"
                  />
                </label>
                <label>
                  <span>Current company</span>
                  <input
                    value={uploadDraft.company}
                    onChange={(event) => setUploadDraft((current) => ({ ...current, company: event.target.value }))}
                    placeholder="Fintech Platform"
                  />
                </label>
                <label>
                  <span>File name</span>
                  <input
                    value={uploadDraft.fileName}
                    onChange={(event) => setUploadDraft((current) => ({ ...current, fileName: event.target.value }))}
                    placeholder="resume.pdf"
                  />
                </label>
                <div className="upload-form__actions">
                  <button className="primary-button" type="submit">
                    Upload and queue
                  </button>
                  <p className="muted">
                    Uploads immediately create a candidate record, queue a background job, and emit live status updates.
                  </p>
                </div>
              </form>
            </section>
          )}

          {view === 'verification' && (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <div className="panel__eyebrow">Verification</div>
                  <h2>Review AI-extracted facts before they become canonical</h2>
                </div>
              </div>
              <div className="verification-list">
                {selectedVerification.map((item) => (
                  <article key={item.id} className="verification-card">
                    <div className="verification-card__top">
                      <strong>{item.factLabel}</strong>
                      <span className={`badge ${statusTone(item.status)}`}>{humanize(item.status)}</span>
                    </div>
                    <div className="verification-card__value">{item.proposedValue}</div>
                    <p>{item.evidence}</p>
                    <div className="verification-card__meta">
                      <span>Confidence: {Math.round(item.confidence * 100)}%</span>
                      <span>Source: {item.source}</span>
                    </div>
                    <div className="action-row">
                      <button type="button" onClick={() => updateVerificationStatus(item.id, 'approved')}>
                        Approve
                      </button>
                      <button type="button" onClick={() => updateVerificationStatus(item.id, 'rejected')}>
                        Reject
                      </button>
                      <button type="button" onClick={() => handleEditVerification(item.id)}>
                        Edit
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {view === 'workflows' && (
            <section className="panel">
              <div className="panel__header">
                <div>
                  <div className="panel__eyebrow">Workflows</div>
                  <h2>Recruiter processes and automation status</h2>
                </div>
              </div>
              <div className="workflow-list workflow-list--stacked">
                {workflows.map((workflow) => (
                  <article key={workflow.id} className="workflow-card workflow-card--wide">
                    <div className="workflow-card__top">
                      <strong>{workflow.name}</strong>
                      <span className={`badge ${statusTone(workflow.status)}`}>{humanize(workflow.status)}</span>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${workflow.progress}%` }} />
                    </div>
                    <p>{workflow.details}</p>
                    <div className="workflow-card__meta">
                      <span>Owner: {workflow.owner}</span>
                      <span>Last run: {workflow.lastRun}</span>
                      <span>Progress: {workflow.progress}%</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>

        <aside className="side-column">
          <section className="panel panel--sticky">
            <div className="panel__header">
              <div>
                <div className="panel__eyebrow">Candidate spotlight</div>
                <h3>{selectedCandidate?.name ?? 'No candidate selected'}</h3>
              </div>
            </div>
            {selectedCandidate ? (
              <>
                <div className="spotlight-metric">
                  <span>Pipeline stage</span>
                  <strong>{selectedCandidate.pipelineStage}</strong>
                </div>
                <div className="spotlight-metric">
                  <span>Resume status</span>
                  <strong>{labelForResumeStatus(selectedCandidate.resumeStatus)}</strong>
                </div>
                <div className="spotlight-metric">
                  <span>Function area</span>
                  <strong>{selectedCandidate.functionArea}</strong>
                </div>
                <div className="spotlight-metric">
                  <span>Industry</span>
                  <strong>{selectedCandidate.industry}</strong>
                </div>
                <div className="spotlight-metric">
                  <span>Verification count</span>
                  <strong>{selectedCandidate.facts.filter((fact) => fact.verified).length} verified</strong>
                </div>
                <button className="secondary-button" type="button" onClick={() => setView('candidate')}>
                  Open full profile
                </button>
              </>
            ) : (
              <p className="muted">Select a candidate from search to inspect resumes, facts, and evidence.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <div className="panel__eyebrow">Queue health</div>
                <h3>Throughput snapshot</h3>
              </div>
            </div>
            <div className="metric-list">
              {stats.map((stat) => (
                <div key={stat.label} className="metric-row">
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <div className="panel__eyebrow">Live status</div>
                <h3>Feed details</h3>
              </div>
            </div>
            <div className="live-box">
              <div className="live-box__row">
                <span>Mode</span>
                <strong>{feedMode.toUpperCase()}</strong>
              </div>
              <div className="live-box__row">
                <span>Status</span>
                <strong>{liveStatus}</strong>
              </div>
              <div className="live-box__row">
                <span>Selected view</span>
                <strong>{humanize(view)}</strong>
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
