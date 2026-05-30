import { useEffect, useMemo, useState } from 'react';
import type { DashboardEvent } from '../lib/status';

export type FeedMode = 'sse' | 'polling' | 'demo';

type FeedOptions = {
  enabled?: boolean;
  onEvent: (event: DashboardEvent) => void;
};

const DEMO_EVENTS: DashboardEvent[] = [
  { kind: 'resume.status.updated', status: 'queued', delta: 1 },
  { kind: 'resume.status.updated', status: 'extracting_text', delta: 1 },
  { kind: 'resume.status.updated', status: 'structuring', delta: 1 },
  { kind: 'resume.status.updated', status: 'chunking', delta: 1 },
  { kind: 'background_job.updated', status: 'processing', delta: 1 },
  { kind: 'resume.status.updated', status: 'indexed', delta: 1 },
  { kind: 'resume.status.updated', status: 'needs_review', delta: 1 },
  { kind: 'background_job.updated', status: 'review', delta: 1 }
];

export function useLiveStatusFeed({ enabled = true, onEvent }: FeedOptions): FeedMode {
  const [mode, setMode] = useState<FeedMode>('demo');

  const emitDemoEvent = useMemo(() => {
    let index = 0;
    return () => {
      const event = DEMO_EVENTS[index % DEMO_EVENTS.length];
      index += 1;
      onEvent(event);
    };
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    let closed = false;
    let timer: number | undefined;
    let eventSource: EventSource | null = null;

    const startDemo = () => {
      if (closed) return;
      setMode('demo');
      emitDemoEvent();
      timer = window.setInterval(() => {
        emitDemoEvent();
      }, 6500);
    };

    const startPolling = async () => {
      if (closed) return;
      setMode('polling');
      try {
        const response = await fetch('/api/dashboard/events?limit=1', {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          startDemo();
          return;
        }
        const payload = (await response.json()) as { events?: DashboardEvent[] };
        payload.events?.forEach((event) => onEvent(event));
      } catch {
        startDemo();
        return;
      }

      timer = window.setInterval(async () => {
        try {
          const response = await fetch('/api/dashboard/events?limit=5', {
            headers: { Accept: 'application/json' }
          });
          if (!response.ok) {
            return;
          }
          const payload = (await response.json()) as { events?: DashboardEvent[] };
          payload.events?.forEach((event) => onEvent(event));
        } catch {
          // keep polling; demo mode already kicked in if the initial request failed.
        }
      }, 8000);
    };

    if ('EventSource' in window) {
      try {
        eventSource = new window.EventSource('/api/events/stream');
        setMode('sse');
        eventSource.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data) as DashboardEvent;
            onEvent(event);
          } catch {
            // Ignore malformed events and keep the connection alive.
          }
        };
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          if (!closed) {
            startPolling();
          }
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      closed = true;
      eventSource?.close();
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [enabled, emitDemoEvent, onEvent]);

  return mode;
}
