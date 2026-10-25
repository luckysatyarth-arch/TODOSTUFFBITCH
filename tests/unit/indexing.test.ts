import { describe, expect, it } from 'vitest';

/**
 * The shaping step that decides what internal search can return.
 *
 * `access_scope` is the load-bearing privacy flag: a document marked
 * `workspace` is readable by every member of that workspace, so an internal
 * record must only ever carry that scope when the workspace itself is the
 * right audience. These tests pin that decision down, because a builder that
 * quietly started emitting `workspace` for owner-private content would widen
 * who can read it without any policy or migration changing.
 */

const workspace = '00000000-0000-0000-0000-0000000000aa';

describe('taskDocument', () => {
  it('scopes a task to the workspace and keeps the id addressable', async () => {
    const { taskDocument } = await import('@/server/services/indexer');
    const doc = taskDocument(workspace, {
      id: 'task-1',
      title: 'Ship the billing migration',
      description: 'Run it behind the flag first.',
      status: 'in_progress',
      priority: 'high',
      due_date: '2026-11-02',
      updated_at: '2026-10-20T10:00:00.000Z',
      projectName: 'Billing',
    });

    expect(doc.accessScope).toBe('workspace');
    expect(doc.sourceType).toBe('internal_task');
    expect(doc.sourceRecordId).toBe('task-1');
    // The citation has to point back at a real screen, scoped to the workspace
    // the reader was searching in.
    expect(doc.url).toBe(`/tasks/task-1?workspace=${workspace}`);
  });

  it('indexes the fields people actually search by', async () => {
    const { taskDocument } = await import('@/server/services/indexer');
    const doc = taskDocument(workspace, {
      id: 'task-2',
      title: 'Renew the TLS certificate',
      description: 'Expires at the end of the month.',
      status: 'todo',
      priority: 'urgent',
      due_date: '2026-10-31',
      projectName: 'Platform',
    });

    expect(doc.content).toContain('Renew the TLS certificate');
    expect(doc.content).toContain('status: todo');
    expect(doc.content).toContain('priority: urgent');
    expect(doc.content).toContain('due: 2026-10-31');
    expect(doc.content).toContain('project: Platform');
    expect(doc.metadata).toEqual({ status: 'todo', priority: 'urgent' });
  });

  it('omits absent optional fields rather than indexing empty labels', async () => {
    const { taskDocument } = await import('@/server/services/indexer');
    const doc = taskDocument(workspace, {
      id: 'task-3',
      title: 'Untriaged idea',
      description: null,
      status: 'todo',
      priority: 'low',
      due_date: null,
    });

    expect(doc.content).not.toContain('due:');
    expect(doc.content).not.toContain('project:');
    expect(doc.excerpt).toBeNull();
  });

  it('caps the excerpt so a long description cannot dominate a result list', async () => {
    const { taskDocument } = await import('@/server/services/indexer');
    const doc = taskDocument(workspace, {
      id: 'task-4',
      title: 'Long one',
      description: 'x'.repeat(1_000),
      status: 'todo',
      priority: 'medium',
      due_date: null,
    });

    expect(doc.excerpt).toHaveLength(300);
    // The full text is still searchable even though the preview is cut.
    expect(doc.content.length).toBeGreaterThan(300);
  });
});

describe('projectDocument and noteDocument', () => {
  it('scopes a project to the workspace', async () => {
    const { projectDocument } = await import('@/server/services/indexer');
    const doc = projectDocument(workspace, {
      id: 'project-1',
      name: 'Billing',
      description: 'Invoicing rebuild.',
      status: 'active',
    });

    expect(doc.accessScope).toBe('workspace');
    expect(doc.sourceType).toBe('internal_project');
    expect(doc.title).toBe('Billing');
    expect(doc.url).toBe(`/projects/project-1?workspace=${workspace}`);
  });

  it('scopes a note to the workspace', async () => {
    const { noteDocument } = await import('@/server/services/indexer');
    const doc = noteDocument(workspace, {
      id: 'note-1',
      title: 'Standup notes',
      body: 'Discussed the migration.',
    });

    expect(doc.accessScope).toBe('workspace');
    expect(doc.sourceType).toBe('internal_note');
    expect(doc.content).toBe('Standup notes\n\nDiscussed the migration.');
  });

  it('never emits an owner-scoped internal document without an owner', async () => {
    const { taskDocument, projectDocument, noteDocument } =
      await import('@/server/services/indexer');

    // Internal records live in a workspace, and a personal workspace has
    // exactly one member, so `workspace` is the correct scope for all three.
    // `owner_only` is reserved for connector content (one person's mail or
    // private files), which is written through the batch path that supplies an
    // owner id alongside the scope.
    const docs = [
      taskDocument(workspace, {
        id: 't', title: 't', description: null,
        status: 'todo', priority: 'low', due_date: null,
      }),
      projectDocument(workspace, {
        id: 'p', name: 'p', description: null, status: 'active',
      }),
      noteDocument(workspace, { id: 'n', title: 'n', body: 'n' }),
    ];

    for (const doc of docs) expect(doc.accessScope).toBe('workspace');
  });
});
