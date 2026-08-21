import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { AchievementService } from "./achievement.service";

@ApiTags("achievements")
@Controller("achievements")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AchievementController {
  constructor(private readonly achievementService: AchievementService) {}

  @Get("me")
  @ApiOperation({ summary: "Get user achievements with earned status" })
  getUserAchievements(@CurrentUser() user: AuthenticatedUser) {
    return this.achievementService.getUserAchievements(user.userId);
  }

  @Get()
  @ApiOperation({ summary: "List all achievements (catalog)" })
  getAllAchievements() {
    return this.achievementService.getAllAchievements();
  }

  @Post("check")
  @ApiOperation({ summary: "Check and award achievements for the current user" })
  checkAndAward(@CurrentUser() user: AuthenticatedUser) {
    return this.achievementService.checkAndAward(user.userId);
  }
}
