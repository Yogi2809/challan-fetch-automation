import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/omsService.js', () => ({
  getExistingChallans: vi.fn(),
}));
vi.mock('../src/services/challanService.js', () => ({
  postChallan: vi.fn(),
}));
vi.mock('../src/utils/offenceLookup.js', () => ({
  lookupOffenceAmount: vi.fn().mockReturnValue({ amount: null, source: 'manual_lookup_needed' }),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    unlinkSync: vi.fn(),
  };
});

import { getExistingChallans } from '../src/services/omsService.js';
import { postChallan } from '../src/services/challanService.js';
import { deduplicateAndPost } from '../src/worker/steps/deduplicatePost.js';

const baseRow = {
  noticeNo: 'N001',
  vehicleNumber: 'DL1AB1234',
  offenceDate: '2024-01-15',
  offenceDetail: 'Red Light Jumping',
  offenceLocation: 'CP Delhi',
  penaltyAmount: '500',
  status: 'Pending',
  challanType: 'ONLINE',
  imageBuffer: Buffer.from('fake-image'),
};

const opts = {
  appointmentId: 'APT-001',
  sessionId: 'sess-001',
  createdBy: 'test@cars24.com',
  offenceLookupMap: new Map(),
  emitStatus: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe('deduplicateAndPost', () => {
  it('posts a new row not in OMS', async () => {
    getExistingChallans.mockResolvedValue([]);
    postChallan.mockResolvedValue({ id: 'c1' });
    const result = await deduplicateAndPost({ ...opts, scrapedRows: [baseRow] });
    expect(postChallan).toHaveBeenCalledTimes(1);
    expect(result[0].success).toBe(true);
  });

  it('skips a row that already exists in OMS', async () => {
    getExistingChallans.mockResolvedValue([{ noticeNumber: 'N001' }]);
    const result = await deduplicateAndPost({ ...opts, scrapedRows: [baseRow] });
    expect(postChallan).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('posts new rows, skips duplicates', async () => {
    const row2 = { ...baseRow, noticeNo: 'N002' };
    getExistingChallans.mockResolvedValue([{ noticeNumber: 'N001' }]);
    postChallan.mockResolvedValue({ id: 'c2' });
    const result = await deduplicateAndPost({ ...opts, scrapedRows: [baseRow, row2] });
    expect(postChallan).toHaveBeenCalledTimes(1);
    expect(result[0].noticeNo).toBe('N002');
  });

  it('uses "0" when penaltyAmount blank and XLSX no match', async () => {
    const row = { ...baseRow, penaltyAmount: '' };
    getExistingChallans.mockResolvedValue([]);
    postChallan.mockResolvedValue({});
    await deduplicateAndPost({ ...opts, scrapedRows: [row] });
    expect(postChallan.mock.calls[0][0].amount).toBe('0');
  });

  it('captures POST errors without stopping other rows', async () => {
    const row2 = { ...baseRow, noticeNo: 'N002' };
    getExistingChallans.mockResolvedValue([]);
    postChallan
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ id: 'c2' });
    const result = await deduplicateAndPost({ ...opts, scrapedRows: [baseRow, row2] });
    expect(result[0].success).toBe(false);
    expect(result[1].success).toBe(true);
  });

  it('uses default createdBy when not provided', async () => {
    getExistingChallans.mockResolvedValue([]);
    postChallan.mockResolvedValue({});
    await deduplicateAndPost({ ...opts, createdBy: undefined, scrapedRows: [baseRow] });
    expect(postChallan.mock.calls[0][0].createdBy).toBe('yogesh.mishra@cars24.com');
  });

  it('uses default challanCourt when offenceLocation blank', async () => {
    const row = { ...baseRow, offenceLocation: '' };
    getExistingChallans.mockResolvedValue([]);
    postChallan.mockResolvedValue({});
    await deduplicateAndPost({ ...opts, scrapedRows: [row] });
    expect(postChallan.mock.calls[0][0].challanCourt).toBe('Delhi(Traffic Department)');
  });
});
