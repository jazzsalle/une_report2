import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private ticks = 0;

  tick(): number {
    this.ticks += 1;
    this.logger.log(`heartbeat #${this.ticks}`);
    return this.ticks;
  }
}
