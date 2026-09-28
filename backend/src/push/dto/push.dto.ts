import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// BUGFIX (pre-emptive — caught before this ever shipped): the app's global
// ValidationPipe (see main.ts) is configured with
// `whitelist: true, forbidNonWhitelisted: true`. Any DTO property with no
// class-validator decorator is treated as "unknown" and the WHOLE request
// is rejected with 400 — it doesn't just get silently stripped. Every DTO
// in the repo (auth.dto.ts, pdf-ingestion.dto.ts, etc.) decorates every
// field for exactly this reason; these three classes follow the same
// convention so POST /push/subscribe, /push/unsubscribe and
// /push/admin/broadcast don't 400 on every single call.

export class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

export class SubscribeDto {
  // Not @IsUrl() — the PushSubscriptionJSON endpoint from
  // pushManager.subscribe() is always an https:// URL from the browser's
  // push service (FCM, Mozilla autopush, etc.), but some of those can be
  // very long opaque tokens; a strict IsUrl() has occasionally rejected
  // valid ones in other apps. IsString + IsNotEmpty is enough — the value
  // is never rendered/executed, only stored and later called by web-push.
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;
}

export class BroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(65, { message: 'Title should be short — long titles get cut off in the OS notification tray' })
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  body!: string;

  // Relative in-app path (e.g. "/mocks"), not an external URL — so IsUrl()
  // would wrongly reject it too. Kept as a plain optional string.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  url?: string;
}
