import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';

const appBaseUrl = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;
const emptyDashboard = {
  range: { from: '2026-09-09T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' },
  orders: { count: 0, delivered: [] },
  payments: [],
  refunds: [],
  newUsers: 0,
  newRestaurants: 0,
};

async function json(route: Route, data: unknown) {
  const origin = route.request().headers().origin;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: origin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
      : {},
    body: JSON.stringify({ data }),
  });
}

test('admin reviews currency-separated dashboard metrics and exports a report', async ({
  page,
}) => {
  let dashboardCalls = 0;
  await page.route('**/api/v1/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('/admin/dashboard')) {
      dashboardCalls += 1;
      return json(route, {
        range: { from: '2026-09-09T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' },
        orders: {
          count: 3,
          delivered: [
            { currency: 'INR', _count: { _all: 2 }, _sum: { subtotalMinor: 1900 } },
            { currency: 'USD', _count: { _all: 1 }, _sum: { subtotalMinor: 1200 } },
          ],
        },
        payments: [],
        refunds: [],
        newUsers: 2,
        newRestaurants: 1,
      });
    }
    if (path.endsWith('/admin/reports')) {
      return json(route, {
        ordersByStatusAndCurrency: [
          {
            status: 'DELIVERED',
            currency: 'INR',
            _count: { _all: 2 },
            _sum: {
              subtotalMinor: 1900,
              discountMinor: 0,
              feesMinor: 100,
              taxMinor: 50,
              tipMinor: 0,
              totalMinor: 2050,
            },
          },
        ],
        paymentsByStatusAndCurrency: [],
        refundsByStatusAndCurrency: [],
      });
    }
    if (path.endsWith('/admin/reports/export')) {
      const origin = route.request().headers().origin;
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: origin
          ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }
          : {},
        body: 'record_type,status,currency,count\r\norder,DELIVERED,INR,2\r\n',
      });
    }
    return route.continue();
  });

  await page.goto(`${appBaseUrl}/admin`);
  await expect(page.getByRole('heading', { name: 'Admin console' })).toBeVisible();
  await expect.poll(() => dashboardCalls).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Delivered orders' })).toBeVisible();
  await expect(page.getByText('INR item subtotal')).toBeVisible();
  await expect(page.getByText('USD item subtotal')).toBeVisible();

  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Financial and order totals' })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('urban-spoon-report.csv');

  const viewportWidth = page.viewportSize()?.width ?? 1280;
  const renderedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(renderedWidth).toBeLessThanOrEqual(viewportWidth);
});

test('admin manages user status, cancels an order, and processes refund queue actions', async ({
  page,
}) => {
  let userStatus = 'ACTIVE';
  let orderStatus = 'PREPARING';
  let refunds = [
    {
      id: 'refund-requested',
      status: 'REQUESTED',
      amountMinor: 500,
      currency: 'INR',
      reason: 'Missing item',
      createdAt: '2026-10-08T10:00:00.000Z',
      order: { id: 'order-1', status: 'DELIVERED' },
      requestedBy: { name: 'Support agent' },
    },
    {
      id: 'refund-failed',
      status: 'FAILED',
      amountMinor: 300,
      currency: 'USD',
      reason: 'Provider timeout',
      createdAt: '2026-10-08T11:00:00.000Z',
      order: { id: 'order-2', status: 'DELIVERED' },
      requestedBy: { name: 'Admin' },
    },
  ];

  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (path.endsWith('/admin/dashboard')) return json(route, emptyDashboard);
    if (path.endsWith('/admin/users/user-1/status') && request.method() === 'PATCH') {
      userStatus = (request.postDataJSON() as { status: string }).status;
      return json(route, { status: userStatus });
    }
    if (path.endsWith('/admin/users')) {
      return json(route, {
        items: [
          {
            id: 'user-1',
            name: 'Sam Customer',
            email: 'sam@example.test',
            status: userStatus,
            createdAt: '2026-10-01T10:00:00.000Z',
            roles: [],
          },
        ],
        page: 1,
        limit: 50,
        total: 1,
      });
    }
    if (path.endsWith('/admin/orders/order-1/cancel') && request.method() === 'POST') {
      orderStatus = 'CANCELLED_BY_ADMIN';
      return json(route, { status: orderStatus });
    }
    if (path.endsWith('/admin/orders')) {
      return json(route, {
        items: [
          {
            id: 'order-1',
            status: orderStatus,
            totalMinor: 2050,
            currency: 'INR',
            createdAt: '2026-10-08T12:00:00.000Z',
            user: { name: 'Sam Customer', email: 'sam@example.test' },
            restaurant: { name: 'Corner Kitchen' },
            refunds: [],
          },
        ],
        page: 1,
        limit: 50,
        total: 1,
      });
    }
    if (path.endsWith('/admin/refunds/refund-requested/approve')) {
      refunds = refunds.map((refund) =>
        refund.id === 'refund-requested' ? { ...refund, status: 'SUBMITTED' } : refund,
      );
      return json(route, { status: 'SUBMITTED' });
    }
    if (path.endsWith('/admin/refunds/refund-failed/retry')) {
      refunds = refunds.map((refund) =>
        refund.id === 'refund-failed' ? { ...refund, status: 'SUBMITTED' } : refund,
      );
      return json(route, { status: 'SUBMITTED' });
    }
    if (path.endsWith('/admin/refunds') && request.method() === 'POST') {
      refunds = [
        {
          ...refunds[0],
          id: 'refund-new',
          status: 'REQUESTED',
          amountMinor: (request.postDataJSON() as { amountMinor: number }).amountMinor,
        },
        ...refunds,
      ];
      return json(route, refunds[0]);
    }
    if (path.endsWith('/admin/refunds')) {
      return json(route, { items: refunds, page: 1, limit: 50, total: refunds.length });
    }
    return route.continue();
  });

  await page.goto(`${appBaseUrl}/admin`);
  await expect(page.getByRole('heading', { name: 'Admin console' })).toBeVisible();

  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByLabel('Status change reason').fill('Verified account review');
  await page.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByRole('status')).toContainText('suspended');
  await expect(page.getByText('SUSPENDED', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Orders' }).click();
  await page.getByLabel('Cancellation reason').fill('Duplicate order report');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('CANCELLED_BY_ADMIN')).toBeVisible();

  await page.getByRole('button', { name: 'Refunds' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('SUBMITTED')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  await page.getByLabel('Payment attempt ID').fill('payment-attempt-1');
  await page.getByLabel('Amount (minor units)').fill('250');
  await page.getByLabel('Reason', { exact: true }).fill('Duplicate capture review');
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No funds have been moved');
  await expect(page.getByText('refund-new')).toBeVisible();
});

test('admin generates, adjusts, approves, and reconciles a settlement', async ({ page }) => {
  let settlement: {
    id: string;
    status: string;
    currency: string;
    periodStart: string;
    periodEnd: string;
    netAmountMinor: number;
    externalTransferReference: string | null;
    restaurant: { name: string };
    _count: { items: number; adjustments: number };
  } | null = null;
  let adjustmentPayload: Record<string, unknown> | null = null;
  let commissionRateBps: number | null = null;
  const auditRecords: Array<Record<string, string | null>> = [];

  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, '');
    if (path.endsWith('/admin/dashboard')) return json(route, emptyDashboard);
    if (path.endsWith('/admin/settlements/generate') && request.method() === 'POST') {
      settlement = {
        id: 'settlement-1',
        status: 'DRAFT',
        currency: 'INR',
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T23:59:59.999Z',
        netAmountMinor: 12_500,
        externalTransferReference: null,
        restaurant: { name: 'Corner Kitchen' },
        _count: { items: 3, adjustments: 0 },
      };
      return json(route, settlement);
    }
    if (path.endsWith('/admin/settlements/settlement-1/adjustments')) {
      adjustmentPayload = request.postDataJSON() as Record<string, unknown>;
      if (settlement) {
        settlement = {
          ...settlement,
          netAmountMinor: settlement.netAmountMinor + Number(adjustmentPayload.amountMinor),
          _count: { ...settlement._count, adjustments: 1 },
        };
      }
      return json(route, settlement);
    }
    if (path.endsWith('/admin/settlements/settlement-1/approve')) {
      if (settlement) settlement = { ...settlement, status: 'APPROVED' };
      return json(route, settlement);
    }
    if (path.endsWith('/admin/settlements/settlement-1/mark-paid')) {
      const reference = (request.postDataJSON() as { externalTransferReference: string })
        .externalTransferReference;
      if (settlement)
        settlement = { ...settlement, status: 'PAID', externalTransferReference: reference };
      auditRecords.push({ action: 'SETTLEMENT_PAID_RECONCILED' });
      return json(route, settlement);
    }
    if (path.endsWith('/admin/commission-rules') && request.method() === 'POST') {
      commissionRateBps = (request.postDataJSON() as { rateBps: number }).rateBps;
      return json(route, { version: 2, rateBps: commissionRateBps });
    }
    if (path.endsWith('/admin/settlements')) {
      return json(route, {
        items: settlement ? [settlement] : [],
        page: 1,
        limit: 50,
        total: settlement ? 1 : 0,
      });
    }
    if (path.endsWith('/admin/audit-logs')) {
      return json(route, { items: auditRecords, page: 1, limit: 50, total: auditRecords.length });
    }
    return route.continue();
  });

  await page.goto(`${appBaseUrl}/admin`);
  await expect(page.getByRole('heading', { name: 'Admin console' })).toBeVisible();
  await page.getByRole('button', { name: 'Settlements' }).click();
  await page.getByLabel('Restaurant ID').fill('restaurant-1');
  await page.getByRole('button', { name: 'Generate period' }).click();
  await expect(page.getByText('Corner Kitchen')).toBeVisible();

  await page.getByLabel('Settlement adjustment in minor units').fill('-250');
  await page.getByLabel('Settlement adjustment reason').fill('Corrected duplicate item');
  await page.getByRole('button', { name: 'Adjust' }).click();
  await expect.poll(() => adjustmentPayload?.reason).toBe('Corrected duplicate item');

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('APPROVED')).toBeVisible();
  await page.getByLabel('External transfer reference').fill('bank-transfer-2026-001');
  await page.getByRole('button', { name: 'Reconcile' }).click();
  await expect(page.getByText('bank-transfer-2026-001')).toBeVisible();
  await expect(page.getByText('PAID')).toBeVisible();

  await page.getByLabel('Rate (%)').fill('12.5');
  await page.getByRole('button', { name: 'Save rate' }).click();
  await expect.poll(() => commissionRateBps).toBe(1250);

  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByText('SETTLEMENT_PAID_RECONCILED')).toBeVisible();
});
