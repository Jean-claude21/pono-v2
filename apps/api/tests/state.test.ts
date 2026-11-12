import { describe, expect, it } from 'vitest';
import { projectState, type StateFacts } from '../src/features/projects/domain/state.js';

const now = new Date('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const facts = (over: Partial<StateFacts>): StateFacts => ({
  link: 'up',
  latestProduction: null,
  lastCommitAt: null,
  connectionExpired: false,
  now,
  ...over,
});

describe('projectState (FR-007)', () => {
  it('fails when production is down, before anything else', () => {
    expect(projectState(facts({ link: 'down', lastCommitAt: hoursAgo(1) }))).toEqual({
      state: 'failing',
      reason: 'production_down',
    });
  });
  it('fails when the latest production deployment failed', () => {
    expect(
      projectState(facts({ latestProduction: { status: 'failed', createdAt: hoursAgo(2) } })),
    ).toEqual({ state: 'failing', reason: 'deployment_failed' });
  });
  it('warns when a connection expired', () => {
    expect(projectState(facts({ connectionExpired: true }))).toEqual({
      state: 'warning',
      reason: 'connection_expired',
    });
  });
  it('is active while deploying, or within 24 hours of activity', () => {
    expect(
      projectState(facts({ latestProduction: { status: 'building', createdAt: hoursAgo(100) } }))
        .state,
    ).toBe('active');
    expect(projectState(facts({ lastCommitAt: hoursAgo(23) }))).toEqual({
      state: 'active',
      reason: 'recent_activity',
    });
  });
  it('is idle after 30 days without activity, healthy in between or without data', () => {
    expect(projectState(facts({ lastCommitAt: hoursAgo(31 * 24) }))).toEqual({
      state: 'idle',
      reason: 'no_recent_activity',
    });
    expect(projectState(facts({ lastCommitAt: hoursAgo(48) }))).toEqual({
      state: 'healthy',
      reason: 'nominal',
    });
    expect(projectState(facts({}))).toEqual({ state: 'healthy', reason: 'nominal' });
  });
  it('takes the latest of commit and deployment as activity', () => {
    const state = projectState(
      facts({
        lastCommitAt: hoursAgo(40 * 24),
        latestProduction: { status: 'succeeded', createdAt: hoursAgo(2) },
      }),
    );
    expect(state.state).toBe('active');
  });
});
