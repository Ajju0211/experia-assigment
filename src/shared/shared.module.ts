import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { AdminGuard } from './guards/admin.guard';
import { ApiKeyGuard } from './guards/api-key.guard';
import { BankSignatureGuard } from './guards/bank-signature.guard';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from './interceptors/response-transform.interceptor';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    ApiKeyGuard,
    AdminGuard,
    BankSignatureGuard,
    LoggingInterceptor,
    ResponseTransformInterceptor,
  ],
  exports: [
    AppConfigModule,
    ApiKeyGuard,
    AdminGuard,
    BankSignatureGuard,
    LoggingInterceptor,
    ResponseTransformInterceptor,
  ],
})
export class SharedModule {}
