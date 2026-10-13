import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSION_REQUIREMENT } from '../auth/auth.decorators.js';
import { AdminController } from './admin.controller.js';

function permission(methodName: keyof AdminController) {
  const handler = Object.getOwnPropertyDescriptor(AdminController.prototype, methodName)?.value;
  return Reflect.getMetadata(PERMISSION_REQUIREMENT, handler)?.permission;
}

describe('AdminController permission boundaries', () => {
  it('restricts unscoped refund queues to platform admin permissions', () => {
    expect(permission('refunds')).toBe('payment.refund.approve');
    expect(permission('requestRefund')).toBe('admin.orders.manage');
    expect(permission('retryRefund')).toBe('admin.orders.manage');
  });

  it('restricts audit-log reads to the explicit audit permission', () => {
    expect(permission('auditLogs')).toBe('admin.audit.read');
  });
});
