import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { UpdateProfileDto } from '../auth/auth.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UsersService } from './users.service.js';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getProfile(user.id);
  }

  @Patch()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateProfileDto) {
    return this.users.updateProfile(user.id, body);
  }
}
