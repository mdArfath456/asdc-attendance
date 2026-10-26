const { runMerge } = require('../../scripts/merge-same-day-sessions');

describe('same-day session migration dry run', () => {
  test('plans the best record without modifying collections by default', async () => {
    const sessions = [
      { _id: 's1', batchId: 'b1', status: 'CLOSED', scheduledStart: new Date('2026-10-26T08:00:00Z') },
      { _id: 's2', batchId: 'b1', status: 'CLOSED', scheduledStart: new Date('2026-10-26T10:00:00Z') },
    ];
    const records = [
      { _id: 'r1', sessionId: 's1', enrollmentId: 'e1', status: 'ABSENT' },
      { _id: 'r2', sessionId: 's2', enrollmentId: 'e1', status: 'PRESENT', checkInTimestamp: new Date('2026-10-26T10:05:00Z') },
    ];
    const collection = (items) => ({
      find: jest.fn(() => ({ toArray: async () => items })),
      bulkWrite: jest.fn(),
      deleteMany: jest.fn(),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    });
    const sessionsCollection = collection(sessions);
    const recordsCollection = collection(records);
    const database = {
      collection: jest.fn((name) => (name === 'attendancesessions' ? sessionsCollection : recordsCollection)),
    };

    const result = await runMerge(database);

    expect(result.counts).toMatchObject({ groupsMerged: 1, sessionsDeleted: 1, recordsDeleted: 1 });
    expect(result.plan.recordDateUpdates).toHaveLength(1);
    expect(String(result.plan.recordDateUpdates[0].id)).toBe('r2');
    expect(String(result.plan.recordDateUpdates[0].sessionId)).toBe('s1');
    expect(sessionsCollection.bulkWrite).not.toHaveBeenCalled();
    expect(sessionsCollection.deleteMany).not.toHaveBeenCalled();
    expect(sessionsCollection.createIndex).not.toHaveBeenCalled();
    expect(recordsCollection.bulkWrite).not.toHaveBeenCalled();
    expect(recordsCollection.deleteMany).not.toHaveBeenCalled();
  });
});
