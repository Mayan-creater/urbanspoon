import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.info(
      'No bootstrap administrator requested; permission matrix is installed by migrations.',
    );
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { credentials: { where: { provider: 'password' } } },
  });
  if (!user || !user.credentials.some((credential) => credential.verifiedAt)) {
    throw new Error('Bootstrap administrator must be an existing verified account.');
  }

  const existing = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      role: 'super_admin',
      scopeType: 'PLATFORM',
      scopeId: null,
      status: 'ACTIVE',
    },
  });
  if (existing) return;

  await prisma.$transaction(async (transaction) => {
    const assignment = await transaction.userRole.create({
      data: { userId: user.id, role: 'super_admin', scopeType: 'PLATFORM' },
    });
    await transaction.auditLog.create({
      data: {
        permission: 'system.bootstrap',
        action: 'SUPER_ADMIN_BOOTSTRAPPED',
        entityType: 'user_role',
        entityId: assignment.id,
        after: { userId: user.id, role: 'super_admin', scopeType: 'PLATFORM' },
      },
    });
  });
}

main()
  .catch(() => {
    console.error('Database seed failed. Check the database connection and bootstrap account.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
