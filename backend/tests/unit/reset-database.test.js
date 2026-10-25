const { resetDatabase } = require('../../scripts/reset-database');

describe('database reset confirmation', () => {
  test('refuses deletion without confirmation', async () => {
    const database = {
      databaseName: 'test-db',
      listCollections: jest.fn(),
      collection: jest.fn(),
    };
    await expect(resetDatabase(database, { confirmed: false, log: jest.fn() }))
      .rejects.toThrow('--yes');
    expect(database.listCollections).not.toHaveBeenCalled();
    expect(database.collection).not.toHaveBeenCalled();
  });

  test('deletes all documents in every collection with confirmation', async () => {
    const deleteMany = jest.fn().mockResolvedValue({});
    const database = {
      databaseName: 'test-db',
      listCollections: () => ({ toArray: async () => [{ name: 'users' }, { name: 'courses' }] }),
      collection: jest.fn(() => ({ deleteMany })),
    };
    await resetDatabase(database, { confirmed: true, log: jest.fn() });
    expect(database.collection).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({});
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});
