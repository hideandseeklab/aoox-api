import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { ChangePasswordController } from './change-password/change-password.controller';
import { SetUserPasswordController } from './set-user-password/set-user-password.controller';
import { DisableUserTwoFactorController } from './disable-user-two-factor/disable-user-two-factor.controller';
import { DeleteUserController } from './delete-user/delete-user.controller';
import { ListUsersController } from './list-users/list-users.controller';
import { UpdateUserRoleController } from './update-user-role/update-user-role.controller';
import { User } from './user.entity';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [
    ListUsersController,
    UpdateUserRoleController,
    DeleteUserController,
    ChangePasswordController,
    SetUserPasswordController,
    DisableUserTwoFactorController,
  ],
  providers: [UserService, AdminBootstrapService],
  exports: [UserService],
})
export class UserModule {}
