import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedRouteDecision } from '../src/auth/routeAccess.js';

test('anonymous visitors are redirected away from protected areas', () => {
  assert.equal(protectedRouteDecision(null, ['ADMIN']), 'redirect');
});

test('authenticated users are denied access to another role area', () => {
  assert.equal(protectedRouteDecision({ role: 'STUDENT' }, ['ADMIN']), 'denied');
  assert.equal(protectedRouteDecision({ role: 'TRAINER' }, ['STUDENT']), 'denied');
});

test('users with an allowed role can enter the protected area', () => {
  assert.equal(protectedRouteDecision({ role: 'ADMIN' }, ['ADMIN']), 'allow');
});
