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
  AuthUser,
  createUserRequestSchema,
  resetPasswordRequestSchema,
  setDisabledRequestSchema,
  setSuperadminRequestSchema,
  setUserRolesRequestSchema,
  UserAccount,
} from '@hexly/domain';
import { CollaborationGuard } from '../acl/collaboration.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ManageUsersGuard, SuperadminGuard } from './manage-users.guard';
import { UsersService } from './users.service';

/**
 * The account-management REST surface (ADR-0037, ADR-0047): the `/users` routes,
 * gated by {@link ManageUsersGuard} behind the session guard. Holds no route that
 * reaches a World or Entity — the `manage-users` role has zero content powers.
 *
 * The public user *directory* (id + displayName, for pickers) is a separate
 * controller at `/users/directory`; this surface carries the email.
 *
 * {@link CollaborationGuard} is listed first, so where the layer is off the routes read as absent rather
 * than unauthorized (ADR-0071).
 */
@Controller('users')
@UseGuards(CollaborationGuard, SessionAuthGuard, ManageUsersGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  listUsers(): UserAccount[] {
    return this.users.listUsers();
  }

  @Post()
  @HttpCode(201)
  async createUser(@Body() body: unknown): Promise<void> {
    const parsed = createUserRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    await this.users.createUser(parsed.data);
  }

  @Post(':id/password')
  @HttpCode(200)
  async resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const parsed = resetPasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    await this.users.resetPassword(user, id, parsed.data.password);
  }

  // Replace the account's whole Instance-Role set in one write (ADR-0047): grant or
  // revoke `manage-users` / `create-worlds`. Orthogonal powers — one is never implied
  // by the other. Superadmin is not a member and has its own endpoint below.
  @Patch(':id/roles')
  setRoles(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): void {
    const parsed = setUserRolesRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.users.setRoles(user, id, parsed.data.roles);
  }

  // Superadmin-only (ADR-0037, ADR-0047): promoting/demoting the operator's own tier is
  // the operator's power, so this route layers the stricter guard atop the manage-users one.
  @Patch(':id/superadmin')
  @UseGuards(SuperadminGuard)
  setSuperadmin(@Param('id') id: string, @Body() body: unknown): void {
    const parsed = setSuperadminRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.users.setSuperadmin(id, parsed.data.isSuperadmin);
  }

  @Delete(':id')
  @HttpCode(200)
  deleteUser(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    this.users.deleteUser(user, id);
  }

  // One toggle (matching the setSuperadmin PATCH style), not split disable/enable
  // routes: the disabled state is a body field, not a verb.
  @Patch(':id/disabled')
  setDisabled(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown): void {
    const parsed = setDisabledRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    this.users.setDisabled(user, id, parsed.data.disabled);
  }
}
