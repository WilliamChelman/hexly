import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AdminUser,
  AuthUser,
  createUserRequestSchema,
  resetPasswordRequestSchema,
  setAdminRequestSchema,
  setDisabledRequestSchema,
  setSuperadminRequestSchema,
} from '@hexly/domain';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { InstanceAdminGuard, SuperadminGuard } from './instance-admin.guard';
import { AdminService } from './admin.service';

/**
 * The Instance Admin REST surface (ADR-0037, #163): account management, gated by
 * {@link InstanceAdminGuard} behind the session guard. Bodies are validated against
 * the shared Zod schema (ADR-0001) so an invalid payload is a 400 here, never a 500
 * deeper down. Deliberately holds no route that reaches a World or Entity — the Admin
 * tier has zero content powers.
 */
@Controller('admin')
@UseGuards(SessionAuthGuard, InstanceAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers(): AdminUser[] {
    return this.admin.listUsers();
  }

  @Post('users')
  @HttpCode(201)
  async createUser(@Body() body: unknown): Promise<void> {
    const parsed = createUserRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    await this.admin.createUser(parsed.data);
  }

  @Post('users/:id/password')
  @HttpCode(200)
  async resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = resetPasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    await this.admin.resetPassword(user, id, parsed.data.password);
  }

  @Patch('users/:id/admin')
  setAdmin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): void {
    const parsed = setAdminRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.admin.setAdmin(user, id, parsed.data.isAdmin);
  }

  // Superadmin-only (ADR-0037, #163): promoting/demoting the operator's own tier is the
  // operator's power, so this route layers the stricter guard atop the Admin one.
  @Patch('users/:id/superadmin')
  @UseGuards(SuperadminGuard)
  setSuperadmin(@Param('id') id: string, @Body() body: unknown): void {
    const parsed = setSuperadminRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.admin.setSuperadmin(id, parsed.data.isSuperadmin);
  }

  @Delete('users/:id')
  @HttpCode(200)
  deleteUser(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    this.admin.deleteUser(user, id);
  }

  // One toggle (matching the setAdmin/setSuperadmin PATCH style), not split
  // disable/enable routes: the disabled state is a body field, not a verb.
  @Patch('users/:id/disabled')
  setDisabled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): void {
    const parsed = setDisabledRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.admin.setDisabled(user, id, parsed.data.disabled);
  }
}
