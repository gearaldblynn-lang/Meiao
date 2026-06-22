import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAppState,
  analyzeAppStateRow,
  summarizeAppStateHealthReports,
} from './appStateHealth.mjs';

test('analyzeAppState detects dirty task identity and display-state anomalies', () => {
  const report = analyzeAppState({
    shellProjects: [
      {
        id: 'project-a',
        module: 'one_click',
        status: 'completed',
        taskCount: 2,
        completedCount: 1,
        updatedAt: 1700000000000,
        results: [
          {
            id: 'result-a',
            status: 'completed',
            imageUrl: 'https://cdn.test/a.png',
            backendJobId: 'job-a',
            taskId: 'job-a',
          },
          {
            id: 'result-b',
            status: 'generating',
            imageUrl: '',
          },
        ],
      },
      {
        id: 'project-b',
        module: 'one_click',
        status: 'generating',
        updatedAt: 1700000001000,
        results: [
          {
            id: 'result-c',
            backendJobId: 'job-a',
            status: 'generating',
          },
        ],
      },
    ],
    oneClickMemory: {
      firstImage: {
        projects: [
          {
            id: 'project-a',
            module: 'one_click',
            status: 'completed',
            results: [{ id: 'result-a-branch', imageUrl: 'https://cdn.test/a.png', status: 'completed' }],
          },
        ],
      },
    },
  });

  assert.equal(report.projectCount, 3);
  assert.equal(report.resultCount, 4);
  assert.equal(report.issueCounts.duplicate_project_id || 0, 0);
  assert.equal(report.issueCounts.duplicate_task_identity, 1);
  assert.equal(report.issueCounts.completed_project_incomplete, 1);
  assert.equal(report.issueCounts.completed_project_has_active_result, 1);
  assert.equal(report.issueCounts.active_result_without_identity, 1);
  assert.equal(report.issueCounts.internal_job_id_visible_as_task_id, 1);
});

test('analyzeAppState treats shell and branch project mirrors as normal', () => {
  const report = analyzeAppState({
    shellProjects: [{ id: 'project-a', status: 'completed', results: [{ id: 'result-a', imageUrl: '/a.png' }] }],
    oneClickMemory: {
      firstImage: {
        projects: [{ id: 'project-a', status: 'completed', schemes: [{ id: 'scheme-a', resultUrl: '/a.png' }] }],
      },
    },
  });

  assert.equal(report.issueCounts.duplicate_project_id || 0, 0);
});

test('analyzeAppState detects duplicate project ids inside the same bucket', () => {
  const report = analyzeAppState({
    shellProjects: [
      { id: 'project-a', status: 'completed', results: [{ id: 'result-a', imageUrl: '/a.png' }] },
      { id: 'project-a', status: 'completed', results: [{ id: 'result-b', imageUrl: '/b.png' }] },
    ],
  });

  assert.equal(report.issueCounts.duplicate_project_id, 1);
});

test('analyzeAppStateRow reports invalid JSON without throwing', () => {
  const report = analyzeAppStateRow({
    user_id: 'user-a',
    username: 'alice',
    state_json: '{"shellProjects":',
  });

  assert.equal(report.userId, 'user-a');
  assert.equal(report.username, 'alice');
  assert.equal(report.parseOk, false);
  assert.equal(report.issueCounts.invalid_json, 1);
});

test('analyzeAppState does not treat parent project and child result identity as duplicate', () => {
  const report = analyzeAppState({
    shellProjects: [{
      id: 'project-a',
      backendJobId: 'job-a',
      status: 'completed',
      taskCount: 1,
      completedCount: 1,
      results: [{
        id: 'result-a',
        backendJobId: 'job-a',
        taskId: 'provider-a',
        status: 'completed',
        imageUrl: 'https://cdn.test/a.png',
      }],
    }],
  });

  assert.equal(report.issueCounts.duplicate_task_identity || 0, 0);
});

test('summarizeAppStateHealthReports aggregates users and issue counts', () => {
  const reports = [
    analyzeAppStateRow({
      user_id: 'user-a',
      username: 'alice',
      state_json: JSON.stringify({
        shellProjects: [{
          id: 'project-a',
          status: 'completed',
          taskCount: 1,
          completedCount: 0,
          results: [],
        }],
      }),
    }),
    analyzeAppStateRow({
      user_id: 'user-b',
      username: 'bob',
      state_json: JSON.stringify({
        shellProjects: [{
          id: 'project-b',
          status: 'generating',
          results: [{ id: 'pending-placeholder', status: 'generating', imageUrl: '' }],
        }],
      }),
    }),
  ];

  const summary = summarizeAppStateHealthReports(reports);

  assert.equal(summary.userCount, 2);
  assert.equal(summary.usersWithIssues, 2);
  assert.equal(summary.issueCounts.completed_project_without_output, 1);
  assert.equal(summary.issueCounts.active_result_without_identity, 1);
});
