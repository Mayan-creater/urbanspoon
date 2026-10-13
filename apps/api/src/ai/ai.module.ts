import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({
  imports: [RestaurantsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}