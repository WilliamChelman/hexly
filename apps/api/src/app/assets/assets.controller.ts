import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssetsService } from './assets.service';

/**
 * Unauthenticated Asset serving (ADR-0034): the unguessable content hash in the path IS the
 * access control, so there is deliberately no guard — even an Asset referenced from a `private`
 * Entity is readable by anyone holding the URL (accepted privacy trade). In a built deploy this
 * route is excluded from the `/api` global prefix (see `main.ts`) so the served path matches the
 * `/assets/<worldId>/<hash>.<ext>` `src` written into Content.
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get(':worldId/:file')
  serve(@Param('worldId') worldId: string, @Param('file') file: string, @Res() res: Response): void {
    const found = this.assets.read(worldId, file);
    if (!found) throw new NotFoundException();
    res.type(found.mime).send(found.bytes);
  }
}
