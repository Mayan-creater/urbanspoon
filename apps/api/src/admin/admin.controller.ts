import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { OrderReasonDto } from '../orders/order-intents.dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { RejectRefundDto, RequestRefundDto, UpdateUserStatusDto } from './admin.dto.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly ordersService: OrdersService,
  ) {}

  private correlationId(request: AuthenticatedRequest) {
    const header = request.headers['x-request-id'];
    return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  }

  @Get('dashboard')
  @RequirePermission('admin.reports.read')
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.dashboard(from, to);
  }

  @Get('reports')
  @RequirePermission('admin.reports.read')
  reports(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.reports(from, to);
  }

  @Get('reports/export')
  @RequirePermission('admin.reports.read')
  async exportReports(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() response: Response,
  ) {
    const csv = await this.admin.reportsCsv(from, to);
    response
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="urban-spoon-report.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(csv);
  }

  @Get('users')
  @RequirePermission('admin.users.manage')
  users(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.users(search, page, limit);
  }

  @Patch('users/:userId/status')
  @RequirePermission('admin.users.manage')
  updateUserStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: UpdateUserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.updateUserStatus(
      actor,
      userId,
      body.status,
      body.reason,
      this.correlationId(request),
    );
  }

  @Get('orders')
  @RequirePermission('admin.orders.manage')
  orders(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.orders({ status, from, to, page, limit });
  }

  @Post('orders/:orderId/cancel')
  @RequirePermission('admin.orders.manage')
  cancelOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() body: OrderReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.ordersService.cancelAdminOrder(
      actor.id,
      orderId,
      body.reason,
      this.correlationId(request),
    );
  }

  @Get('payment-attempts')
  @RequirePermission('admin.orders.manage')
  paymentAttempts(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.paymentAttempts({ status, from, to, page, limit });
  }

  @Get('refunds')
  @RequirePermission('payment.refund.approve')
  refunds(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.refunds({ status, from, to, page, limit });
  }

  @Post('refunds')
  @RequirePermission('admin.orders.manage')
  requestRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: RequestRefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.requestRefund(actor, body, idempotencyKey, this.correlationId(request));
  }

  @Post('refunds/:refundId/approve')
  @RequirePermission('payment.refund.approve')
  approveRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.approveRefund(actor, refundId, this.correlationId(request));
  }

  @Post('refunds/:refundId/reject')
  @RequirePermission('payment.refund.approve')
  rejectRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('refundId') refundId: string,
    @Body() body: RejectRefundDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.rejectRefund(actor, refundId, body.reason, this.correlationId(request));
  }

  @Post('refunds/:refundId/retry')
  @RequirePermission('admin.orders.manage')
  retryRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.retryRefund(actor, refundId, this.correlationId(request));
  }

  @Get('audit-logs')
  @RequirePermission('admin.audit.read')
  auditLogs(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.auditLogs(actor.id, { action, entityType, from, to, page, limit });
  }
}
