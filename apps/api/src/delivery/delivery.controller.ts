import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  DeliveryAvailabilityDto,
  DeliveryCompletionDto,
  DeliveryFailureDto,
  DeliveryPartnerDocumentDto,
  DeliveryProofUploadDto,
  DeliveryLocationDto,
  DeliveryOfferResponseDto,
  DeliveryPartnerOnboardingDto,
  DeliveryPartnerReviewDto,
  PartnerPayoutPaidDto,
  PartnerPayoutRejectDto,
  PartnerPayoutRequestDto,
} from './delivery.dto.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryEventsService } from './delivery-events.service.js';
import { DeliveryEvidenceService, type EvidenceUpload } from './delivery-evidence.service.js';

@Controller('delivery')
export class DeliveryOnboardingController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly evidence: DeliveryEvidenceService,
  ) {}

  @Post('onboarding')
  onboard(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryPartnerOnboardingDto) {
    return this.delivery.onboard(user.id, body);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.getProfile(user.id);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeliveryPartnerDocumentDto,
    @UploadedFile() file?: EvidenceUpload,
  ) {
    if (!file) throw new BadRequestException('Evidence file is required');
    return this.evidence.uploadPartnerDocument(user.id, body.evidenceType, file);
  }

  @Get('documents')
  documents(@CurrentUser() user: AuthenticatedUser) {
    return this.evidence.listPartnerDocuments(user.id);
  }
}

@Controller('delivery/partners/:partnerId')
@RequirePermission('delivery.self.manage', 'PROVIDER', 'partnerId')
export class DeliveryPartnerController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly events: DeliveryEventsService,
    private readonly evidence: DeliveryEvidenceService,
  ) {}

  @Patch('availability')
  availability(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryAvailabilityDto) {
    return this.delivery.setAvailability(user.id, body);
  }

  @Get('offers')
  offers(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.listOffers(user.id);
  }

  @Post('offers/:assignmentId/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId') assignmentId: string) {
    return this.delivery.acceptOffer(user.id, assignmentId);
  }

  @Post('offers/:assignmentId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId') assignmentId: string,
    @Body() body: DeliveryOfferResponseDto,
  ) {
    return this.delivery.rejectOffer(user.id, assignmentId, body);
  }

  @Get('active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.getActiveDelivery(user.id);
  }

  @Sse('events')
  eventsStream(@CurrentUser() user: AuthenticatedUser, @Param('partnerId') partnerId: string) {
    return this.events.partnerStream(user.id, partnerId);
  }

  @Post('active/arrived-at-restaurant')
  arriveAtRestaurant(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.arriveAtRestaurant(user.id);
  }

  @Post('active/pickup')
  pickup(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.confirmPickup(user.id);
  }

  @Post('active/arrived')
  arriveAtCustomer(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.arriveAtCustomer(user.id);
  }

  @Post('active/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryCompletionDto) {
    return this.delivery.completeDelivery(user.id, body);
  }

  @Post('active/fail')
  fail(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryFailureDto) {
    return this.delivery.failDelivery(user.id, body);
  }

  @Post('active/release')
  release(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryFailureDto) {
    return this.delivery.releaseDelivery(user.id, body);
  }

  @Post('location')
  location(@CurrentUser() user: AuthenticatedUser, @Body() body: DeliveryLocationDto) {
    return this.delivery.updateLocation(user.id, body);
  }

  @Post('evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('partnerId') partnerId: string,
    @Body() body: DeliveryProofUploadDto,
    @UploadedFile() file?: EvidenceUpload,
  ) {
    if (!file) throw new BadRequestException('Evidence file is required');
    return this.evidence.uploadDeliveryProof(
      user.id,
      partnerId,
      body.deliveryId,
      body.evidenceType,
      file,
    );
  }

  @Get('evidence')
  evidenceList(@CurrentUser() user: AuthenticatedUser) {
    return this.evidence.listPartnerEvidence(user.id);
  }

  @Get('evidence/:evidenceId/content')
  async evidenceContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('evidenceId') evidenceId: string,
    @Res() response: Response,
  ) {
    const { metadata, content } = await this.evidence.readPartnerEvidence(user.id, evidenceId);
    response
      .status(200)
      .set({
        'Content-Type': metadata.contentType,
        'Content-Disposition': `attachment; filename="${metadata.originalFilename}"`,
        'Content-Length': String(content.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }

  @Get('earnings')
  earnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.delivery.getEarnings(user.id, from, to);
  }

  @Post('payouts')
  requestPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PartnerPayoutRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.delivery.requestPayout(user.id, body, idempotencyKey);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.listPartnerPayouts(user.id);
  }
}

@Controller('admin/delivery-partners')
@RequirePermission('admin.dispatch.manage')
export class DeliveryPartnerAdminController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly evidence: DeliveryEvidenceService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.delivery.listPartnersForReview(status);
  }

  @Get(':partnerId/evidence')
  evidenceList(@Param('partnerId') partnerId: string) {
    return this.evidence.listAdminEvidence(partnerId);
  }

  @Get(':partnerId/evidence/:evidenceId/content')
  async evidenceContent(
    @Param('partnerId') partnerId: string,
    @Param('evidenceId') evidenceId: string,
    @Res() response: Response,
  ) {
    const { metadata, content } = await this.evidence.readAdminEvidence(evidenceId, partnerId);
    response
      .status(200)
      .set({
        'Content-Type': metadata.contentType,
        'Content-Disposition': `attachment; filename="${metadata.originalFilename}"`,
        'Content-Length': String(content.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }

  @Post(':partnerId/review')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('partnerId') partnerId: string,
    @Body() body: DeliveryPartnerReviewDto,
  ) {
    return this.delivery.verifyPartner(
      user.id,
      partnerId,
      body.verified,
      body.reason,
      body.verificationProvider,
      body.verificationReference,
    );
  }
}

@Controller('admin/deliveries')
@RequirePermission('admin.dispatch.manage')
export class DeliveryDispatchController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly evidence: DeliveryEvidenceService,
  ) {}

  @Get('evidence')
  evidenceList() {
    return this.evidence.listAdminDeliveryEvidence();
  }

  @Get(':deliveryId/evidence/:evidenceId/content')
  async evidenceContent(
    @Param('deliveryId') deliveryId: string,
    @Param('evidenceId') evidenceId: string,
    @Res() response: Response,
  ) {
    const { metadata, content } = await this.evidence.readAdminDeliveryEvidence(
      evidenceId,
      deliveryId,
    );
    response
      .status(200)
      .set({
        'Content-Type': metadata.contentType,
        'Content-Disposition': `attachment; filename="${metadata.originalFilename}"`,
        'Content-Length': String(content.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }

  @Post(':deliveryId/dispatch')
  dispatch(@CurrentUser() user: AuthenticatedUser, @Param('deliveryId') deliveryId: string) {
    return this.delivery.dispatch(deliveryId, user.id);
  }
}

@Controller('admin/partner-payouts')
@RequirePermission('admin.settlements.approve')
export class PartnerPayoutAdminController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.delivery.listPayoutsForAdmin(status);
  }

  @Post(':payoutId/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('payoutId') payoutId: string) {
    return this.delivery.decidePayout(user.id, payoutId, 'approve');
  }

  @Post(':payoutId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payoutId') payoutId: string,
    @Body() body: PartnerPayoutRejectDto,
  ) {
    return this.delivery.decidePayout(user.id, payoutId, 'reject', body.reason);
  }

  @Post(':payoutId/mark-paid')
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payoutId') payoutId: string,
    @Body() body: PartnerPayoutPaidDto,
  ) {
    return this.delivery.decidePayout(
      user.id,
      payoutId,
      'mark-paid',
      undefined,
      body.providerReference,
    );
  }

  @Post(':payoutId/sandbox-transfer')
  sandboxTransfer(@CurrentUser() user: AuthenticatedUser, @Param('payoutId') payoutId: string) {
    return this.delivery.executeSandboxPayout(user.id, payoutId);
  }
}

@Controller('orders')
export class DeliveryTrackingController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly events: DeliveryEventsService,
  ) {}

  @Get(':orderId/tracking')
  tracking(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.delivery.getCustomerTracking(user.id, orderId);
  }

  @Sse(':orderId/events')
  eventsStream(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.events.orderStream(user.id, orderId);
  }
}
