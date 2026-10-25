import { describe, expect, it } from 'vitest';
import { renderReportText, type ReportContent } from '@/server/services/reports';

function task(over: Partial<ReportContent['completedToday'][number]> = {}) {
  return {
    id: 'id-1',
    title: 'Finish the investor presentation',
    priority: 'urgent' as const,
    status: 'in_progress',
    dueDate: '2026-03-15',
    assigneeName: 'Alice Alpha',
    projectName: 'Investor presentation',
    url: 'http://localhost:3000/tasks/id-1',
    ...over,
  };
}

function base(over: Partial<ReportContent> = {}): ReportContent {
  return {
    scope: 'personal',
    reportDate: '2026-03-15',
    timezone: 'Asia/Kolkata',
    workspaceName: 'Acme Team',
    subjectName: 'Alice Alpha',
    completedToday: [],
    remainingToday: [],
    overdue: [],
    importantUnfinished: [],
    blocked: [],
    upcomingDeadlines: [],
    tomorrowPriorities: [],
    needsOwner: [],
    projects: [],
    milestonesAtRisk: [],
    upcomingEvents: [],
    perMember: [],
    narrative: null,
    ...over,
  };
}

describe('renderReportText', () => {
  it('omits a section entirely when it has no records', () => {
    const text = renderReportText(base());
    expect(text).not.toContain('Completed today');
    expect(text).not.toContain('Overdue');
    // The heading and the app link are always present.
    expect(text).toContain('Daily summary');
    expect(text).toContain('http://localhost:3000/home');
  });

  it('includes only the sections backed by records', () => {
    const text = renderReportText(base({
      completedToday: [task({ title: 'Collect competitor pricing', status: 'completed' })],
      overdue: [task({ title: 'Write the market research section', dueDate: '2026-03-13' })],
    }));
    expect(text).toContain('Completed today');
    expect(text).toContain('Collect competitor pricing');
    expect(text).toContain('Overdue');
    expect(text).toContain('Write the market research section');
    expect(text).not.toContain('Blocked');
  });

  it('names the owner in a team report but not in a personal one', () => {
    const records = { completedToday: [task({ status: 'completed' })] };

    const team = renderReportText(base({ ...records, scope: 'team', subjectName: null }));
    expect(team).toContain('Alice Alpha');
    expect(team).toContain('Acme Team — team summary');

    const personal = renderReportText(base(records));
    expect(personal).not.toContain('— Alice Alpha');
  });

  it('only shows the needs-an-owner section for a team report', () => {
    const unowned = { needsOwner: [task({ title: 'Pick a web host', assigneeName: null })] };
    expect(renderReportText(base({ ...unowned, scope: 'team', subjectName: null })))
      .toContain('Needs an owner or a decision');
    expect(renderReportText(base(unowned)))
      .not.toContain('Needs an owner or a decision');
  });

  it('states "no tasks yet" rather than 0% for an empty project', () => {
    const text = renderReportText(base({
      projects: [{
        id: 'p1', name: 'Empty project', completed: 0, total: 0,
        percent: null, overdue: 0, blocked: 0, url: 'http://localhost:3000/projects/p1',
      }],
    }));
    expect(text).toContain('Empty project: 0/0 (no tasks yet)');
    expect(text).not.toContain('(0%)');
  });

  it('reports a real percentage when there are tasks', () => {
    const text = renderReportText(base({
      projects: [{
        id: 'p1', name: 'Investor presentation', completed: 1, total: 3,
        percent: 33.3, overdue: 1, blocked: 1, url: 'http://localhost:3000/projects/p1',
      }],
    }));
    expect(text).toContain('Investor presentation: 1/3 (33.3%), 1 overdue, 1 blocked');
  });

  it('truncates a long list rather than sending hundreds of lines', () => {
    const many = Array.from({ length: 25 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    const text = renderReportText(base({ remainingToday: many }));
    expect(text).toContain('…and 15 more');
    expect(text).not.toContain('Task 20');
  });

  it('uses the narrative headline when one exists but never invents figures', () => {
    const text = renderReportText(base({
      completedToday: [task({ status: 'completed' })],
      narrative: {
        headline: 'One item closed; the research section is still blocked.',
        attention: ['The research section has been blocked for two days.'],
        tomorrow: [],
      },
    }));
    expect(text).toContain('One item closed');
    expect(text).toContain('Needs attention');
    expect(text).toContain('blocked for two days');
  });

  it('renders a readable date rather than an ISO string', () => {
    expect(renderReportText(base())).toContain('15 Mar 2026');
  });
});
