import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as expensesRepo from '../lib/data/expensesRepo';
import * as transactions from '../lib/data/transactions';
import * as mode from '../lib/data/mode';
import * as supabaseClient from '../lib/supabase/client';

describe('Concurrency and Targeted Mutations', () => {
  let mockInsert: any;
  let mockUpsert: any;
  let mockUpdate: any;
  let mockRpc: any;
  let mockSelect: any;

  beforeEach(() => {
    mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockRpc = vi.fn().mockResolvedValue({ error: null });
    
    const mockEq = vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) });
    mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

    vi.spyOn(mode, 'getDataMode').mockReturnValue('cloud');
    
    vi.spyOn(supabaseClient, 'getSupabase').mockReturnValue({
      from: (table: string) => ({
        insert: mockInsert,
        upsert: mockUpsert,
        update: mockUpdate,
        select: mockSelect,
      }),
      rpc: mockRpc,
    } as any);
  });

  it('Device A creating an expense should only INSERT, not UPSERT the entire list', async () => {
    const expense = {
      id: 'exp-123',
      date: '2023-01-01',
      category: 'Feed',
      amount: 100,
      description: 'Test feed',
      createdAt: new Date().toISOString(),
    };

    await expensesRepo.insertExpense(expense);

    // Should call insert, not upsert
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    
    const insertedRow = mockInsert.mock.calls[0][0];
    expect(insertedRow.id).toBe('exp-123');
    expect(insertedRow.amount).toBe(100);
  });

  it('Device A recording a sale should use RPC and not bulk upsert', async () => {
    const sale = {
      id: 'sale-123',
      dateLabel: '2023-01-01',
      customer: 'John',
      customerPhone: '123',
      total: 100,
      items: [],
      createdAt: new Date().toISOString(),
    };
    
    await transactions.recordSaleTransaction(sale, []);
    
    expect(mockRpc).toHaveBeenCalledWith('record_sale', expect.anything());
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
